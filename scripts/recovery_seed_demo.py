"""Explicit recovered-demo target runner. Never starts containers or changes source manifests."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "test-results/reconstruction-plans/approved104-v1.json"


def validate_target(database_url, api):
    parsed = urlsplit(database_url)
    if (parsed.hostname, parsed.port, parsed.path) != (
        "127.0.0.1",
        57433,
        "/wardrobe_demo_recovered",
    ) or api != "http://127.0.0.1:18083/api/v1":
        raise ValueError("Only isolated persistent recovered-demo target is allowed")


def plan():
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    if len(inventory["rows"]) != 104:
        raise ValueError("Approved104 inventory required")
    package = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"
    for relative, expected in inventory["source_sha256"].items():
        if hashlib.sha256((package / relative).read_bytes()).hexdigest() != expected:
            raise ValueError("Approved input changed: " + relative)
    return inventory


async def remap_created(connection, table, old, desired, household):
    """Restore approved UUIDs only for newly uploaded/registered demo records.

    Insert the approved parent before retargeting catalog-discovered FK columns,
    then remove only the temporary parent. No constraint disabling is used.
    """
    if table not in {"asset", "garment"}:
        raise ValueError("Unsupported restoration table")
    old, desired = UUID(str(old)), UUID(str(desired))
    if old == desired:
        return
    row = (
        (
            await connection.execute(
                text(
                    f'SELECT * FROM wardrobe."{table}" WHERE id=:old AND household_id=:h'
                ),
                {"old": old, "h": household},
            )
        )
        .mappings()
        .one()
    )
    if table == "garment" and not row["attributes"].get("approved_instance_id"):
        raise ValueError("Only newly registered approved demo garments can be remapped")
    if table == "asset" and not (
        row["metadata"].get("approved_original_scene_id")
        or row["metadata"].get("approved_scene_id")
        or row["metadata"].get("provenance", {}).get("item_id")
    ):
        raise ValueError("Only approved uploaded demo assets can be remapped")
    exists = await connection.scalar(
        text(f'SELECT id FROM wardrobe."{table}" WHERE id=:id'), {"id": desired}
    )
    if exists:
        raise ValueError("Approved UUID collision; refusing overwrite")
    columns = [
        r[0]
        for r in (
            await connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema='wardrobe' "
                    "AND table_name=:table ORDER BY ordinal_position"
                ),
                {"table": table},
            )
        ).all()
    ]
    quoted = ",".join('"' + x.replace('"', '""') + '"' for x in columns)
    if table == "asset":
        await connection.execute(
            text("UPDATE wardrobe.asset SET asset_key=:temporary WHERE id=:old"),
            {
                "temporary": row["asset_key"] + ".recovery-temporary-" + str(old),
                "old": old,
            },
        )
    selected = ",".join(
        ":desired"
        if x == "id"
        else ":asset_key"
        if table == "asset" and x == "asset_key"
        else '"' + x.replace('"', '""') + '"'
        for x in columns
    )
    await connection.execute(
        text(
            f'INSERT INTO wardrobe."{table}" ({quoted}) SELECT {selected} FROM wardrobe."{table}" WHERE id=:old'
        ),
        {"desired": desired, "old": old, "asset_key": row.get("asset_key")},
    )
    refs = (
        await connection.execute(
            text(
                "SELECT ns.nspname,cl.relname,att.attname,array_length(con.conkey,1) "
                "FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid "
                "JOIN pg_namespace ns ON ns.oid=cl.relnamespace "
                "JOIN LATERAL unnest(con.conkey,con.confkey) AS keys(local_num,parent_num) ON true "
                "JOIN pg_attribute att ON att.attrelid=cl.oid AND att.attnum=keys.local_num "
                "JOIN pg_attribute parent_att ON parent_att.attrelid=con.confrelid AND parent_att.attnum=keys.parent_num "
                "WHERE con.contype='f' AND con.confrelid=CAST(:parent AS regclass)"
                " AND parent_att.attname='id'"
            ),
            {"parent": "wardrobe." + table},
        )
    ).all()
    for schema, name, column, length in refs:
        if length not in {1, 2}:
            raise ValueError("Unexpected FK requires explicit restoration")

        def quote(x):
            return '"' + x.replace('"', '""') + '"'

        await connection.execute(
            text(
                f"UPDATE {quote(schema)}.{quote(name)} SET {quote(column)}=:desired WHERE {quote(column)}=:old"
            ),
            {"old": old, "desired": desired},
        )
    if table == "asset":
        await connection.execute(
            text(
                "UPDATE wardrobe.asset SET metadata=CAST(replace(metadata::text,:old,:new) AS jsonb) "
                "WHERE household_id=:h AND metadata::text LIKE :pattern"
            ),
            {
                "old": str(old),
                "new": str(desired),
                "h": household,
                "pattern": "%" + str(old) + "%",
            },
        )
    await connection.execute(
        text(f'DELETE FROM wardrobe."{table}" WHERE id=:old AND household_id=:h'),
        {"old": old, "h": household},
    )


async def approved24_restore(engine_factory, runtime_package):
    """Call only after provision_approved wrote its temporary runtime mapping."""
    inventory = plan()
    wanted = {
        row["approved_mapping"]["approved_id"]: row["approved_mapping"]
        for row in inventory["rows"]
        if row["group"] == "approved24"
    }
    manifest_path = runtime_package / "templates/approved_scene_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    engine = engine_factory()
    try:
        async with engine.begin() as connection:
            for current in manifest["mapping"]:
                expected = wanted[current["approved_id"]]
                for field, table in (
                    ("original_asset_id", "asset"),
                    ("scene_asset_id", "asset"),
                    ("garment_id", "garment"),
                ):
                    await remap_created(
                        connection,
                        table,
                        current[field],
                        expected[field],
                        UUID(inventory["household_id"]),
                    )
                current.update(expected)
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    finally:
        await engine.dispose()


async def base_seed(database_url, api, runtime):
    """Reuse the additive base52 seed with explicitly redirected target/runtime."""
    validate_target(database_url, api)
    inventory = plan()
    import remediation_local as source

    before = create_async_engine(database_url)
    try:
        async with before.connect() as connection:
            revision = await connection.scalar(
                text("SELECT version_num FROM public.alembic_version")
            )
            if revision != "0006_fitroom_budget":
                raise ValueError("Verified revision0006 target required")
            triggers = set(
                (
                    await connection.execute(
                        text(
                            "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN "
                            "('initial_household_device','initial_member_device')"
                        )
                    )
                ).scalars()
            )
            if triggers != {"initial_household_device", "initial_member_device"}:
                raise ValueError(
                    "Migration-managed household/device bootstrap triggers missing"
                )
            preserved = [
                dict(row)
                for row in (
                    await connection.execute(
                        text(
                            "SELECT id,owner_id,image_asset_id,attributes FROM wardrobe.garment "
                            "WHERE household_id<>:h ORDER BY id"
                        ),
                        {"h": source.identity("household")},
                    )
                ).mappings()
            ]
        source.engine = lambda: create_async_engine(database_url)
        source.DATABASE = "wardrobe_demo_recovered"
        source.API = api
        source.RUNTIME = runtime
        await source.seed()
        async with before.connect() as connection:
            devices = (
                (
                    await connection.execute(
                        text("SELECT id FROM wardrobe.device WHERE household_id=:h"),
                        {"h": source.identity("household")},
                    )
                )
                .scalars()
                .all()
            )
            if len(devices) != 1:
                raise RuntimeError(
                    "Demo household requires one migration-triggered wardrobe device"
                )
            links = await connection.scalar(
                text(
                    "SELECT count(*) FROM wardrobe.device_member WHERE household_id=:h AND device_id=:d"
                ),
                {"h": source.identity("household"), "d": devices[0]},
            )
            if links != 4:
                raise RuntimeError("Four demo member device access links required")
            after = [
                dict(row)
                for row in (
                    await connection.execute(
                        text(
                            "SELECT id,owner_id,image_asset_id,attributes FROM wardrobe.garment "
                            "WHERE household_id<>:h ORDER BY id"
                        ),
                        {"h": source.identity("household")},
                    )
                ).mappings()
            ]
            if preserved != after:
                raise RuntimeError("Recovered rows changed")
        return {
            "base52_seeded": True,
            "recovered_rows_preserved": len(preserved),
            "approved104_expected": len(inventory["rows"]),
            "remaining": "API asset upload + approved UUID restoration + stage28/lifestyle",
        }
    finally:
        await before.dispose()


async def complete_seed(database_url, api, runtime, work):
    """Recover demo data through original APIs; write manifests only to work."""
    import shutil
    import httpx
    from PIL import Image
    import remediation_local as source
    import provision_wardrobe_sprites as sprites
    import stage_b_seed as stage

    validate_target(database_url, api)
    inventory = plan()
    package = source.PACKAGE
    work = work.resolve()
    if not work.is_relative_to(ROOT / "test-results") or work == ROOT / "test-results":
        raise ValueError("Separate ignored recovery work folder required")
    copied = work / "package"
    if not copied.exists():
        shutil.copytree(package / "templates", copied / "templates")
        (copied / "reports").mkdir()
        # Atlas API IDs belong to the lost DB and must be uploaded again.
        path = copied / "templates/wardrobe_sprite_manifest.json"
        atlas = json.loads(path.read_text(encoding="utf-8"))
        for batch in atlas["batches"]:
            batch.pop("atlas_asset_id", None)
        path.write_text(json.dumps(atlas), encoding="utf-8")
    # Original product photographs remain immutable repository sources.
    review = copied / "reports/wardrobe-visual-review"
    if not review.exists():
        review.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(package / "reports/wardrobe-visual-review", review)
    await base_seed(database_url, api, runtime)
    source.PACKAGE = copied
    source.engine = lambda: create_async_engine(database_url)
    source.API, source.RUNTIME = api, runtime

    def upload(client, path, purpose="GARMENT"):
        data = path.read_bytes()
        with Image.open(path) as image:
            mime = Image.MIME[image.format]
        intent = source.call(
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
        parsed = urlsplit(intent["upload_url"])
        if parsed.hostname not in {"localhost", "127.0.0.1"} or parsed.port not in {9000, 19100}:
            raise ValueError("Upload must target new persistent MinIO19100")
        target = intent["upload_url"].replace(parsed.netloc, "127.0.0.1:19100", 1)
        headers = {**intent["required_headers"], "Host": parsed.netloc}
        with httpx.Client(timeout=60) as transport:
            response = transport.put(
                target, content=data, headers=headers
            )
            response.raise_for_status()
        result = source.call(
            client,
            "POST",
            f"/assets/{intent['asset_id']}/finalize",
            json={"checksum_sha256": hashlib.sha256(data).hexdigest()},
        )
        import time
        time.sleep(12)
        return result

    source.upload = upload
    await source.provision()
    engine = source.engine()
    try:
        async with engine.begin() as connection:
            for item in inventory["right66"]:
                if not item.get("item_id"):
                    continue
                garment = source.identity(item["item_id"])
                current = await connection.scalar(
                    text(
                        "SELECT image_asset_id FROM wardrobe.garment WHERE id=:g AND household_id=:h"
                    ),
                    {"g": garment, "h": source.identity("household")},
                )
                if current:
                    await remap_created(
                        connection,
                        "asset",
                        current,
                        item["source_asset_id"],
                        source.identity("household"),
                    )
    finally:
        await engine.dispose()
    sprites.PACKAGE = copied
    sprites.engine, sprites.call, sprites.login, sprites.upload = (
        source.engine,
        source.call,
        source.login,
        upload,
    )
    sprites.MANIFEST = copied / "templates/wardrobe_sprite_manifest.json"
    await sprites.main()
    await sprites.provision_approved()
    await approved24_restore(source.engine, copied)
    auth = source.login("mom")
    engine = source.engine()
    try:
        with httpx.Client(
            timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
        ) as client:
            for item in inventory["right66"]:
                if item["kind"] != "common":
                    continue
                desired = UUID(item["derivative_asset_id"])
                async with engine.connect() as connection:
                    existing = await connection.scalar(
                        text(
                            "SELECT id FROM wardrobe.asset WHERE id=:id AND household_id=:h AND status='READY'"
                        ),
                        {"id": desired, "h": source.identity("household")},
                    )
                if existing:
                    continue
                path = ROOT / item["file"]
                if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
                    raise ValueError("Common shelf asset changed")
                created = UUID(upload(client, path)["asset_id"])
                async with engine.begin() as connection:
                    await connection.execute(
                        text(
                            "UPDATE wardrobe.asset SET kind='OTHER',metadata=metadata || CAST(:m AS jsonb) WHERE id=:id AND household_id=:h"
                        ),
                        {
                            "id": created,
                            "h": source.identity("household"),
                            "m": json.dumps(
                                {
                                    "approved_scene_id": "B01-common:"
                                    + item["garment_id"],
                                    "scene_role": "generated-wardrobe-sprites",
                                    "visual_approval": "user-approved",
                                }
                            ),
                        },
                    )
                    await remap_created(
                        connection,
                        "asset",
                        created,
                        desired,
                        source.identity("household"),
                    )
                await asyncio.sleep(12)
    finally:
        await engine.dispose()
    stage.engine, stage.PACKAGE = source.engine, copied

    def revision_only(connection):
        if (
            connection.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).scalar_one()
            != "0006_fitroom_budget"
        ):
            raise ValueError("Recovered target revision changed")

    stage.migrate = revision_only
    await stage.seed()
    return {
        "expected_garments": 104,
        "work": str(work),
        "original_manifests_modified": False,
        "requires_scene_readback_and_original9_comparison": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply-base52", action="store_true")
    parser.add_argument("--apply-all", action="store_true")
    parser.add_argument("--work", type=Path)
    parser.add_argument("--database-url")
    parser.add_argument("--api", default="http://127.0.0.1:18083/api/v1")
    parser.add_argument("--runtime", type=Path)
    args = parser.parse_args()
    if not args.apply_base52 and not args.apply_all:
        inventory = plan()
        print(json.dumps({"mode": "PLAN_ONLY", "approved": len(inventory["rows"])}))
        return
    if not args.database_url or not args.runtime:
        parser.error("Explicit database URL and private recovery runtime required")
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT / "test-results") or not runtime.is_file():
        parser.error("Existing recovery runtime under test-results required")
    if args.apply_all:
        if not args.work:
            parser.error("--work required")
        result = asyncio.run(
            complete_seed(args.database_url, args.api, runtime, args.work)
        )
    else:
        result = asyncio.run(base_seed(args.database_url, args.api, runtime))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
