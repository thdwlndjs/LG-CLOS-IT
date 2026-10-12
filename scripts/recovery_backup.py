"""Back up rebuilt loopback services; original stores are never mounted or written."""

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRESERVED = ROOT / "test-results/recovery-candidates/20261012T101130Z"


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            hasher.update(block)
    return hasher.hexdigest()


def verify_preserved() -> int:
    count = 0
    for name in ["postgres", "minio"]:
        inventory = json.loads((PRESERVED / f"{name}-files-sha256.json").read_text())
        for entry in inventory["files"]:
            path = (PRESERVED / name / entry["path"]).resolve()
            if not path.is_relative_to(PRESERVED / name):
                raise ValueError("Unsafe preserved inventory path")
            if path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
                raise ValueError("Preserved recovery candidate changed")
            count += 1
    return count


def protect(path: Path) -> None:
    if os.name != "nt":
        path.chmod(0o700)
        return
    principal = os.environ["USERDOMAIN"] + "\\" + os.environ["USERNAME"]
    result = subprocess.run(
        ["icacls", str(path), "/inheritance:r", "/grant:r",
         principal + ":(OI)(CI)F", "SYSTEM:(OI)(CI)F"],
        capture_output=True, timeout=10,
    )
    if result.returncode:
        raise RuntimeError("Backup folder ACL protection failed")


def backup(runtime_path: Path, pg_bin: Path, output: Path, actual_redis_rdb: bool = False) -> dict:
    import boto3
    import redis
    from botocore.config import Config

    runtime = json.loads(runtime_path.read_text())
    verified = verify_preserved()
    existing_parent = output.parent
    while not existing_parent.exists():
        existing_parent = existing_parent.parent
    if shutil.disk_usage(existing_parent).free < 512 * 1024 * 1024:
        raise RuntimeError("At least 512 MiB backup-space reserve required")
    output.mkdir(parents=True, exist_ok=False)
    protect(output)
    result = {"target_database": "wardrobe_demo_recovered", "status": "INCOMPLETE",
              "source_preserved_files_verified": verified,
              "started_at": datetime.now(UTC).isoformat(), "objects": [], "redis": []}
    manifest = output / "manifest.json"
    try:
        # Private env only; credentials do not enter command arguments or logs.
        pg_env = {**os.environ, "PGPASSWORD": runtime["postgres_password"]}
        pg_env.pop("PGOPTIONS", None)
        dump = output / "wardrobe.dump"
        process = subprocess.run(
            [str(pg_bin / "pg_dump.exe"), "-h", "127.0.0.1", "-p", "57433",
             "-U", "wardrobe", "-d", "wardrobe_demo_recovered", "-Fc", "-f", str(dump)],
            env=pg_env, capture_output=True, timeout=180,
        )
        if process.returncode:
            raise RuntimeError("PG dump failed; partial backup retained")
        listing = subprocess.run(
            [str(pg_bin / "pg_restore.exe"), "--list", str(dump)],
            capture_output=True, timeout=15,
        )
        if listing.returncode:
            raise RuntimeError("Archive listing failed; not a valid backup")
        (output / "archive-list.txt").write_bytes(listing.stdout)
        result["postgres"] = {"bytes": dump.stat().st_size, "sha256": digest(dump),
                              "archive_list_pass": True, "actual_restore_test": "NOT_RUN"}
        client = boto3.client(
            "s3", endpoint_url="http://127.0.0.1:19100",
            aws_access_key_id=runtime["storage_access"],
            aws_secret_access_key=runtime["storage_secret"], region_name="us-east-1",
            config=Config(connect_timeout=5, read_timeout=15,
                          retries={"max_attempts": 0}),
        )
        try:
            objects = output / "objects"
            objects.mkdir()
            for page in client.get_paginator("list_objects_v2").paginate(Bucket="wardrobe-assets"):
                for item in page.get("Contents", []):
                    path = objects / str(len(result["objects"]))
                    response = client.get_object(Bucket="wardrobe-assets", Key=item["Key"])
                    with response["Body"] as body, path.open("xb") as target:
                        while chunk := body.read(1024 * 1024):
                            target.write(chunk)
                    if path.stat().st_size != item["Size"]:
                        raise ValueError("Object changed or was truncated")
                    result["objects"].append({"key": item["Key"], "file": path.name,
                                              "bytes": path.stat().st_size,
                                              "sha256": digest(path)})
        finally:
            client.close()
        probe = redis.Redis(host="127.0.0.1", port=16479, socket_timeout=5)
        try:
            databases = probe.info("keyspace")
        finally:
            probe.close()
        for label in sorted(databases):
            db = int(label.removeprefix("db"))
            connection = redis.Redis(host="127.0.0.1", port=16479, db=db, socket_timeout=5)
            try:
                entries = []
                for key in connection.scan_iter():
                    # Reads only; not a transactionally consistent cross-key snapshot.
                    pipe = connection.pipeline(transaction=False)
                    data, ttl = pipe.dump(key).pttl(key).execute()
                    if data is None:
                        continue
                    entries.append({"key_b64": base64.b64encode(key).decode(),
                                    "dump_b64": base64.b64encode(data).decode(),
                                    "expires_at_ms": int(time.time() * 1000) + ttl if ttl >= 0 else None})
                path = output / f"redis-db{db}.json"
                path.write_text(json.dumps(entries))
                result["redis"].append({"db": db, "keys": len(entries), "sha256": digest(path)})
            finally:
                connection.close()
        if actual_redis_rdb:
            # Only the copied new Redis, never the original handoff volume.
            container = "wardrobe-recovery-demo-redis-1"
            remote = "/tmp/recovery-export-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".rdb"
            exported = subprocess.run(
                ["docker", "exec", container, "redis-cli", "--rdb", remote],
                capture_output=True, timeout=120,
            )
            if exported.returncode:
                raise RuntimeError("New Redis RDB export failed; no retry")
            checked = subprocess.run(
                ["docker", "exec", container, "redis-check-rdb", remote],
                capture_output=True, timeout=15,
            )
            if checked.returncode:
                raise RuntimeError("New Redis RDB format validation failed")
            (output / "redis-check-rdb.txt").write_bytes(checked.stdout)
            rdb = output / "redis.rdb"
            copied = subprocess.run(
                ["docker", "cp", container + ":" + remote, str(rdb)],
                capture_output=True, timeout=30,
            )
            if copied.returncode:
                raise RuntimeError("Redis RDB host copy failed")
            result["redis_rdb"] = {"bytes": rdb.stat().st_size, "sha256": digest(rdb),
                                   "redis_check_rdb_pass": True, "container": container,
                                   "new_volume_only": True, "load_test": "NOT_RUN"}
        result["source_preserved_files_verified_after"] = verify_preserved()
        result["status"] = "COMPLETE_FILES_ONLY"
        result["consistency_limit"] = "DB snapshot is not atomic with S3 or Redis; Redis per-key export"
        return result
    finally:
        manifest.write_text(json.dumps(result, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approved-new-target-backup", action="store_true")
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--pg-bin", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--approved-new-redis-rdb", action="store_true")
    args = parser.parse_args()
    runtime, output = args.runtime.resolve(), args.output.resolve()
    if not args.approved_new_target_backup:
        parser.error("Explicit backup approval required")
    if runtime != ROOT / "test-results/recovery-normalization/runtime.json":
        parser.error("Only new rebuilt runtime accepted")
    if not output.is_relative_to(ROOT / "test-results/rebuilt-backups"):
        parser.error("Backup outside original/preserved volumes required")
    result = backup(runtime, args.pg_bin.resolve(), output, args.approved_new_redis_rdb)
    print(json.dumps({"status": result["status"], "objects": len(result["objects"])}))


if __name__ == "__main__":
    main()
