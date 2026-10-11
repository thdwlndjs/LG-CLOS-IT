"""Local B-01 common-form export/apply. No production configuration accepted."""

import argparse
import asyncio
import hashlib
import json
from uuid import UUID

import httpx
from sqlalchemy import text

from remediation_local import ROOT, PACKAGE, engine, identity, login, upload, call
from stage_b_idempotence import snapshot

OUT = PACKAGE / "reports/b01-common-v1"
MANIFEST = PACKAGE / "templates/b01_common_shelf_manifest.json"


async def export():
    OUT.mkdir(parents=True, exist_ok=True)
    e = engine()
    try:
        async with e.connect() as c:
            rows = [
                dict(r)
                for r in (
                    await c.execute(
                        text(
                            "SELECT g.id,g.owner_id,g.image_asset_id,g.attributes,g.name,a.metadata,"
                            "p.source_location_id,p.compartment_id,p.geometry,l.name compartment "
                            "FROM wardrobe.scene_placement p JOIN wardrobe.garment g ON g.id=p.garment_id "
                            "JOIN wardrobe.asset a ON a.id=g.image_asset_id "
                            "JOIN wardrobe.storage_location l ON l.id=p.compartment_id "
                            "WHERE g.household_id=:h ORDER BY l.name,p.geometry->>'x',p.geometry->>'z_index'"
                        ),
                        {"h": identity("household")},
                    )
                ).mappings()
            ]
        assert len(rows) == 66 and len({r["id"] for r in rows}) == 66
        order = {
            i["garment_id"]: n
            for n, i in enumerate(
                json.loads(
                    (PACKAGE / "reports/STAGE_B_SEED_MANIFEST.json").read_text(
                        encoding="utf8"
                    )
                )["shelf"]
            )
        }
        rows.sort(key=lambda r: order[str(r["id"])])
        payload = {"namespace": "b01-common-v1", "items": rows}
        if not (OUT / "before.json").exists():
            (OUT / "before.json").write_text(
                json.dumps(payload, default=str, ensure_ascii=False, indent=2),
                encoding="utf8",
            )
            (OUT / "db-before.json").write_text(
                json.dumps(await snapshot(), indent=2), encoding="utf8"
            )
        (OUT / "catalog.json").write_text(
            json.dumps(payload, default=str, ensure_ascii=False, indent=2),
            encoding="utf8",
        )
        print("Exported66 placements; read-only")
    finally:
        await e.dispose()


async def apply():
    manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
    assert len(manifest["items"]) == 66
    e = engine()
    try:
        auth = login("mom")
        with httpx.Client(
            timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
        ) as client:
            if not call(client, "GET", "/settings")["image_upload_consent"]:
                raise RuntimeError("Existing image consent required; not changed")
            for item in manifest["items"]:
                if item["kind"] != "common":
                    continue
                path = ROOT / item["file"]
                assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]
                if not item.get("derivative_asset_id"):
                    item["derivative_asset_id"] = upload(client, path)["asset_id"]
                    MANIFEST.write_text(
                        json.dumps(manifest, ensure_ascii=False, indent=2),
                        encoding="utf8",
                    )
        async with e.begin() as c:
            await c.execute(
                text("SELECT pg_advisory_xact_lock(hashtext('b01-common-v1'))")
            )
            for item in manifest["items"]:
                current = (
                    (
                        await c.execute(
                            text(
                                "SELECT g.image_asset_id,a.metadata,p.source_location_id,p.compartment_id "
                                "FROM wardrobe.garment g JOIN wardrobe.asset a ON a.id=g.image_asset_id "
                                "JOIN wardrobe.scene_placement p ON p.garment_id=g.id "
                                "WHERE g.id=:g AND g.household_id=:h"
                            ),
                            {"g": UUID(item["garment_id"]), "h": identity("household")},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert str(current["image_asset_id"]) == item["source_asset_id"]
                assert str(current["compartment_id"]) == item["compartment_id"]
                assert str(current["source_location_id"]) == item["source_location_id"]
                geometry = dict(item["geometry"])
                assert current["metadata"]["checksum_sha256"] == item["source_sha256"]
                if item["kind"] == "common":
                    asset = UUID(item["derivative_asset_id"])
                    await c.execute(
                        text(
                            "UPDATE wardrobe.asset SET kind='OTHER',metadata=metadata||CAST(:m AS jsonb) "
                            "WHERE id=:a AND household_id=:h AND status='READY' "
                            "AND metadata->>'checksum_sha256'=:sha"
                        ),
                        {
                            "a": asset,
                            "h": identity("household"),
                            "sha": item["sha256"],
                            "m": json.dumps(
                                {
                                    "scene_role": "generated-wardrobe-sprites",
                                    "is_demo": True,
                                    "display_basis": "user-approved common folded shape; color/pattern visualization",
                                    "namespace": "b01-common-v1",
                                    "source_asset_id": item["source_asset_id"],
                                    "source_sha256": item["source_sha256"],
                                    "generation_tool": "local SVG/Chromium",
                                }
                            ),
                        },
                    )
                else:
                    assert (
                        item["derivative_asset_id"]
                        == current["metadata"]["scene_sprites"]["folded"]["asset_id"]
                    )
                geometry["sprite_override"] = {
                    "asset_id": item["derivative_asset_id"],
                    "source_asset_id": item["source_asset_id"],
                    "source_sha256": item["source_sha256"],
                    "mask": item["mask"],
                }
                await c.execute(
                    text(
                        "UPDATE wardrobe.scene_placement SET geometry=CAST(:geo AS jsonb) "
                        "WHERE garment_id=:g AND compartment_id=:comp AND namespace='poc-stage-b-v1'"
                    ),
                    {
                        "geo": json.dumps(geometry),
                        "g": UUID(item["garment_id"]),
                        "comp": UUID(item["compartment_id"]),
                    },
                )
                item["geometry"] = geometry
        MANIFEST.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8"
        )
        print(
            "Applied35 new derivatives and66 geometries; original garment/asset rows preserved"
        )
    finally:
        await e.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["export", "apply"])
    asyncio.run(export() if parser.parse_args().command == "export" else apply())
