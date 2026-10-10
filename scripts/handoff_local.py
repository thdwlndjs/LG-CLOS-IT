"""Disposable P3 evidence DB. Never reads the project's DATABASE_URL or .env.

Run with the workspace virtualenv: python scripts/handoff_local.py prepare|verify|rollback.
Credentials stay in ignored test-results/handoff/runtime.json; output is counts only.
"""

import argparse
import asyncio
import csv
import json
import secrets
import subprocess
import sys
import time
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
PACKAGE = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"
RUNTIME = ROOT / "test-results/handoff/runtime.json"
CONTAINER = "wardrobe-handoff-p3-db"
PORT = 56433
DATABASE = "wardrobe_test_handoff"
NAMESPACE = "smart-wardrobe-handoff-2026-10-11"


def identity(name):
    return uuid5(NAMESPACE_URL, NAMESPACE + ":" + name)


def docker(*args, **kwargs):
    return subprocess.run(
        ["docker", *args], check=True, capture_output=True, text=True, **kwargs
    )


def prepare():
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    if not RUNTIME.exists():
        existing = subprocess.run(["docker", "inspect", CONTAINER], capture_output=True)
        if existing.returncode == 0:
            raise RuntimeError(
                "Existing container without our credential manifest; do not overwrite"
            )
        import os

        password = secrets.token_urlsafe(32)
        env = {**os.environ, "POSTGRES_PASSWORD": password}
        docker(
            "run",
            "-d",
            "--name",
            CONTAINER,
            "--label",
            "wardrobe.handoff=2026-10-11",
            "-p",
            f"127.0.0.1:{PORT}:5432",
            "--tmpfs",
            "/var/lib/postgresql/data",
            "-e",
            "POSTGRES_PASSWORD",
            "-e",
            "POSTGRES_DB=" + DATABASE,
            "postgres:16.8-bookworm",
            env=env,
        )
        RUNTIME.write_text(json.dumps({"password": password}), encoding="utf-8")
    info = json.loads(docker("inspect", CONTAINER).stdout)[0]
    if info["Config"]["Labels"].get("wardrobe.handoff") != "2026-10-11":
        raise RuntimeError("Container identity mismatch")
    if not info["State"]["Running"]:
        raise RuntimeError(
            "Disposable container stopped; start explicitly without recreating"
        )
    for _ in range(30):
        if (
            subprocess.run(
                ["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"],
                capture_output=True,
            ).returncode
            == 0
        ):
            prepare_test_services()
            return
        time.sleep(1)
    raise RuntimeError("Disposable PostgreSQL not ready")


def prepare_test_services():
    """Dedicated object store/Redis; never use cloud storage credentials."""
    import os
    import boto3

    runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
    if "demo_password" not in runtime:
        runtime["demo_password"] = secrets.token_urlsafe(24)
        RUNTIME.write_text(json.dumps(runtime), encoding="utf-8")
    if "storage_secret" not in runtime:
        runtime["storage_secret"] = secrets.token_urlsafe(32)
        RUNTIME.write_text(json.dumps(runtime), encoding="utf-8")
    services = (
        (
            "wardrobe-handoff-minio",
            [
                "-p",
                "127.0.0.1:19000:9000",
                "-e",
                "MINIO_ROOT_USER",
                "-e",
                "MINIO_ROOT_PASSWORD",
                "--tmpfs",
                "/data:uid=10001,gid=10001,mode=0700",
                "smart-wardrobe-minio:RELEASE.2025-04-22T22-12-26Z-local",
                "server",
                "/data",
            ],
            {
                **os.environ,
                "MINIO_ROOT_USER": "handoff-local",
                "MINIO_ROOT_PASSWORD": runtime["storage_secret"],
            },
        ),
        (
            "wardrobe-handoff-redis",
            ["-p", "127.0.0.1:16379:6379", "redis:7.4.2-alpine"],
            os.environ.copy(),
        ),
    )
    for name, args, env in services:
        found = subprocess.run(
            ["docker", "inspect", name], capture_output=True, text=True
        )
        if found.returncode:
            docker(
                "run",
                "-d",
                "--name",
                name,
                "--label",
                "wardrobe.handoff=2026-10-11",
                *args,
                env=env,
            )
        else:
            info = json.loads(found.stdout)[0]
            if info["Config"]["Labels"].get("wardrobe.handoff") != "2026-10-11":
                raise RuntimeError("Test service identity mismatch")
            if not info["State"]["Running"]:
                docker("start", name)
    client = boto3.client(
        "s3",
        endpoint_url="http://127.0.0.1:19000",
        region_name="us-east-1",
        aws_access_key_id="handoff-local",
        aws_secret_access_key=runtime["storage_secret"],
    )
    for attempt in range(30):
        try:
            client.list_buckets()
            break
        except Exception:
            if attempt == 29:
                raise RuntimeError("Dedicated storage unavailable") from None
            time.sleep(1)
    if not any(
        b["Name"] == "wardrobe-assets" for b in client.list_buckets()["Buckets"]
    ):
        client.create_bucket(Bucket="wardrobe-assets")
    client.close()


def test_environment():
    import os

    runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
    return {
        **os.environ,
        "PYTHONPATH": str(ROOT / "backend"),
        "APP_ENV": "test",
        "PUBLIC_DEPLOYMENT": "false",
        "AUTH_MODE": "DEMO",
        "DEMO_AUTH_ENABLED": "true",
        "TEST_DATABASE_URL": f"postgresql+asyncpg://postgres:{runtime['password']}@127.0.0.1:{PORT}/wardrobe_test",
        "DATABASE_URL": f"postgresql+asyncpg://postgres:{runtime['password']}@127.0.0.1:{PORT}/{DATABASE}",
        "STORAGE_PROVIDER": "MINIO",
        "STORAGE_ENDPOINT": "http://127.0.0.1:19000",
        "STORAGE_PUBLIC_BASE_URL": "http://127.0.0.1:19000",
        "STORAGE_ACCESS_KEY": "handoff-local",
        "STORAGE_SECRET_KEY": runtime["storage_secret"],
        "STORAGE_BUCKET": "wardrobe-assets",
        "REDIS_URL": "redis://127.0.0.1:16379/0",
        "VTON_PROVIDER": "MOCK",
        "TEST_CARD_RENDERER_URL": "http://127.0.0.1:3300",
    }


def engine():
    # No URL/config override accepted; fixed loopback and dedicated DB only.
    password = json.loads(RUNTIME.read_text(encoding="utf-8"))["password"]
    return create_async_engine(
        f"postgresql+asyncpg://postgres:{password}@127.0.0.1:{PORT}/{DATABASE}"
    )


def candidates():
    with (PACKAGE / "templates/product_candidates.csv").open(encoding="utf-8-sig") as f:
        return [r for r in csv.DictReader(f) if r["product_verification"] == "verified"]


async def seed(connection):
    household = identity("household")
    await connection.execute(
        text(
            "INSERT INTO wardrobe.household(id,name) VALUES(:id,:n) "
            "ON CONFLICT(id) DO NOTHING"
        ),
        {"id": household, "n": NAMESPACE},
    )
    for owner, name, role in (
        ("mom", "엄마 · 합성 데모", "OWNER"),
        ("son", "아들 · 합성 데모", "MEMBER"),
    ):
        await connection.execute(
            text(
                "INSERT INTO wardrobe.member(id,household_id,display_name,role) "
                "VALUES(:id,:h,:n,:r) ON CONFLICT(id) DO NOTHING"
            ),
            {"id": identity(owner), "h": household, "n": name, "r": role},
        )
    from app.core.passwords import hash_password

    password = json.loads(RUNTIME.read_text(encoding="utf-8"))["demo_password"]
    for owner in ("mom", "son"):
        await connection.execute(
            text(
                "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                "VALUES(:id,:login,:hash) ON CONFLICT(member_id) DO NOTHING"
            ),
            {
                "id": identity(owner),
                "login": "handoff-" + owner,
                "hash": hash_password(password),
            },
        )
    device = await connection.scalar(
        text("SELECT id FROM wardrobe.device WHERE household_id=:h"), {"h": household}
    )
    for loc in ("WARDROBE", "EXT-room2", "EXT-entry"):
        await connection.execute(
            text(
                "INSERT INTO wardrobe.storage_location(id,household_id,name,location_type,attributes) "
                "VALUES(:id,:h,:n,:type,CAST(:a AS jsonb)) ON CONFLICT(id) DO NOTHING"
            ),
            {
                "id": identity(loc),
                "h": household,
                "n": loc,
                "type": "WARDROBE" if loc == "WARDROBE" else "BOX",
                "a": json.dumps({"is_demo": True, "capacity_verified": False}),
            },
        )
    created = 0
    for row in candidates():
        attrs = {
            "is_demo": True,
            "seed_namespace": NAMESPACE,
            "instance_id": "ITEM-" + row["candidate_id"],
            "product_reference": {
                k: row[k]
                for k in (
                    "candidate_id",
                    "brand",
                    "product_name",
                    "model_or_sku",
                    "official_product_url",
                    "evidence_checked_at",
                    "product_verification",
                )
            },
            "image_status": "BLOCKED_PERMISSION_OR_SOURCE",
            "location_status": "UNKNOWN",
        }
        gid = identity("ITEM-" + row["candidate_id"])
        values = {
            "id": gid,
            "h": household,
            "m": identity(row["owner_role_proposed"]),
            "d": device,
            "n": row["product_name"],
            "c": row["category"].upper(),
            "color": row["color_verified"],
            "material": row["material_verified"],
            "a": json.dumps(attrs),
        }
        current = await connection.scalar(
            text("SELECT attributes FROM wardrobe.garment WHERE id=:id"), {"id": gid}
        )
        if current is not None and current != attrs:
            raise RuntimeError(
                "Seed manifest changed or item edited; refusing overwrite"
            )
        result = await connection.execute(
            text(
                "INSERT INTO wardrobe.garment(id,household_id,owner_id,device_id,name,category,color,material,attributes) "
                "VALUES(:id,:h,:m,:d,:n,:c,:color,:material,CAST(:a AS jsonb)) "
                "ON CONFLICT(id) DO NOTHING"
            ),
            values,
        )
        created += result.rowcount
        await connection.execute(
            text(
                "INSERT INTO wardrobe.garment_state(garment_id,status) VALUES(:id,'UNKNOWN') "
                "ON CONFLICT(garment_id) DO NOTHING"
            ),
            {"id": gid},
        )
    return created


async def counts(connection):
    household = identity("household")
    result = {}
    for table in ("member", "device", "garment", "storage_location"):
        result[table] = await connection.scalar(
            text(f"SELECT count(*) FROM wardrobe.{table} WHERE household_id=:h"),
            {"h": household},
        )
    result["located"] = await connection.scalar(
        text(
            "SELECT count(*) FROM wardrobe.garment_state s JOIN wardrobe.garment g "
            "ON g.id=s.garment_id WHERE g.household_id=:h AND s.location_id IS NOT NULL"
        ),
        {"h": household},
    )
    return result


async def rollback(connection):
    h = identity("household")
    # Fail closed if a subsequent user action references an item.
    for table in ("outfit", "storage_action", "asset", "wear_event"):
        if table == "wear_event":
            query = "SELECT count(*) FROM wardrobe.wear_event WHERE member_id IN (SELECT id FROM wardrobe.member WHERE household_id=:h)"
        elif table == "outfit":
            query = "SELECT count(*) FROM wardrobe.outfit WHERE member_id IN (SELECT id FROM wardrobe.member WHERE household_id=:h)"
        else:
            query = f"SELECT count(*) FROM wardrobe.{table} WHERE household_id=:h"
        if await connection.scalar(text(query), {"h": h}):
            raise RuntimeError("Dependent user data exists; manual rollback required")
    expected = {identity("ITEM-" + r["candidate_id"]) for r in candidates()}
    rows = (
        await connection.execute(
            text("SELECT id,attributes FROM wardrobe.garment WHERE household_id=:h"),
            {"h": h},
        )
    ).all()
    if any(
        r.id not in expected or r.attributes.get("seed_namespace") != NAMESPACE
        for r in rows
    ):
        raise RuntimeError("Unexpected household inventory; refusing rollback")
    changed = await connection.scalar(
        text(
            "SELECT count(*) FROM wardrobe.garment g "
            "LEFT JOIN wardrobe.garment_state s ON s.garment_id=g.id "
            "WHERE g.household_id=:h AND (g.version<>1 OR g.image_asset_id IS NOT NULL "
            "OR g.retired_at IS NOT NULL OR s.version<>1 OR s.location_id IS NOT NULL "
            "OR s.status<>'UNKNOWN' OR s.last_seen_at IS NOT NULL)"
        ),
        {"h": h},
    )
    if changed:
        raise RuntimeError("Seed items changed through application; refusing rollback")
    locations = (
        (
            await connection.execute(
                text(
                "SELECT id,attributes,capacity_units FROM wardrobe.storage_location WHERE household_id=:h"
                ),
                {"h": h},
            )
        )
        .mappings()
        .all()
    )
    allowed_locations = {identity(x) for x in ("WARDROBE", "EXT-room2", "EXT-entry")}
    if any(
        r["id"] not in allowed_locations
        or r["capacity_units"] is not None
        or r["attributes"] != {"is_demo": True, "capacity_verified": False}
        for r in locations
    ):
        raise RuntimeError("Unexpected or edited location; refusing rollback")
    for statement in (
        "DELETE FROM wardrobe.garment_state WHERE garment_id IN (SELECT id FROM wardrobe.garment WHERE household_id=:h)",
        "DELETE FROM wardrobe.garment WHERE household_id=:h",
        "DELETE FROM wardrobe.storage_location WHERE household_id=:h",
        "DELETE FROM wardrobe.device_member WHERE household_id=:h",
        "DELETE FROM wardrobe.device WHERE household_id=:h",
        "DELETE FROM wardrobe.account_credential WHERE member_id IN (SELECT id FROM wardrobe.member WHERE household_id=:h)",
        "DELETE FROM wardrobe.member_settings WHERE member_id IN (SELECT id FROM wardrobe.member WHERE household_id=:h)",
        "DELETE FROM wardrobe.member WHERE household_id=:h",
        "DELETE FROM wardrobe.household WHERE id=:h",
    ):
        await connection.execute(text(statement), {"h": h})


async def run(mode):
    db = engine()
    try:
        if mode == "prepare":
            from alembic import command
            from alembic.config import Config

            async with db.begin() as c:

                def migrate(sync):
                    config = Config(str(ROOT / "backend/alembic.ini"))
                    config.attributes["connection"] = sync
                    command.upgrade(config, "head")

                await c.run_sync(migrate)
                print(json.dumps({"created": await seed(c), "counts": await counts(c)}))
        elif mode == "verify":
            async with db.begin() as c:
                assert await seed(c) == 0
                before = await counts(c)
                assert (
                    before["garment"] == 11
                    and before["member"] == 2
                    and before["located"] == 0
                )
                nested = await c.begin_nested()
                await rollback(c)
                assert (await counts(c))["garment"] == 0
                await nested.rollback()
                assert await counts(c) == before
                print(
                    json.dumps(
                        {
                            "idempotent": True,
                            "rollback_savepoint": True,
                            "counts": before,
                        }
                    )
                )
        else:
            async with db.begin() as c:
                await rollback(c)
                print(json.dumps({"rollback": await counts(c)}))
    finally:
        await db.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("prepare", "verify", "rollback", "serve"))
    mode = parser.parse_args().mode
    if mode == "prepare":
        prepare()
    if mode == "serve":
        import os

        runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
        if "jwt_secret" not in runtime:
            runtime["jwt_secret"] = secrets.token_urlsafe(48)
            RUNTIME.write_text(json.dumps(runtime), encoding="utf-8")
        env = test_environment()
        env.update(
            JWT_SECRET=runtime["jwt_secret"],
            WORKER_EXECUTION="INLINE",
            CARD_RENDERER_URL="http://127.0.0.1:3300",
            DECART_API_KEY="",
            PUBLIC_DEMO_LOGIN_ENABLED="false",
            STORAGE_PUBLIC_BASE_URL="http://localhost:9000",
            N8N_ENABLED="false",
            LED_OFF_SECONDS="10",
            CELERY_BROKER_URL="redis://127.0.0.1:16379/0",
            CELERY_RESULT_BACKEND="redis://127.0.0.1:16379/1",
        )
        os.environ.update(env)
        import uvicorn
        from app.main import create_app

        uvicorn.run(create_app(), host="127.0.0.1", port=18080)
    else:
        asyncio.run(run(mode))
