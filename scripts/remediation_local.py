"""52-image isolated demonstration. No project .env, production URL or rollback deletes."""

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import sys
from uuid import NAMESPACE_URL, uuid4, uuid5

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from handoff_local import ROOT, RUNTIME, docker, prepare, test_environment

sys.path.insert(0, str(ROOT / "backend"))
PACKAGE = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"
DATABASE = "wardrobe_test_remediation"
NS = "smart-wardrobe-remediation-2026-10-11"
API = "http://127.0.0.1:18081/api/v1"


def identity(name):
    return uuid5(NAMESPACE_URL, NS + ":" + name)


def environment():
    env = test_environment()
    env["DATABASE_URL"] = env["DATABASE_URL"].rsplit("/", 1)[0] + "/" + DATABASE
    return env


def engine():
    return create_async_engine(environment()["DATABASE_URL"])


async def demo_personas():
    """Update only names of the two existing isolated demonstration members."""
    e = engine()
    try:
        async with e.begin() as c:
            for key, name in (("mom", "김수진"), ("son", "최휘재")):
                result = await c.execute(
                    text(
                        "UPDATE wardrobe.member SET display_name=:name "
                        "WHERE id=:id AND household_id=:household"
                    ),
                    {
                        "name": name,
                        "id": identity(key),
                        "household": identity("household"),
                    },
                )
                if result.rowcount != 1:
                    raise RuntimeError("Provision the isolated demo members first")
        print("Existing demo personas updated; garment ownership and history preserved")
    finally:
        await e.dispose()


def products():
    return json.loads(
        (PACKAGE / "templates/remediation_products.json").read_text(encoding="utf-8")
    )["items"]


def slots():
    # Pixel-traced open compartments; item subdivisions/capacity are explicit demo design.
    regions = {
        "A": (100, 135, 268, 525, 4, 2),
        "B": (411, 130, 277, 298, 5, 2),
        "C": (411, 476, 277, 258, 5, 2),
        "D": (985, 93, 286, 410, 3, 4),
        "E": (1308, 92, 270, 404, 3, 4),
        "F": (1308, 515, 270, 330, 3, 3),
    }
    result = []
    for group, (x, y, w, h, columns, rows) in regions.items():
        for i in range(columns * rows):
            width, height = w / columns, h / rows
            if group in {"D", "E", "F"}:
                traced_rows = (
                    [(34, 112), (172, 102), (296, 94), (412, 86)]
                    if group in {"D", "E"}
                    else [(525, 88), (635, 92), (754, 90)]
                )
                row_y, height = traced_rows[i // columns]
            else:
                row_y = y + i // columns * height
            if group in {"A", "B", "C"}:
                # One physical rail per compartment, not floating thumbnail rows.
                count = columns * rows
                width = 130 if group == "A" else 110
                height = 465 if group == "A" else 295 if group == "B" else 290
                row_y = 121 if group == "A" else 121 if group == "B" else 441
                item_x = x + 5 + i * (w - width - 10) / (count - 1)
            else:
                item_x = x + i % columns * width
            result.append(
                {
                    "key": f"{group}-{i + 1:02}",
                    "group": group,
                    "x": (item_x + 3) / 1672,
                    "y": (row_y + 3) / 941,
                    "width": (width - 6) / 1672,
                    "height": (height - 6) / 941,
                    "z_index": 10 + i,
                    "alignment": "hanging" if group in {"A", "B", "C"} else "shelf",
                    "approved": True,
                    "basis": "image_traced_demo_subdivision",
                    "anchor": f"REM-{group}-{i + 1:02}",
                }
            )
    return result


async def apply_demo_layout():
    """Only named synthetic fixture geometry; never inventory state or capacity."""
    db = engine()
    frame = ROOT / "web/public/assets/remediation/wardrobe-clean-plate-v1.png"
    manifest = {
        "version": "image-traced-demo-v3",
        "frame_width": 1672,
        "frame_height": 941,
        "clean_plate_sha256": hashlib.sha256(frame.read_bytes()).hexdigest(),
        "mirror_exclusion_px": [714, 28, 248, 824],
        "capacity_basis": "synthetic item cells, not measured hardware capacity",
        "G": "closed drawer; no visible garment or LED position invented",
        "layer_order": [
            "reconstructed empty frame",
            "masked actual garment photos",
            "selection hit regions",
            "Mock slot highlight",
        ],
        "slots": slots(),
    }
    try:
        async with db.begin() as c:
            for slot in slots():
                assert slot["x"] + slot["width"] < 714 / 1672 or slot["x"] > 962 / 1672
                attrs = await c.scalar(
                    text(
                        "SELECT attributes FROM wardrobe.storage_location WHERE id=:id AND household_id=:h"
                    ),
                    {"id": identity(slot["key"]), "h": identity("household")},
                )
                if not attrs or not attrs.get("is_demo"):
                    raise RuntimeError("Not an explicitly synthetic fixture location")
                await c.execute(
                    text(
                        "UPDATE wardrobe.storage_location SET attributes=jsonb_set(attributes,'{display_slot}',CAST(:slot AS jsonb)) WHERE id=:id AND household_id=:h"
                    ),
                    {
                        "slot": json.dumps(slot),
                        "id": identity(slot["key"]),
                        "h": identity("household"),
                    },
                )
        (PACKAGE / "templates/remediation_layout.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(
            "Applied image-traced demo geometry only; inventory positions/status untouched."
        )
    finally:
        await db.dispose()


async def seed():
    from alembic import command
    from alembic.config import Config
    from app.core.passwords import hash_password

    db = engine()
    runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
    try:
        async with db.begin() as c:

            def migrate(sync):
                cfg = Config(str(ROOT / "backend/alembic.ini"))
                cfg.attributes["connection"] = sync
                command.upgrade(cfg, "head")

            await c.run_sync(migrate)
            await c.execute(
                text(
                    "INSERT INTO wardrobe.household(id,name) VALUES(:id,:n) ON CONFLICT DO NOTHING"
                ),
                {"id": identity("household"), "n": NS},
            )
            h = identity("household")
            d = await c.scalar(
                text("SELECT id FROM wardrobe.device WHERE household_id=:h"), {"h": h}
            )
            if "remediation_station_credential" not in runtime:
                runtime["remediation_station_credential"] = secrets.token_urlsafe(32)
                runtime["remediation_station_id"] = str(identity("station"))
                RUNTIME.write_text(json.dumps(runtime), encoding="utf-8")
            await c.execute(
                text(
                    "INSERT INTO wardrobe.access_station(id,name,kind,device_id,credential_hash) VALUES(:id,'Remediation local mirror','HOME',:d,:p) ON CONFLICT DO NOTHING"
                ),
                {
                    "id": identity("station"),
                    "d": d,
                    "p": hash_password(runtime["remediation_station_credential"]),
                },
            )
            for owner, name, role in [
                ("mom", "김수진", "OWNER"),
                ("son", "최휘재", "MEMBER"),
                ("dad", "아빠", "MEMBER"),
                ("daughter", "딸", "MEMBER"),
            ]:
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.member(id,household_id,display_name,role) VALUES(:id,:h,:n,:r) ON CONFLICT DO NOTHING"
                    ),
                    {"id": identity(owner), "h": h, "n": name, "r": role},
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) VALUES(:id,:n,:p) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": identity(owner),
                        "n": "remediation-" + owner,
                        "p": hash_password(runtime["demo_password"]),
                    },
                )
            for slot in slots():
                attrs = {
                    "is_demo": True,
                    "capacity_basis": "synthetic_slot_units_not_hardware_measurement",
                    "accessibility": "ACCESSIBLE",
                    "display_slot": slot,
                }
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.storage_location(id,household_id,name,location_type,capacity_units,attributes) VALUES(:id,:h,:n,'WARDROBE',1,CAST(:a AS jsonb)) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": identity(slot["key"]),
                        "h": h,
                        "n": slot["key"],
                        "a": json.dumps(attrs),
                    },
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.lighting_zone(location_id,device_id,anchor_id) VALUES(:id,:d,:a) ON CONFLICT DO NOTHING"
                    ),
                    {"id": identity(slot["key"]), "d": d, "a": slot["anchor"]},
                )
            for key, name, tier, capacity in [
                ("room2", "두번째 방 보관함", "ARCHIVE", 24),
                ("entry", "현관 보관함", "ARCHIVE", 8),
                ("G", "G 소품 서랍", "ACCESSIBLE", 8),
                ("G-shoes", "G 신발 데모 보관함", "ACCESSIBLE", 2),
            ]:
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.storage_location(id,household_id,name,location_type,capacity_units,attributes) VALUES(:id,:h,:n,:t,:cap,CAST(:a AS jsonb)) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": identity(key),
                        "h": h,
                        "n": name,
                        "t": "DRAWER" if key.startswith("G") else "BOX",
                        "cap": capacity,
                        "a": json.dumps(
                            {
                                "is_demo": True,
                                "capacity_basis": "synthetic_demo",
                                "accessibility": tier,
                                "scene_visibility": "hidden"
                                if key.startswith("G")
                                else "external",
                            }
                        ),
                    },
                )
            locations = (
                await c.execute(
                    text(
                        "SELECT id FROM wardrobe.storage_location WHERE household_id=:h"
                    ),
                    {"h": h},
                )
            ).all()
            for (loc,) in locations:
                humidity = 72 if loc == identity("entry") else 45
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.environment_reading(id,location_id,temperature_c,humidity_pct,measured_at,source) VALUES(:id,:loc,18,:humidity,now(),'MOCK') ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": identity("environment:" + str(loc)),
                        "loc": loc,
                        "humidity": humidity,
                    },
                )
            internal_index = 0
            for row in products():
                if row["initial_storage"] == "internal":
                    location = identity(slots()[internal_index]["key"])
                    internal_index += 1
                else:
                    location = identity(
                        "G-shoes"
                        if row["category"] == "SHOES"
                        else "G"
                        if row["initial_storage"] == "accessory"
                        else "room2"
                    )
                attrs = {
                    "is_demo": True,
                    "seed_namespace": NS,
                    "product_reference": row,
                    "storage_units": 1,
                    "synthetic_state": True,
                    "seasonal_role": "long_sleeve_shirt"
                    if row["season_role"] == "transitional"
                    else row["season_role"],
                    "storage_constraints": {"max_humidity_pct": 60},
                }
                tags = (
                    ["SUMMER"]
                    if row["season_role"] == "summer"
                    else ["WINTER"]
                    if row["season_role"] == "winter"
                    else ["ALL"]
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.garment(id,household_id,owner_id,device_id,name,category,color,season_tags,attributes) VALUES(:id,:h,:o,:d,:n,:cat,:color,:tags,CAST(:a AS jsonb)) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": identity(row["item_id"]),
                        "h": h,
                        "o": identity(row["owner"]),
                        "d": d,
                        "n": row["name"],
                        "cat": row["category"],
                        "color": row["color"],
                        "tags": tags,
                        "a": json.dumps(attrs),
                    },
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.garment_state(garment_id,location_id,status,location_confidence,last_seen_at) VALUES(:id,:loc,:status,1,now()) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": identity(row["item_id"]),
                        "loc": location,
                        "status": "STORED"
                        if row["initial_storage"] == "external"
                        else "AVAILABLE",
                    },
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.garment_observation(id,garment_id,location_id,sensor_type,confidence,observed_at,raw_payload) VALUES(:oid,:id,:loc,'MOCK',1,now(),'{\"basis\":\"synthetic_demo\"}'::jsonb) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "oid": identity("obs:" + row["item_id"]),
                        "id": identity(row["item_id"]),
                        "loc": location,
                    },
                )
            print(
                json.dumps(
                    {
                        "database": DATABASE,
                        "garments": await c.scalar(
                            text(
                                "SELECT count(*) FROM wardrobe.garment WHERE household_id=:h"
                            ),
                            {"h": h},
                        ),
                        "members": 4,
                        "demo_slots": len(slots()),
                    }
                )
            )
    finally:
        await db.dispose()


def call(client, method, path, **kwargs):
    headers = kwargs.pop("headers", {})
    if method != "GET":
        headers.setdefault("Idempotency-Key", str(uuid4()))
    r = client.request(method, API + path, headers=headers, **kwargs)
    if r.is_error:
        raise RuntimeError(f"{method} {path}: {r.status_code} {r.text[:350]}")
    return r.json()


def login(owner):
    rt = json.loads(RUNTIME.read_text(encoding="utf-8"))
    with httpx.Client(timeout=30) as c:
        auth = call(
            c,
            "POST",
            "/integration/login",
            json={"login": "remediation-" + owner, "password": rt["demo_password"]},
        )
    return auth


def upload(client, path, purpose="GARMENT"):
    from PIL import Image

    with Image.open(path) as im:
        mime = Image.MIME[im.format]
    data = path.read_bytes()
    intent = call(
        client,
        "POST",
        "/assets/upload-intents",
        json={
            "file_name": path.name,
            "content_type": mime,
            "size_bytes": len(data),
            "purpose": purpose,
        },
    )
    # Explicit local test relay, preserving the host bound into the signature.
    url = intent["upload_url"]
    assert url.startswith("http://localhost:9000/wardrobe-assets/")
    with httpx.Client(timeout=60) as c:
        r = c.put(
            url.replace("http://localhost:9000", "http://127.0.0.1:19000", 1),
            content=data,
            headers={**intent["required_headers"], "Host": "localhost:9000"},
        )
        r.raise_for_status()
    return call(
        client,
        "POST",
        f"/assets/{intent['asset_id']}/finalize",
        json={"checksum_sha256": hashlib.sha256(data).hexdigest()},
    )


async def provision():
    db = engine()
    completed = 0
    try:
        for owner in ["mom", "son", "dad", "daughter"]:
            auth = login(owner)
            with httpx.Client(
                timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
            ) as c:
                settings = call(c, "GET", "/settings")
                settings["image_upload_consent"] = True
                call(c, "PUT", "/settings", json=settings)
                for row in [x for x in products() if x["owner"] == owner]:
                    if row["category"] == "SHOES":
                        async with db.begin() as conn:
                            shoe_location = await conn.scalar(
                                text(
                                    "SELECT location_id FROM wardrobe.garment_state WHERE garment_id=:id"
                                ),
                                {"id": identity(row["item_id"])},
                            )
                        if shoe_location == identity("G"):
                            from datetime import datetime, timezone

                            call(
                                c,
                                "POST",
                                "/garment-observations",
                                json={
                                    "garment_id": str(identity(row["item_id"])),
                                    "location_id": str(identity("G-shoes")),
                                    "sensor_type": "MOCK",
                                    "confidence": 1.0,
                                    "observed_at": datetime.now(
                                        timezone.utc
                                    ).isoformat(),
                                    "source_id": "remediation-G-shoes-demo-layout",
                                },
                            )
                    async with db.begin() as conn:
                        present = await conn.scalar(
                            text(
                                "SELECT image_asset_id FROM wardrobe.garment WHERE id=:id"
                            ),
                            {"id": identity(row["item_id"])},
                        )
                    if present:
                        async with db.begin() as conn:
                            checksum = await conn.scalar(
                                text(
                                    "SELECT metadata->>'checksum_sha256' FROM wardrobe.asset WHERE id=:a AND household_id=:h"
                                ),
                                {"a": present, "h": identity("household")},
                            )
                            if checksum != row["image_sha256"]:
                                raise RuntimeError(
                                    "Inventory image changed; refusing unrelated SVG mask: "
                                    + row["item_id"]
                                )
                            await conn.execute(
                                text(
                                    "UPDATE wardrobe.asset SET metadata=metadata || CAST(:m AS jsonb) WHERE id=:a AND household_id=:h"
                                ),
                                {
                                    "a": present,
                                    "h": identity("household"),
                                    "m": json.dumps(
                                        {
                                            "display_mask": row.get("display_mask"),
                                            "provenance": row,
                                        }
                                    ),
                                },
                            )
                        continue
                    asset = upload(c, ROOT / row["local_image"])
                    # Seed linking and provenance updates are isolated, never mutate deployed data.
                    async with db.begin() as conn:
                        await conn.execute(
                            text(
                                "UPDATE wardrobe.garment SET image_asset_id=:a,version=version+1,updated_at=now() WHERE id=:id AND image_asset_id IS NULL"
                            ),
                            {"a": asset["asset_id"], "id": identity(row["item_id"])},
                        )
                        await conn.execute(
                            text(
                                "UPDATE wardrobe.asset SET metadata=metadata || CAST(:m AS jsonb) WHERE id=:a"
                            ),
                            {
                                "a": asset["asset_id"],
                                "m": json.dumps(
                                    {
                                        "provenance": row,
                                        "display_mask": row.get("display_mask"),
                                        "immutable": True,
                                        "is_demo": True,
                                    }
                                ),
                            },
                        )
                    completed += 1
        # Clean plate is uploaded/finalized through consent contract, then reclassified as scene asset.
        async with db.begin() as conn:
            present = await conn.scalar(
                text(
                    "SELECT id FROM wardrobe.asset WHERE metadata->>'scene_role'='clean-plate' AND household_id=:h"
                ),
                {"h": identity("household")},
            )
        if not present:
            auth = login("mom")
            with httpx.Client(
                timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
            ) as c:
                frame = upload(
                    c,
                    ROOT / "web/public/assets/remediation/wardrobe-clean-plate-v1.png",
                )
            async with db.begin() as conn:
                device = await conn.scalar(
                    text("SELECT id FROM wardrobe.device WHERE household_id=:h"),
                    {"h": identity("household")},
                )
                metadata = {
                    "scene_role": "clean-plate",
                    "scene_device_id": str(device),
                    "visual_approval": "approved",
                    "basis": "imagegen_reconstructed_demo_not_measured_hardware",
                }
                await conn.execute(
                    text(
                        "UPDATE wardrobe.asset SET kind='OTHER',metadata=metadata || CAST(:m AS jsonb) WHERE id=:a"
                    ),
                    {"a": frame["asset_id"], "m": json.dumps(metadata)},
                )
        print(
            json.dumps(
                {"newly_uploaded": completed, "asset_links_expected": len(products())}
            )
        )
    finally:
        await db.dispose()


if __name__ == "__main__":
    mode = argparse.ArgumentParser()
    mode.add_argument(
        "mode",
        choices=["prepare", "serve", "provision", "verify", "layout", "personas"],
    )
    selected = mode.parse_args().mode
    if selected == "prepare":
        prepare()
        exists = docker(
            "exec",
            "wardrobe-handoff-p3-db",
            "psql",
            "-U",
            "postgres",
            "-tAc",
            f"SELECT 1 FROM pg_database WHERE datname='{DATABASE}'",
        ).stdout.strip()
        if not exists:
            docker(
                "exec", "wardrobe-handoff-p3-db", "createdb", "-U", "postgres", DATABASE
            )
        asyncio.run(seed())
    elif selected == "serve":
        rt = json.loads(RUNTIME.read_text(encoding="utf-8"))
        if "jwt_secret" not in rt:
            rt["jwt_secret"] = secrets.token_urlsafe(48)
            RUNTIME.write_text(json.dumps(rt), encoding="utf-8")
        env = environment()
        env.update(
            JWT_SECRET=rt["jwt_secret"],
            WORKER_EXECUTION="INLINE",
            CARD_RENDERER_URL="http://127.0.0.1:3300",
            DECART_API_KEY="",
            PUBLIC_DEMO_LOGIN_ENABLED="false",
            LOCAL_DEMO_MEMBER_ID=str(identity("son")),
            LOCAL_DEMO_MOTHER_MEMBER_ID=str(identity("mom")),
            LOCAL_DEMO_STATION_ID=str(identity("station")),
            STORAGE_PUBLIC_BASE_URL="http://localhost:9000",
            N8N_ENABLED="false",
            LED_OFF_SECONDS="10",
            CELERY_BROKER_URL="redis://127.0.0.1:16379/0",
            CELERY_RESULT_BACKEND="redis://127.0.0.1:16379/1",
        )
        os.environ.update(env)
        import uvicorn
        from app.main import create_app

        uvicorn.run(create_app(), host="127.0.0.1", port=18081)
    elif selected == "provision":
        asyncio.run(provision())
    elif selected == "personas":
        asyncio.run(demo_personas())
    elif selected == "layout":
        asyncio.run(apply_demo_layout())
    else:
        asyncio.run(seed())
        print(
            "Idempotent inserts preserve subsequent application changes; no state reset performed."
        )
