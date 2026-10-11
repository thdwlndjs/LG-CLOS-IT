"""Install generated scene derivatives in the isolated local DB, preserving originals."""

import asyncio
import hashlib
import json
import sys
from uuid import UUID

import httpx
from PIL import Image
from sqlalchemy import text

from remediation_local import PACKAGE, ROOT, call, engine, identity, login, upload

MANIFEST = PACKAGE / "templates/wardrobe_sprite_manifest.json"


async def provision_approved():
    """Idempotent additive fixture through existing registration/upload contracts."""
    path = PACKAGE / "templates/approved_scene_manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    db = engine()
    household = identity("household")
    try:
        async with db.begin() as c:
            device = (
                await c.execute(
                    text("SELECT id FROM wardrobe.device WHERE household_id=:h"),
                    {"h": household},
                )
            ).scalar_one()
            before = [
                dict(r)
                for r in (
                    await c.execute(
                        text(
                            "SELECT g.id,g.owner_id,g.image_asset_id,s.location_id,s.status FROM wardrobe.garment g "
                            "JOIN wardrobe.garment_state s ON s.garment_id=g.id WHERE g.household_id=:h "
                            "AND g.attributes->>'seed_namespace'=:ns ORDER BY g.id"
                        ),
                        {"h": household, "ns": "smart-wardrobe-remediation-2026-10-11"},
                    )
                ).mappings()
            ]
        mapped = []
        auth_by_owner = {}
        for item in manifest["items"]:
            product = item["product"]
            title = product["title"]
            category = (
                "BOTTOM"
                if item["id"].startswith("C")
                else "OUTER"
                if item["id"].startswith("A") or item["id"] in {"B4", "B5", "B6"}
                else "TOP"
            )
            owner = {"엄마": "mom", "휘재": "son", "아빠": "dad", "딸": "daughter"}[
                product["proposed_persona"]
            ]
            if owner not in auth_by_owner:
                auth_by_owner[owner] = login(owner)
            auth = auth_by_owner[owner]
            photo = PACKAGE / "reports/wardrobe-visual-review" / product["local_photo"]
            derivative = ROOT / item["local_file"]
            for source, expected in [
                (photo, product["photo_sha256"]),
                (derivative, item["sha256"]),
            ]:
                if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
                    raise RuntimeError("Approved asset hash mismatch: " + item["id"])
            slot_id = identity("approved-slot:" + item["id"])
            x, y, w, height = item["bounds"]
            geometry = {
                "x": x / 1672,
                "y": y / 941,
                "width": w / 1672,
                "height": height / 941,
                "z_index": 10 + int(item["id"][1:]),
                "approved": True,
                "alignment": item["alignment"],
                "basis": "approved source coordinates",
                "approved_instance_id": item["id"],
            }
            async with db.begin() as c:
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.storage_location(id,household_id,name,location_type,capacity_units,attributes) "
                        "VALUES(:id,:h,:name,'WARDROBE',1,CAST(:attrs AS jsonb)) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": slot_id,
                        "h": household,
                        "name": "승인 " + item["id"],
                        "attrs": json.dumps(
                            {
                                "is_demo": True,
                                "display_slot": geometry,
                                "accessibility": "ACCESSIBLE",
                            }
                        ),
                    },
                )
                await c.execute(
                    text(
                        "UPDATE wardrobe.storage_location SET attributes=jsonb_set(attributes,'{display_slot}',CAST(:slot AS jsonb)) WHERE id=:id AND household_id=:h"
                    ),
                    {"id": slot_id, "h": household, "slot": json.dumps(geometry)},
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.lighting_zone(location_id,device_id,anchor_id) VALUES(:l,:d,:a) ON CONFLICT DO NOTHING"
                    ),
                    {"l": slot_id, "d": device, "a": "APPROVED-" + item["id"]},
                )
                existing = (
                    (
                        await c.execute(
                            text(
                                "SELECT id,image_asset_id FROM wardrobe.garment WHERE household_id=:h "
                                "AND attributes->>'approved_instance_id'=:key"
                            ),
                            {"h": household, "key": item["id"]},
                        )
                    )
                    .mappings()
                    .one_or_none()
                )
            with httpx.Client(
                timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
            ) as client:
                if not call(client, "GET", "/settings")["image_upload_consent"]:
                    raise RuntimeError("Existing demo image consent required")
                if existing is None:
                    async with db.begin() as c:
                        original_id = await c.scalar(
                            text(
                                "SELECT id FROM wardrobe.asset WHERE household_id=:h AND status='READY' "
                                "AND metadata->>'approved_original_scene_id'=:key "
                                "AND metadata->>'checksum_sha256'=:sha LIMIT 1"
                            ),
                            {
                                "h": household,
                                "key": item["id"],
                                "sha": product["photo_sha256"],
                            },
                        )
                    if original_id is None:
                        original_id = upload(client, photo)["asset_id"]
                        async with db.begin() as c:
                            await c.execute(
                                text(
                                    "UPDATE wardrobe.asset SET metadata=metadata || CAST(:m AS jsonb) WHERE id=:id AND household_id=:h"
                                ),
                                {
                                    "id": UUID(original_id),
                                    "h": household,
                                    "m": json.dumps(
                                        {"approved_original_scene_id": item["id"]}
                                    ),
                                },
                            )
                    original_id = str(original_id)
                    created = call(
                        client,
                        "POST",
                        "/garments",
                        headers={
                            "Idempotency-Key": str(
                                identity("approved-registration:" + item["id"])
                            )
                        },
                        json={
                            "owner_id": str(identity(owner)),
                            "device_id": str(device),
                            "name": title,
                            "category": category,
                            "color": title.rsplit("_", 1)[-1].strip(),
                            "image_asset_id": original_id,
                            "season_tags": ["ALL"],
                            "location_id": str(slot_id),
                        },
                    )
                    garment_id = created["id"]
                    async with db.begin() as c:
                        await c.execute(
                            text(
                                "UPDATE wardrobe.garment SET attributes=attributes || CAST(:a AS jsonb) WHERE id=:g AND household_id=:h"
                            ),
                            {
                                "g": UUID(garment_id),
                                "h": household,
                                "a": json.dumps(
                                    {
                                        "is_demo": True,
                                        "approved_instance_id": item["id"],
                                        "product_reference": product,
                                        "storage_units": 1,
                                        "synthetic_state": True,
                                        "seasonal_role": "winter"
                                        if category == "OUTER"
                                        else "long_sleeve_shirt"
                                        if category == "TOP"
                                        else "transitional",
                                    }
                                ),
                            },
                        )
                else:
                    garment_id, original_id = (
                        str(existing["id"]),
                        str(existing["image_asset_id"]),
                    )
                    async with db.begin() as c:
                        await c.execute(
                            text(
                                "UPDATE wardrobe.garment SET category=:cat WHERE id=:id AND household_id=:h AND attributes->>'approved_instance_id'=:key"
                            ),
                            {
                                "id": UUID(garment_id),
                                "h": household,
                                "key": item["id"],
                                "cat": category,
                            },
                        )
                if category == "OUTER":
                    async with db.begin() as c:
                        await c.execute(
                            text(
                                "UPDATE wardrobe.garment SET season_tags=ARRAY['WINTER'], attributes=attributes || CAST(:a AS jsonb), version=version+1 WHERE id=:id AND household_id=:h AND NOT attributes ? 'approved_season_fixture_initialized'"
                            ),
                            {
                                "id": UUID(garment_id),
                                "h": household,
                                "a": json.dumps(
                                    {
                                        "approved_season_fixture_initialized": True,
                                        "season_basis": "G1 synthetic winter coat demonstration",
                                    }
                                ),
                            },
                        )
                # Asset reuse is verified in the live isolated DB, never trusted solely from a stale manifest.
                async with db.begin() as c:
                    derived = (
                        await c.execute(
                            text(
                                "SELECT id FROM wardrobe.asset WHERE household_id=:h AND status='READY' "
                                "AND metadata->>'approved_scene_id'=:key AND metadata->>'checksum_sha256'=:sha LIMIT 1"
                            ),
                            {"h": household, "key": item["id"], "sha": item["sha256"]},
                        )
                    ).scalar_one_or_none()
                uploaded = derived is None
                if uploaded:
                    derived = UUID(upload(client, derivative)["asset_id"])
                mask = {
                    "width": w,
                    "height": height,
                    "path": f"M0 0h{w}v{height}H0Z",
                    "crop": [0, 0, w, height],
                    "scene_alignment": item["alignment"],
                }
                async with db.begin() as c:
                    await c.execute(
                        text(
                            "UPDATE wardrobe.asset SET kind='OTHER',metadata=metadata || CAST(:m AS jsonb) WHERE id=:id AND household_id=:h"
                        ),
                        {
                            "id": derived,
                            "h": household,
                            "m": json.dumps(
                                {
                                    "scene_role": "generated-wardrobe-sprites",
                                    "approved_scene_id": item["id"],
                                    "visual_approval": "user-approved",
                                    "source_sha256": product["photo_sha256"],
                                }
                            ),
                        },
                    )
                    mode = "hanging" if item["alignment"] == "hanging" else "folded"
                    await c.execute(
                        text(
                            "UPDATE wardrobe.asset SET metadata=jsonb_set(metadata,'{scene_sprites}',CAST(:m AS jsonb)) WHERE id=:id AND household_id=:h"
                        ),
                        {
                            "id": UUID(original_id),
                            "h": household,
                            "m": json.dumps(
                                {
                                    mode: {
                                        "asset_id": str(derived),
                                        "source_sha256": product["photo_sha256"],
                                        "mask": mask,
                                    }
                                }
                            ),
                        },
                    )
                    if item.get("display_mask"):
                        await c.execute(
                            text(
                                "UPDATE wardrobe.asset SET metadata=jsonb_set(metadata,'{display_mask}',CAST(:m AS jsonb)) WHERE id=:id AND household_id=:h"
                            ),
                            {
                                "id": UUID(original_id),
                                "h": household,
                                "m": json.dumps(item["display_mask"]),
                            },
                        )
                    # API registration makes location unknown until an explicit synthetic observation.
                    state = (
                        (
                            await c.execute(
                                text(
                                    "SELECT location_id,location_confidence FROM wardrobe.garment_state WHERE garment_id=:id"
                                ),
                                {"id": UUID(garment_id)},
                            )
                        )
                        .mappings()
                        .one()
                    )
                if existing is None or state["location_confidence"] is None:
                    from datetime import datetime, timezone

                    call(
                        client,
                        "POST",
                        "/garment-observations",
                        json={
                            "garment_id": garment_id,
                            "location_id": str(slot_id),
                            "sensor_type": "MOCK",
                            "confidence": 1.0,
                            "observed_at": datetime.now(timezone.utc).isoformat(),
                            "source_id": "approved-scene:" + item["id"],
                        },
                    )
            # Explicit G1 synthetic availability, separate from a sensor location observation.
            # Initialize once; reruns never reset a user's later storage/care state.
            async with db.begin() as c:
                await c.execute(
                    text(
                        "UPDATE wardrobe.garment_state s SET status='AVAILABLE',version=s.version+1,updated_at=now() "
                        "FROM wardrobe.garment g WHERE s.garment_id=g.id AND g.id=:id "
                        "AND g.household_id=:h AND g.attributes->>'approved_instance_id'=:key "
                        "AND NOT (g.attributes ? 'approved_fixture_state_initialized') "
                        "AND s.status='UNKNOWN' AND s.location_confidence>=0.9"
                    ),
                    {"id": UUID(garment_id), "h": household, "key": item["id"]},
                )
                await c.execute(
                    text(
                        "UPDATE wardrobe.garment SET attributes=attributes || CAST(:a AS jsonb) "
                        "WHERE id=:id AND household_id=:h AND NOT (attributes ? 'approved_fixture_state_initialized')"
                    ),
                    {
                        "id": UUID(garment_id),
                        "h": household,
                        "a": json.dumps(
                            {
                                "approved_fixture_state_initialized": True,
                                "availability_basis": "G1 explicit synthetic fixture, not actual wear",
                            }
                        ),
                    },
                )
            mapped.append(
                {
                    "approved_id": item["id"],
                    "source_product_id": product["source_product_id"],
                    "garment_id": garment_id,
                    "owner_id": str(identity(owner)),
                    "original_asset_id": original_id,
                    "scene_asset_id": str(derived),
                    "location_id": str(slot_id),
                    "anchor_id": "APPROVED-" + item["id"],
                }
            )
            print("Linked " + item["id"], flush=True)
            if uploaded or existing is None:
                await asyncio.sleep(12)  # Honor the existing upload API rate limit.
        async with db.begin() as c:
            after = [
                dict(r)
                for r in (
                    await c.execute(
                        text(
                            "SELECT g.id,g.owner_id,g.image_asset_id,s.location_id,s.status FROM wardrobe.garment g "
                            "JOIN wardrobe.garment_state s ON s.garment_id=g.id WHERE g.household_id=:h "
                            "AND g.attributes->>'seed_namespace'=:ns ORDER BY g.id"
                        ),
                        {"h": household, "ns": "smart-wardrobe-remediation-2026-10-11"},
                    )
                ).mappings()
            ]
            if before != after or len(after) != 52:
                raise RuntimeError("Existing 52 records were changed")
            # Old demo layout remains physically intact; its unapproved visual representation is suppressed.
            await c.execute(
                text(
                    'UPDATE wardrobe.storage_location SET attributes=attributes || \'{"scene_visibility":"hidden"}\'::jsonb '
                    "WHERE household_id=:h AND attributes->'display_slot'->>'basis'='image_traced_demo_subdivision'"
                ),
                {"h": household},
            )
        manifest["mapping"] = mapped
        manifest["existing_52_preserved"] = True
        path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(
            f"Approved mappings {len(mapped)}; existing 52 unchanged; unassigned shelf products excluded"
        )
    finally:
        await db.dispose()


def masks(path, batch):
    with Image.open(path) as image:
        alpha = image.getchannel("A")
        pixels = alpha.load()
        result = []
        for i, item in enumerate(batch["items"]):
            modes = {}
            for mode in ("hanging", "folded"):
                if batch["batch"] == "batch-07":
                    edges = (
                        [0, 236, 440, 665, 1065]
                        if mode == "hanging"
                        else [0, 300, 455, 645, 1045]
                    )
                elif batch["batch"] == "batch-06":
                    edges = [0, 198, 416, 603, 777, 977, 1130, 1310, 1536]
                else:
                    edges = list(range(0, 1537, 192))
                x0, x1 = edges[i : i + 2]
                y0, y1 = (0, 710) if mode == "hanging" else (720, 1024)
                left, top, right, bottom = x1, y1, x0, y0
                parts = []
                for y in range(y0, y1):
                    x = x0
                    while x < x1:
                        while x < x1 and pixels[x, y] < 64:
                            x += 1
                        start = x
                        while x < x1 and pixels[x, y] >= 64:
                            x += 1
                        if x > start:
                            parts.append(f"M{start} {y}h{x - start}v1h{start - x}z")
                            left = min(left, start)
                            right = max(right, x)
                            top = min(top, y)
                            bottom = max(bottom, y + 1)
                if right <= left or bottom <= top:
                    raise RuntimeError(
                        f"Empty generated sprite: {item['item_id']}/{mode}"
                    )
                modes[mode] = {
                    "width": 1536,
                    "height": 1024,
                    "path": "".join(parts),
                    "crop": [left, top, right - left, bottom - top],
                    "basis": "generated atlas alpha silhouette; original rasters unchanged",
                    "scene_alignment": "hanging" if mode == "hanging" else "shelf",
                }
            result.append((item, modes))
        return result


async def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    db = engine()
    try:
        auth = login("mom")
        with httpx.Client(
            timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
        ) as client:
            settings = call(client, "GET", "/settings")
            if not settings["image_upload_consent"]:
                raise RuntimeError("Image consent required")
            for batch in manifest["batches"]:
                path = ROOT / batch["local_atlas"]
                if (
                    hashlib.sha256(path.read_bytes()).hexdigest()
                    != batch["atlas_sha256"]
                ):
                    raise RuntimeError("Derivative changed")
                if "atlas_asset_id" not in batch:
                    batch["atlas_asset_id"] = upload(client, path)["asset_id"]
                    MANIFEST.write_text(
                        json.dumps(manifest, indent=2), encoding="utf-8"
                    )
                asset_id = UUID(batch["atlas_asset_id"])
                async with db.begin() as c:
                    await c.execute(
                        text(
                            "UPDATE wardrobe.asset SET kind='OTHER', metadata=metadata || CAST(:m AS jsonb) WHERE id=:a AND household_id=:h AND status='READY'"
                        ),
                        {
                            "a": asset_id,
                            "h": identity("household"),
                            "m": json.dumps(
                                {
                                    "scene_role": "generated-wardrobe-sprites",
                                    "generation_tool": "built-in image_gen",
                                    "source_items": [
                                        i["item_id"] for i in batch["items"]
                                    ],
                                    "is_demo": True,
                                    "visual_review": "local_display_candidate_not_product_fidelity_certified",
                                }
                            ),
                        },
                    )
                    for item, variants in masks(path, batch):
                        item["cells"] = {
                            mode: mask["crop"] for mode, mask in variants.items()
                        }
                        item["mask_sha256"] = {
                            mode: hashlib.sha256(mask["path"].encode()).hexdigest()
                            for mode, mask in variants.items()
                        }
                        row = (
                            (
                                await c.execute(
                                    text(
                                        "SELECT a.id,a.metadata FROM wardrobe.asset a JOIN wardrobe.garment g ON g.image_asset_id=a.id WHERE g.id=:g AND g.household_id=:h"
                                    ),
                                    {
                                        "g": identity(item["item_id"]),
                                        "h": identity("household"),
                                    },
                                )
                            )
                            .mappings()
                            .one()
                        )
                        if row["metadata"]["checksum_sha256"] != item["source_sha256"]:
                            raise RuntimeError(
                                "Source changed; refusing stale derivative"
                            )
                        sprites = {
                            mode: {
                                "asset_id": str(asset_id),
                                "source_sha256": item["source_sha256"],
                                "mask": mask,
                            }
                            for mode, mask in variants.items()
                        }
                        await c.execute(
                            text(
                                "UPDATE wardrobe.asset SET metadata=jsonb_set(metadata,'{scene_sprites}',CAST(:sprites AS jsonb)) WHERE id=:a AND household_id=:h"
                            ),
                            {
                                "a": row["id"],
                                "h": identity("household"),
                                "sprites": json.dumps(sprites),
                            },
                        )
                batch["status"] = "LOCAL_DISPLAY_CANDIDATE"
                batch["display_geometry_basis"] = (
                    "alpha silhouette bounds; see item.cells"
                )
                MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
                print(
                    batch["batch"]
                    + ": private generated sprites linked; original garment image IDs preserved"
                )
    finally:
        await db.dispose()


if __name__ == "__main__":
    asyncio.run(provision_approved() if "--approved" in sys.argv else main())
