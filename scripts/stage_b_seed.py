"""Additive, idempotent local Stage B fixture; never resets existing records."""

import asyncio
import json
from datetime import datetime, timedelta, UTC
from uuid import UUID
from sqlalchemy import text
from alembic.config import Config
from remediation_local import engine, identity, ROOT, PACKAGE

NS = "poc-stage-b-v1"


def uid(key):
    return identity(NS + ":" + key)


def wire(x):
    return json.dumps(x, ensure_ascii=False, default=str)


async def seed():
    e = engine()
    report = {}
    now = datetime(2026, 10, 11, 15, tzinfo=UTC)
    async with e.begin() as c:
        await c.run_sync(lambda connection: migrate(connection))
        await c.execute(text("SELECT pg_advisory_xact_lock(hashtext('stage-b-seed'))"))
        gs = [
            dict(x)
            for x in (
                await c.execute(
                    text(
                        "SELECT g.*,s.location_id,s.status::text AS storage_status FROM wardrobe.garment g JOIN wardrobe.garment_state s ON s.garment_id=g.id WHERE g.household_id=:h ORDER BY g.id"
                    ),
                    {"h": identity("household")},
                )
            ).mappings()
        ]
        original = [g for g in gs if g["attributes"].get("stage_b_namespace") != NS]
        if len(original) != 76:
            raise RuntimeError("Expected preserved original76")
        assets = {
            str(x["id"]): dict(x)
            for x in (
                await c.execute(
                    text("SELECT * FROM wardrobe.asset WHERE household_id=:h"),
                    {"h": identity("household")},
                )
            ).mappings()
        }
        reusable = [
            g
            for g in original
            if not str(g["attributes"].get("approved_instance_id", "")).startswith(
                ("A", "B", "C")
            )
            and g["category"] in ["TOP", "BOTTOM", "OUTER"]
            and g["storage_status"] == "AVAILABLE"
            and assets[str(g["image_asset_id"])]["metadata"]
            .get("scene_sprites", {})
            .get("folded")
        ]
        sources = [
            g
            for g in original
            if str(g["attributes"].get("approved_instance_id", "")).startswith("K")
        ]
        if len(sources) != 3:
            raise RuntimeError("Expected approved K1-K3")
        bins = [
            ("E" + str(i + 1), 990, 1255, y) for i, y in enumerate([150, 269, 386, 509])
        ] + [
            ("F" + str(i + 1), 1298, 1610, y)
            for i, y in enumerate([151, 269, 386, 503, 614, 724, 849])
        ]
        placements = []
        for n in range(66):
            name, left, right, floor = bins[n // 6]
            bin_id = uid("bin:" + name)
            await c.execute(
                text(
                    "INSERT INTO wardrobe.storage_location(id,household_id,name,location_type,capacity_units,attributes) VALUES(:id,:h,:name,'WARDROBE',6,CAST(:a AS jsonb)) ON CONFLICT DO NOTHING"
                ),
                {
                    "id": bin_id,
                    "h": identity("household"),
                    "name": name + " shelf compartment",
                    "a": wire(
                        {
                            "is_demo": True,
                            "stage_b_namespace": NS,
                            "physical_compartment": True,
                        }
                    ),
                },
            )
            await c.execute(
                text(
                    "INSERT INTO wardrobe.lighting_zone(location_id,device_id,anchor_id) VALUES(:l,:d,:a) ON CONFLICT DO NOTHING"
                ),
                {"l": bin_id, "d": original[0]["device_id"], "a": "STAGE-B-" + name},
            )
            if n < len(reusable):
                g = reusable[n]
            else:
                source = sources[n % 3]
                gid = uid("garment:" + str(n))
                attrs = dict(source["attributes"])
                attrs.pop("approved_instance_id", None)
                attrs.update(
                    stage_b_namespace=NS,
                    is_demo=True,
                    physical_instance=str(n),
                    source_garment_id=str(source["id"]),
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.garment(id,household_id,owner_id,device_id,name,category,color,season_tags,image_asset_id,attributes) VALUES(:id,:h,:o,:d,:name,:cat,:color,:tags,:asset,CAST(:a AS jsonb)) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": gid,
                        "h": source["household_id"],
                        "o": source["owner_id"],
                        "d": source["device_id"],
                        "name": source["name"],
                        "cat": source["category"],
                        "color": source["color"],
                        "tags": source["season_tags"],
                        "asset": source["image_asset_id"],
                        "a": wire(attrs),
                    },
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.garment_state(garment_id,location_id,status,location_confidence,last_seen_at) VALUES(:g,:l,'AVAILABLE',1,:now) ON CONFLICT DO NOTHING"
                    ),
                    {"g": gid, "l": bin_id, "now": now},
                )
                g = {**source, "id": gid, "location_id": bin_id}
            side = (n % 6) // 3
            layer = (n % 6) % 3
            w = 108
            h = 22
            x = left + 12 if side == 0 else right - w - 12
            y = floor - 5 - h * (layer + 1)
            geo = {
                "x": x / 1672,
                "y": y / 941,
                "width": w / 1672,
                "height": h / 941,
                "z_index": 20 + layer,
                "approved": True,
                "alignment": "shelf",
            }
            await c.execute(
                text(
                    "INSERT INTO wardrobe.scene_placement(garment_id,source_location_id,compartment_id,geometry,namespace) VALUES(:g,:l,:bin,CAST(:geo AS jsonb),:ns) ON CONFLICT(garment_id) DO UPDATE SET source_location_id=excluded.source_location_id,compartment_id=excluded.compartment_id,geometry=excluded.geometry WHERE scene_placement.namespace=excluded.namespace"
                ),
                {
                    "g": g["id"],
                    "l": g["location_id"],
                    "bin": bin_id,
                    "geo": wire(geo),
                    "ns": NS,
                },
            )
            placements.append(
                {
                    "garment_id": str(g["id"]),
                    "compartment": name,
                    "source_location_id": str(g["location_id"]),
                    "existing": n < len(reusable),
                    "geometry": geo,
                    "source_asset_id": str(g["image_asset_id"]),
                }
            )
        for who in ["mom", "son"]:
            owner = identity(who)
            owned = [g for g in original if g["owner_id"] == owner]
            tops = [g for g in owned if g["category"] == "TOP"]
            bottoms = [g for g in owned if g["category"] == "BOTTOM"]
            if not tops or not bottoms:
                raise RuntimeError("Profile outfit categories missing")
            for n in range(54):
                at = now - timedelta(days=1 + int(n * 88 / 53), hours=n % 4)
                ctx = uid(f"context:{who}:{n}")
                outfit = uid(f"outfit:{who}:{n}")
                weather = {
                    "temperature_c": round(9 + (n % 20) * 0.8, 1),
                    "humidity_pct": 42 + n % 35,
                    "precipitation_mm": 0 if n % 5 else 3,
                    "condition": "CLOUDY" if n % 5 else "RAIN",
                    "_provenance": {
                        "is_demo": True,
                        "namespace": NS,
                        "source": "SYNTHETIC_PAST_EXPERIENCE",
                        "observed_at": at.isoformat(),
                        "season": "AUTUMN" if at.month >= 9 else "SUMMER",
                    },
                }
                schedule = [
                    {
                        "kind": ["WORK", "CASUAL", "MEETING"][n % 3],
                        "starts_at": at.isoformat(),
                        "people": [],
                        "purpose": ["commute", "leisure", "appointment"][n % 3],
                    }
                ]
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.context_snapshot(id,member_id,captured_at,timezone,weather,schedule,location_label,source_mode) VALUES(:id,:m,:at,'Asia/Seoul',CAST(:w AS jsonb),CAST(:s AS jsonb),'Synthetic demo location','MOCK') ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": ctx,
                        "m": owner,
                        "at": at,
                        "w": wire(weather),
                        "s": wire(schedule),
                    },
                )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.outfit(id,member_id,title,status,created_at) VALUES(:id,:m,:t,'ARCHIVED',:at) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": outfit,
                        "m": owner,
                        "t": NS + ":past-experience:" + str(n),
                        "at": at,
                    },
                )
                items = [
                    {
                        "garment_id": str(tops[n % len(tops)]["id"]),
                        "slot": "TOP",
                        "position": 0,
                    },
                    {
                        "garment_id": str(bottoms[(n // 3) % len(bottoms)]["id"]),
                        "slot": "BOTTOM",
                        "position": 0,
                    },
                ]
                for item in items:
                    await c.execute(
                        text(
                            "INSERT INTO wardrobe.outfit_item(outfit_id,garment_id,slot,position) VALUES(:o,:g,:s,0) ON CONFLICT DO NOTHING"
                        ),
                        {"o": outfit, "g": UUID(item["garment_id"]), "s": item["slot"]},
                    )
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.wear_event(id,member_id,outfit_id,context_snapshot_id,worn_at,confirmation_method,confirmation_ref,items_snapshot) VALUES(:id,:m,:o,:c,:at,'ADMIN_MOCK',:ref,CAST(:items AS jsonb)) ON CONFLICT DO NOTHING"
                    ),
                    {
                        "id": uid(f"wear:{who}:{n}"),
                        "m": owner,
                        "o": outfit,
                        "c": ctx,
                        "at": at,
                        "ref": NS + ":synthetic-experience",
                        "items": wire(items),
                    },
                )
            future = [
                {
                    "kind": "MEETING",
                    "starts_at": (now + timedelta(days=2 + i)).isoformat(),
                    "people": [],
                    "purpose": "demo appointment",
                }
                for i in range(2)
            ]
            await c.execute(
                text(
                    "INSERT INTO wardrobe.context_snapshot(id,member_id,captured_at,timezone,weather,schedule,location_label,source_mode) VALUES(:id,:m,:at,'Asia/Seoul',CAST(:w AS jsonb),CAST(:s AS jsonb),'Demo current location','MOCK') ON CONFLICT DO NOTHING"
                ),
                {
                    "id": uid("current-context:" + who),
                    "m": owner,
                    "at": now,
                    "w": wire(
                        {
                            "temperature_c": 16,
                            "humidity_pct": 48,
                            "precipitation_mm": 0,
                            "condition": "CLOUDY",
                            "_provenance": {
                                "is_demo": True,
                                "source": "SYNTHETIC_DEMO_CURRENT",
                                "observed_at": now.isoformat(),
                                "namespace": NS,
                            },
                        }
                    ),
                    "s": wire(future),
                },
            )
            interests = [
                next(g for g in owned if g["category"] == cat)
                for cat in ["TOP", "BOTTOM"]
            ]
            interests.append(
                next((g for g in owned if g["category"] == "OUTER"), owned[-1])
            )
            for n, source in enumerate(interests):
                await c.execute(
                    text(
                        "INSERT INTO wardrobe.liked_item(id,household_id,member_id,product_id,name,category,color,image_asset_id,metadata) VALUES(:id,:h,:m,:p,:name,:cat,:color,:asset,CAST(:a AS jsonb)) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,category=excluded.category,color=excluded.color,image_asset_id=excluded.image_asset_id,metadata=excluded.metadata WHERE liked_item.metadata->>'namespace'=excluded.metadata->>'namespace'"
                    ),
                    {
                        "id": uid(f"liked:{who}:{n}"),
                        "h": source["household_id"],
                        "m": owner,
                        "p": str(
                            source["attributes"]
                            .get("product_reference", {})
                            .get("source_product_id")
                            or source["attributes"]
                            .get("product_reference", {})
                            .get("official_url")
                            or ("demo-catalog:" + source["name"])
                        ),
                        "name": source["name"],
                        "cat": source["category"],
                        "color": source["color"],
                        "asset": source["image_asset_id"],
                        "a": wire(
                            {
                                "is_demo": True,
                                "namespace": NS,
                                "product_reference": source["attributes"].get(
                                    "product_reference", {}
                                ),
                                "basis": "synthetic interest; not ownership or purchase",
                            }
                        ),
                    },
                )
        # Publish fixture provenance through the existing Context DTO source_status.
        contexts = (
            (
                await c.execute(
                    text(
                        "SELECT id,captured_at,weather FROM wardrobe.context_snapshot "
                        "WHERE weather->'_provenance'->>'namespace'=:ns"
                    ),
                    {"ns": NS},
                )
            )
            .mappings()
            .all()
        )
        for context in contexts:
            weather = dict(context["weather"])
            provenance = dict(weather["_provenance"])
            provenance["observed_at"] = context["captured_at"].isoformat()
            provenance["source_status"] = {
                kind: {
                    "source": provenance["source"],
                    "observed_at": context["captured_at"].isoformat(),
                    "freshness": "UNKNOWN",
                    "is_mock": True,
                    "missing_fields": [],
                }
                for kind in ["weather", "schedule"]
            }
            weather["_provenance"] = provenance
            await c.execute(
                text(
                    "UPDATE wardrobe.context_snapshot SET weather=CAST(:w AS jsonb) "
                    "WHERE id=:id AND weather IS DISTINCT FROM CAST(:w AS jsonb)"
                ),
                {"id": context["id"], "w": wire(weather)},
            )
        report = {
            "namespace": NS,
            "reference_date": now.isoformat(),
            "preserved": 76,
            "reused_right": len(reusable),
            "new": 66 - len(reusable),
            "shelf": placements,
            "wear_each": 54,
            "future_each": 2,
            "liked_each": 3,
        }
    (PACKAGE / "reports/STAGE_B_SEED_MANIFEST.json").write_text(
        wire(report), encoding="utf-8"
    )
    await e.dispose()
    print(wire({k: v for k, v in report.items() if k != "shelf"}))


def migrate(connection):
    from alembic import command

    head = connection.execute(
        text("SELECT version_num FROM public.alembic_version")
    ).scalar_one()
    if head not in {"0004_device_integration", "0005_stage_b_data"}:
        raise RuntimeError("Unexpected migration head")
    cfg = Config(str(ROOT / "backend/alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "backend/alembic"))
    cfg.attributes["connection"] = connection
    command.upgrade(cfg, "0005_stage_b_data")


if __name__ == "__main__":
    asyncio.run(seed())
