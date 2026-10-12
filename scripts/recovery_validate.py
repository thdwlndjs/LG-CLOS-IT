"""Probe disposable native working copies; never use Docker or application URLs."""

import argparse
import asyncio
import ctypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results/recovery-phase1"
WORK = Path.home() / "AppData/Local/SmartWardrobeRecovery/20261012-native-v1"
PG = ROOT / "test-results/recovery-tools/postgres16/pgsql/bin"
MINIO = ROOT / "test-results/recovery-tools/minio-win-v1/minio.windows-amd64.RELEASE.2025-04-22T22-12-26Z.exe"


def available_memory():
    class Memory(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in
            ("total", "available", "page_total", "page_available", "virtual_total",
             "virtual_available", "extended")
        ]
    value = Memory()
    value.length = ctypes.sizeof(value)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
        raise RuntimeError("Cannot verify host memory")
    return value.available


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, default=str), encoding="utf-8")


async def sql_probe():
    import asyncpg

    connection = await asyncpg.connect(host="127.0.0.1", port=57444, user="wardrobe",
                                       database="wardrobe", timeout=5)
    report = {}
    try:
        async with connection.transaction(readonly=True):
            report["databases"] = [dict(row) for row in await connection.fetch(
                "SELECT datname FROM pg_database WHERE NOT datistemplate")]
        databases = report["databases"]
    finally:
        await connection.close()
    report["database_details"] = {}
    for database in databases:
        connection = await asyncpg.connect(host="127.0.0.1", port=57444, user="wardrobe",
                                           database=database["datname"], timeout=5)
        try:
            async with connection.transaction(readonly=True):
                tables = await connection.fetch("SELECT table_schema,table_name FROM information_schema.tables "
                                                "WHERE table_schema IN ('public','wardrobe') "
                                                "AND table_type='BASE TABLE' ORDER BY 1,2")
                counts = {}
                row_hashes = {}
                for row in tables:
                    schema, table = row["table_schema"], row["table_name"]
                    counts[f"{schema}.{table}"] = await connection.fetchval(
                        f'SELECT count(*) FROM "{schema}"."{table}"')
                    values = await connection.fetch(f'SELECT to_jsonb(t)::text AS value FROM "{schema}"."{table}" t')
                    row_hashes[f"{schema}.{table}"] = hashlib.sha256(
                        "\n".join(sorted(row["value"] for row in values)).encode()).hexdigest()
                detail = {"tables": counts, "row_hashes": row_hashes, "revision": None}
                if "public.alembic_version" in counts:
                    detail["revision"] = await connection.fetchval("SELECT version_num FROM public.alembic_version")
                detail["foreign_keys"] = [dict(row) for row in await connection.fetch(
                    "SELECT c.conname,c.convalidated,pg_get_constraintdef(c.oid) AS definition "
                    "FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace "
                    "WHERE c.contype='f' AND n.nspname='wardrobe' ORDER BY c.conname")]
                definitions = await connection.fetch("""
                    SELECT c.conname,c.confmatchtype,n.nspname AS source_schema,t.relname AS source_table,
                           pn.nspname AS parent_schema,pt.relname AS parent_table,
                           array_agg(a.attname ORDER BY k.ord) AS source_columns,
                           array_agg(pa.attname ORDER BY k.ord) AS parent_columns
                    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class pt ON pt.oid=c.confrelid
                    JOIN pg_namespace pn ON pn.oid=pt.relnamespace
                    JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(src,dst,ord) ON true
                    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.src
                    JOIN pg_attribute pa ON pa.attrelid=pt.oid AND pa.attnum=k.dst
                    WHERE c.contype='f' AND n.nspname='wardrobe'
                    GROUP BY c.oid,c.conname,c.confmatchtype,n.nspname,t.relname,pn.nspname,pt.relname
                """)
                def quote(value):
                    return '"' + value.replace('"', '""') + '"'
                detail["foreign_key_orphans"] = {}
                for foreign in definitions:
                    source = quote(foreign["source_schema"]) + "." + quote(foreign["source_table"])
                    parent = quote(foreign["parent_schema"]) + "." + quote(foreign["parent_table"])
                    comparisons = " AND ".join(f"s.{quote(a)}=p.{quote(b)}" for a,b in
                                               zip(foreign["source_columns"], foreign["parent_columns"]))
                    null_join = " OR " if foreign["confmatchtype"] == "f" else " AND "
                    present = null_join.join(f"s.{quote(a)} IS NOT NULL" for a in foreign["source_columns"])
                    detail["foreign_key_orphans"][foreign["conname"]] = await connection.fetchval(
                        f"SELECT count(*) FROM {source} s WHERE ({present}) "
                        f"AND NOT EXISTS (SELECT 1 FROM {parent} p WHERE {comparisons})")
                if "wardrobe.asset" in counts:
                    detail["assets"] = [dict(row) for row in await connection.fetch(
                        "SELECT id,asset_key,content_type,status::text,metadata->>'checksum_sha256' AS sha256 "
                        "FROM wardrobe.asset")]
                if "wardrobe.garment" in counts:
                    detail["garment_ids"] = [str(row["id"]) for row in await connection.fetch("SELECT id FROM wardrobe.garment ORDER BY id")]
                report["database_details"][database["datname"]] = detail
        finally:
            await connection.close()
    save("native-pg-records.json", report)
    print("DB_READ_PASS", {name: {"revision": d["revision"], "garments": d["tables"].get("wardrobe.garment")} for name, d in report["database_details"].items()})


async def backup_restore_probe():
    """Logical backup and restore drill only inside this disposable server."""
    import asyncpg

    backup = WORK / "recovered-wardrobe.dump"
    if backup.exists():
        raise RuntimeError("Refuse to overwrite recovery backup")
    common = ["-h", "127.0.0.1", "-p", "57444", "-U", "wardrobe"]
    subprocess.run([str(PG / "pg_dump.exe"), *common, "-d", "wardrobe", "-Fc", "-f", str(backup)],
                   capture_output=True, timeout=30, check=True)
    listing = subprocess.run([str(PG / "pg_restore.exe"), "--list", str(backup)],
                             capture_output=True, timeout=10, check=True)
    (OUT / "recovered-archive-list.txt").write_bytes(listing.stdout)
    connection = await asyncpg.connect(host="127.0.0.1", port=57444, user="wardrobe",
                                       database="postgres", timeout=5)
    try:
        await connection.execute("CREATE DATABASE wardrobe_recovery_restore_drill TEMPLATE template0")
    finally:
        await connection.close()
    subprocess.run([str(PG / "pg_restore.exe"), *common, "-d", "wardrobe_recovery_restore_drill",
                    "--exit-on-error", "--no-owner", str(backup)], capture_output=True, timeout=30, check=True)
    await sql_probe()
    report = json.loads((OUT / "native-pg-records.json").read_text(encoding="utf-8"))
    source, restored = report["database_details"]["wardrobe"], report["database_details"]["wardrobe_recovery_restore_drill"]
    for field in ("tables", "revision", "garment_ids", "foreign_key_orphans"):
        if source[field] != restored[field]:
            raise RuntimeError(f"Restore drill mismatch: {field}")
    save("native-backup-restore.json", {"backup": str(backup), "bytes": backup.stat().st_size,
                                      "sha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
                                      "archive_list": "PASS", "restore_drill": "PASS",
                                      "compared": ["table counts", "revision", "garment IDs", "FK orphans"]})


async def upgrade_working_target():
    import asyncpg
    from sqlalchemy.ext.asyncio import create_async_engine
    from alembic import command
    from alembic.config import Config as AlembicConfig

    name = "wardrobe_demo_recovered"
    connection = await asyncpg.connect(host="127.0.0.1", port=57444, user="wardrobe", database="postgres", timeout=5)
    try:
        if await connection.fetchval("SELECT 1 FROM pg_database WHERE datname=$1", name):
            raise RuntimeError("Refuse to overwrite existing reconstruction target")
        await connection.execute(f"CREATE DATABASE {name} TEMPLATE template0")
    finally:
        await connection.close()
    subprocess.run([str(PG / "pg_restore.exe"), "-h", "127.0.0.1", "-p", "57444", "-U", "wardrobe",
                    "-d", name, "--exit-on-error", "--no-owner", str(WORK / "recovered-wardrobe.dump")],
                   capture_output=True, timeout=30, check=True)
    engine = create_async_engine(f"postgresql+asyncpg://wardrobe@127.0.0.1:57444/{name}")
    try:
        async with engine.begin() as connection:
            def migrate(sync):
                cfg = AlembicConfig(str(ROOT / "backend/alembic.ini"))
                cfg.set_main_option("script_location", str(ROOT / "backend/alembic"))
                cfg.attributes["connection"] = sync
                command.upgrade(cfg, "0006_fitroom_budget")
            await connection.run_sync(migrate)
    finally:
        await engine.dispose()
    await sql_probe()
    report = json.loads((OUT / "native-pg-records.json").read_text(encoding="utf-8"))
    original = report["database_details"]["wardrobe"]
    target = report["database_details"][name]
    differences = [table for table, digest in original["row_hashes"].items()
                   if table != "public.alembic_version" and target["row_hashes"].get(table) != digest]
    if differences or target["revision"] != "0006_fitroom_budget":
        raise RuntimeError(f"Recovered records changed during migration: {differences}")
    save("native-migration-preservation.json", {"target": name, "revision": target["revision"],
                                              "preserved_table_digests": len(original["row_hashes"])-1,
                                              "differences": differences, "app_switch": False})


def probe_pg(backup_restore=False, upgrade_target=False):
    command = [str(PG / "postgres.exe"), "-D", str(WORK / "postgres"), "-c",
               "config_file=" + (WORK / "postgres-probe.conf").as_posix()]
    with (OUT / "native-pg-startup-ascii.log").open("wb") as log:
        process = subprocess.Popen(command, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        save("native-pg-process-ascii.json", {"pid": process.pid, "command": command})
        try:
            deadline = time.monotonic() + 25
            while process.poll() is None:
                if "ready to accept connections" in (OUT / "native-pg-startup-ascii.log").read_text(errors="replace"):
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError("Working PostgreSQL startup exceeded 25s")
                time.sleep(0.25)
            if process.poll() is not None:
                raise RuntimeError(f"Working PostgreSQL exited {process.returncode}; inspect log")
            asyncio.run(asyncio.wait_for(sql_probe(), timeout=30))
            if backup_restore:
                asyncio.run(backup_restore_probe())
            if upgrade_target:
                asyncio.run(upgrade_working_target())
        finally:
            if process.poll() is None:
                subprocess.run([str(PG / "pg_ctl.exe"), "-D", str(WORK / "postgres"),
                                "-m", "fast", "-w", "-t", "10", "stop"],
                               capture_output=True, timeout=15, check=True)
                process.wait(timeout=10)


def probe_minio():
    import boto3
    import httpx
    from botocore.config import Config
    from io import BytesIO
    from PIL import Image

    access, secret = "recovery-probe", secrets.token_urlsafe(32)
    environment = {**os.environ, "MINIO_ROOT_USER": access, "MINIO_ROOT_PASSWORD": secret,
                   "MINIO_BROWSER": "off", "MINIO_UPDATE": "off", "GOMAXPROCS": "1",
                   "GOMEMLIMIT": "192MiB"}
    command = [str(MINIO), "server", str(WORK / "minio"), "--address", "127.0.0.1:19110",
               "--console-address", "127.0.0.1:19111"]
    with (OUT / "native-minio.log").open("wb") as log:
        process = subprocess.Popen(command, env=environment, stdout=log, stderr=log,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        save("native-minio-process.json", {"pid": process.pid, "command": command, "secret_logged": False})
        try:
            time.sleep(3)
            if process.poll() is not None:
                raise RuntimeError(f"Working MinIO exited {process.returncode}; inspect log")
            with httpx.Client(timeout=5) as client:
                client.get("http://127.0.0.1:19110/minio/health/live").raise_for_status()
            client = boto3.client("s3", endpoint_url="http://127.0.0.1:19110",
                                  aws_access_key_id=access, aws_secret_access_key=secret,
                                  region_name="us-east-1", config=Config(connect_timeout=5, read_timeout=5,
                                                                        retries={"total_max_attempts": 1}))
            objects = []
            for bucket in client.list_buckets()["Buckets"]:
                for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket["Name"]):
                    for item in page.get("Contents", []):
                        response = client.get_object(Bucket=bucket["Name"], Key=item["Key"])
                        body = response["Body"]
                        digest, size, chunks = hashlib.sha256(), 0, []
                        try:
                            for block in iter(lambda: body.read(1024 * 1024), b""):
                                digest.update(block)
                                size += len(block)
                                chunks.append(block)
                        finally:
                            body.close()
                        decoded = None
                        if response.get("ContentType", "").startswith("image/"):
                            with Image.open(BytesIO(b"".join(chunks))) as image:
                                decoded = {"format": image.format, "size": image.size}
                                image.verify()
                        objects.append({"bucket": bucket["Name"], "key": item["Key"],
                                        "bytes": size, "sha256": digest.hexdigest(),
                                        "size_match": size == item["Size"], "image_decode": decoded})
            save("native-minio-objects.json", {"objects": objects})
            print("OBJECT_READ_PASS", len(objects))
        finally:
            if process.poll() is None:
                process.terminate()  # Only this new, disposable working-copy server.
                process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("service", choices=("postgres", "minio"))
    parser.add_argument("--backup-restore-drill", action="store_true")
    parser.add_argument("--upgrade-working-target", action="store_true")
    args = parser.parse_args()
    if available_memory() < 256 * 1024 * 1024:
        raise RuntimeError("Host memory gate: 256MiB minimum, no service started")
    if not WORK.is_dir() or ROOT in WORK.parents:
        raise RuntimeError("Explicit disposable ASCII working copy required")
    if WORK.is_symlink() or any((WORK / name).resolve().parent != WORK.resolve()
                                for name in ("postgres", "minio")):
        raise RuntimeError("Working data must not link outside the disposable directory")
    if args.service == "postgres":
        probe_pg(args.backup_restore_drill, args.upgrade_working_target)
    else:
        probe_minio()


if __name__ == "__main__":
    main()
