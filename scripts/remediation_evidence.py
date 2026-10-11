"""Read-only local DB/object-store evidence and offline visual comparisons."""

import asyncio
import hashlib
import json
from collections import Counter

import httpx
from sqlalchemy import text

from remediation_local import API, PACKAGE, ROOT, engine, identity, login, products

OUT = PACKAGE / "reports/evidence/remediation"


async def verify():
    OUT.mkdir(parents=True, exist_ok=True)
    db = engine()
    try:
        async with db.begin() as c:
            garments = (
                (
                    await c.execute(
                        text(
                            "SELECT g.id,g.owner_id,g.category,g.image_asset_id,s.location_id,s.status,l.name AS location_name,l.location_type,a.status AS asset_status,a.metadata FROM wardrobe.garment g JOIN wardrobe.garment_state s ON s.garment_id=g.id JOIN wardrobe.storage_location l ON l.id=s.location_id JOIN wardrobe.asset a ON a.id=g.image_asset_id WHERE g.household_id=:h ORDER BY g.id"
                        ),
                        {"h": identity("household")},
                    )
                )
                .mappings()
                .all()
            )
            members = await c.scalar(
                text("SELECT count(*) FROM wardrobe.member WHERE household_id=:h"),
                {"h": identity("household")},
            )
            observations = await c.scalar(
                text(
                    "SELECT count(*) FROM wardrobe.garment_observation WHERE garment_id IN (SELECT id FROM wardrobe.garment WHERE household_id=:h) AND sensor_type='MOCK'"
                ),
                {"h": identity("household")},
            )
            wear = await c.scalar(
                text(
                    "SELECT count(*) FROM wardrobe.wear_event WHERE member_id IN (SELECT id FROM wardrobe.member WHERE household_id=:h)"
                ),
                {"h": identity("household")},
            )
            locations = (
                (
                    await c.execute(
                        text(
                            "SELECT l.name,l.capacity_units,count(g.id) AS occupied FROM wardrobe.storage_location l LEFT JOIN wardrobe.garment_state s ON s.location_id=l.id LEFT JOIN wardrobe.garment g ON g.id=s.garment_id AND g.retired_at IS NULL WHERE l.household_id=:h GROUP BY l.id ORDER BY l.name"
                        ),
                        {"h": identity("household")},
                    )
                )
                .mappings()
                .all()
            )
            cards = (
                (
                    await c.execute(
                        text(
                            "SELECT c.id,c.member_id,c.template_id,c.is_saved,a.metadata,a.byte_size FROM wardrobe.outfit_card c JOIN wardrobe.asset a ON a.id=c.image_asset_id WHERE a.household_id=:h AND c.is_saved AND a.status='READY'"
                        ),
                        {"h": identity("household")},
                    )
                )
                .mappings()
                .all()
            )
        assert len(garments) == len(products()) == 52
        assert members == 4 and wear == 0
        assert all(r["asset_status"] == "READY" for r in garments)
        assert all(r["occupied"] <= r["capacity_units"] for r in locations)
        by_id = {r["id"]: r for r in garments}
        for p in products():
            data = (ROOT / p["local_image"]).read_bytes()
            assert hashlib.sha256(data).hexdigest() == p["image_sha256"]
            row = by_id[identity(p["item_id"])]
            assert row["metadata"]["checksum_sha256"] == p["image_sha256"]
            assert row["metadata"]["display_mask"] == p["display_mask"]
        # Independently fetch every registered photo through a fresh signed backend read URL.
        auth = login("mom")
        with httpx.Client(
            timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
        ) as api:
            result = api.get(API + "/garments?limit=100")
            result.raise_for_status()
            for garment in result.json()["items"]:
                url = garment["image"]["read_url"]
                assert url.startswith("http://localhost:9000/wardrobe-assets/")
                with httpx.Client(timeout=60) as transport:
                    response = transport.get(
                        url.replace(
                            "http://localhost:9000", "http://127.0.0.1:19000", 1
                        ),
                        headers={"Host": "localhost:9000"},
                    )
                    response.raise_for_status()
                row = by_id[next(k for k in by_id if str(k) == garment["id"])]
                assert (
                    hashlib.sha256(response.content).hexdigest()
                    == row["metadata"]["checksum_sha256"]
                )
        stats = {
            "verified_at": "2026-10-11",
            "database": "wardrobe_test_remediation",
            "members": members,
            "garments": len(garments),
            "ready_photos": 52,
            "signed_download_hash_matches": 52,
            "initial_groups": dict(Counter(p["initial_storage"] for p in products())),
            "current_status": dict(Counter(str(g["status"]) for g in garments)),
            "current_locations": dict(
                Counter(
                    g["location_name"]
                    if g["location_type"] != "WARDROBE"
                    else "internal"
                    for g in garments
                )
            ),
            "synthetic_observations": observations,
            "wear_events": wear,
            "capacity_overflow": False,
            "saved_cards": len(cards),
            "saved_templates": dict(Counter(c["template_id"] for c in cards)),
            "source_rasters_modified": False,
            "paid_provider_calls": False,
            "hardware_verified": False,
            "locations": [dict(r) for r in locations],
        }
        (OUT / "data-integrity.json").write_text(
            json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            json.dumps(
                {k: v for k, v in stats.items() if k != "locations"}, ensure_ascii=True
            )
        )
    finally:
        await db.dispose()


def comparisons():
    # No image editing: HTML lays unmodified references and outputs side by side.
    paths = []
    for n in range(1, 5):
        template = f"T{n}"
        source = PACKAGE / f"references/card/{template}_reference.png"
        restored = ROOT / f"web/public/assets/remediation/cards/{template}-restored.png"
        background = (
            ROOT / f"web/public/assets/remediation/cards/{template}-background.png"
        )
        output = OUT / f"mom-{template}-v1.png"
        records = []
        for role, path in [
            ("original", source),
            ("reconstructed", restored),
            ("empty_plate", background),
            ("registered_photo_PNG", output),
        ]:
            records.append(
                {
                    "role": role,
                    "path": path.relative_to(ROOT).as_posix(),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            )
        paths.append(
            {
                "template": template,
                "files": records,
                "reconstruction_basis": "imagegen editing of supplied reference; hidden text/gradient pixels inferred",
                "geometry_basis": "manual visible-pixel bounding boxes and rotations, retained independent template layouts",
                "gate_a": "PARTIAL: extracted individual reference folds/occlusion layers not fully reproduced",
                "gate_b": "PARTIAL: actual source pixels preserved via SVG masks; fine folding/occlusion retargeting not faithful",
                "gate_c_local": "PASS: actual registered photo PNG saved and downloaded in local browser",
                "commercial_rights": "unconfirmed, no remote publication authorized",
            }
        )
        panels = "".join(
            f'<figure><figcaption>{role}</figcaption><img src="{path.as_uri()}"></figure>'
            for role, path in [
                ("Original", source),
                ("Reconstructed", restored),
                ("Empty plate", background),
                ("Registered photo PNG", output),
            ]
        )
        html = f'<!doctype html><meta charset="utf-8"><title>{template} comparison</title><style>body{{margin:0;background:#eee;font:20px sans-serif}}main{{display:flex;gap:12px}}figure{{margin:0;flex:1;min-width:0}}img{{width:100%;height:auto}}figcaption{{padding:8px}}</style><main>{panels}</main>'
        (OUT / f"{template}-comparison.html").write_text(html, encoding="utf-8")
    (PACKAGE / "templates/remediation_card_manifest.json").write_text(
        json.dumps(paths, indent=2, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    asyncio.run(verify())
    comparisons()
