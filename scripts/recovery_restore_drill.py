"""Restore NEW disposable database/bucket only, comparing complete table/object hashes."""

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

import asyncpg
import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]


async def fingerprints(password: str, database: str) -> dict:
    connection = await asyncpg.connect(host="127.0.0.1", port=57433, user="wardrobe",
                                      password=password, database=database, timeout=10)
    try:
        async with connection.transaction(readonly=True, isolation="repeatable_read"):
            tables = await connection.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname='wardrobe' ORDER BY tablename"
            )
            result = {}
            for table in tables:
                name = table["tablename"]
                quoted = '"' + name.replace('"', '""') + '"'
                values = await connection.fetch(
                    f"SELECT to_jsonb(t)::text AS row FROM wardrobe.{quoted} t", timeout=20
                )
                rows = sorted(value["row"] for value in values)
                hasher = hashlib.sha256()
                for row in rows:
                    payload = row.encode()
                    hasher.update(len(payload).to_bytes(8, "big"))
                    hasher.update(payload)
                result[name] = {"rows": len(rows), "sha256": hasher.hexdigest()}
            return result
    finally:
        await connection.close()


def drill(runtime: Path, pg_bin: Path, backup: Path, redis_load_test: bool = False) -> dict:
    secrets = json.loads(runtime.read_text())
    manifest = json.loads((backup / "manifest.json").read_text())
    if manifest["status"] != "COMPLETE_FILES_ONLY":
        raise ValueError("Completed verified backup required")
    token = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    database = "wardrobe_restore_drill_" + token
    bucket = "recovery-restore-drill-" + token
    report = {"database": database, "bucket": bucket, "status": "INCOMPLETE"}
    env = {**os.environ, "PGPASSWORD": secrets["postgres_password"]}
    env.pop("PGOPTIONS", None)
    try:
        dump = backup / "wardrobe.dump"
        with dump.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != manifest["postgres"]["sha256"]:
                raise ValueError("Backup archive hash mismatch")
        # Baseline queries only new recovered service; source never accessed.
        before = asyncio.run(fingerprints(secrets["postgres_password"], "wardrobe_demo_recovered"))
        created = subprocess.run(
            [str(pg_bin / "createdb.exe"), "-h", "127.0.0.1", "-p", "57433", "-U", "wardrobe", database],
            env=env, capture_output=True, timeout=15,
        )
        if created.returncode:
            raise RuntimeError("New drill DB creation failed; do not reuse existing DB")
        restored = subprocess.run(
            [str(pg_bin / "pg_restore.exe"), "-h", "127.0.0.1", "-p", "57433", "-U", "wardrobe",
             "--exit-on-error", "--single-transaction", "-d", database, str(dump)],
            env=env, capture_output=True, timeout=180,
        )
        if restored.returncode:
            raise RuntimeError("New drill DB restore failed; partial target retained")
        after = asyncio.run(fingerprints(secrets["postgres_password"], database))
        report["source_table_hashes"] = before
        report["restored_table_hashes"] = after
        report["all_table_hashes_match"] = before == after
        if before != after:
            raise ValueError("DB changed since backup or restored contents differ")
        client = boto3.client(
            "s3", endpoint_url="http://127.0.0.1:19100", region_name="us-east-1",
            aws_access_key_id=secrets["storage_access"], aws_secret_access_key=secrets["storage_secret"],
            config=Config(connect_timeout=5, read_timeout=15, retries={"max_attempts": 0}),
        )
        try:
            # Never clean an existing bucket. Uniquely named bucket must not already exist.
            if bucket in {entry["Name"] for entry in client.list_buckets()["Buckets"]}:
                raise ValueError("Drill bucket already exists")
            client.create_bucket(Bucket=bucket)
            matches = []
            for item in manifest["objects"]:
                path = backup / "objects" / item["file"]
                if path.parent != backup / "objects":
                    raise ValueError("Unsafe object backup path")
                with path.open("rb") as source:
                    if hashlib.file_digest(source, "sha256").hexdigest() != item["sha256"]:
                        raise ValueError("Backup object hash mismatch")
                with path.open("rb") as source:
                    client.put_object(Bucket=bucket, Key=item["key"], Body=source)
                response = client.get_object(Bucket=bucket, Key=item["key"])
                hasher, size = hashlib.sha256(), 0
                with response["Body"] as body:
                    while chunk := body.read(1024 * 1024):
                        hasher.update(chunk)
                        size += len(chunk)
                if hasher.hexdigest() != item["sha256"] or size != item["bytes"]:
                    raise ValueError("Restored object differs")
                matches.append({"key": item["key"], "bytes": size, "sha256": hasher.hexdigest()})
            report["restored_objects"] = matches
            report["all_object_hashes_match"] = True
        finally:
            client.close()
        report["redis_rdb"] = manifest.get("redis_rdb", {"status": "NOT_EXPORTED"})
        if redis_load_test:
            if not manifest.get("redis_rdb", {}).get("redis_check_rdb_pass"):
                raise ValueError("Verified actual RDB required for Redis load drill")
            rdb = backup / "redis.rdb"
            with rdb.open("rb") as source:
                if hashlib.file_digest(source, "sha256").hexdigest() != manifest["redis_rdb"]["sha256"]:
                    raise ValueError("RDB changed before load drill")
            container = "wardrobe-redis-restore-drill-" + token
            launched = subprocess.run(
                ["docker", "run", "-d", "--name", container, "--network", "none",
                 "--user", "redis", "--entrypoint", "redis-server",
                 "--mount", f"type=bind,source={backup},target=/data,readonly",
                 "redis:7.4.2-alpine", "--appendonly", "no",
                 "--save", "", "--dbfilename", "redis.rdb"],
                capture_output=True, timeout=30,
            )
            if launched.returncode:
                raise RuntimeError("Separate read-only Redis load container failed")
            time.sleep(1)
            ping = subprocess.run(["docker", "exec", container, "redis-cli", "PING"],
                                  capture_output=True, timeout=10)
            info = subprocess.run(["docker", "exec", container, "redis-cli", "INFO", "keyspace"],
                                  capture_output=True, timeout=10)
            if ping.returncode or ping.stdout.strip() != b"PONG" or info.returncode:
                raise RuntimeError("Redis RDB load/read failed")
            report["redis_rdb_load"] = {
                "status": "PASS_LOAD_AND_PING", "container": container,
                "keyspace": info.stdout.decode(errors="replace"),
                "original_volume_access": False, "backup_mounted_readonly": True,
                "ports": [], "network": "none",
                "expiry_limit": "Expired keys are legitimately removed during RDB load",
            }
        report["status"] = "PASS_DB_AND_OBJECT_RESTORE"
        report["cleanup"] = "Not performed; disposable drill DB/bucket/Redis container retained"
        return report
    finally:
        (backup / "restore-drill.json").write_text(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approved-new-target-restore", action="store_true")
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--pg-bin", type=Path, required=True)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--approved-isolated-redis-load", action="store_true")
    args = parser.parse_args()
    if not args.approved_new_target_restore:
        parser.error("Explicit new-target restore approval required")
    if args.runtime.resolve() != ROOT / "test-results/recovery-normalization/runtime.json":
        parser.error("New rebuilt runtime only")
    if not args.backup.resolve().is_relative_to(ROOT / "test-results/rebuilt-backups"):
        parser.error("Private new-host backup location required")
    result = drill(args.runtime.resolve(), args.pg_bin.resolve(), args.backup.resolve(),
                   args.approved_isolated_redis_load)
    print(json.dumps({"status": result["status"], "tables": len(result["restored_table_hashes"]),
                      "objects": len(result["restored_objects"])}))


if __name__ == "__main__":
    main()
