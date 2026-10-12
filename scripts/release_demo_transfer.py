"""Add one approved synthetic household; never replace existing cloud rows or objects."""
import argparse
import asyncio
import hashlib
import json
import ssl
from pathlib import Path
from uuid import UUID

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from remediation_local import identity

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results/cloud-release/20261013-v1"
EXCLUDED = {"idempotency_key", "job", "audit_log", "domain_event_outbox", "fitroom_request", "fitroom_audit"}


def canon(row):
    return json.dumps(row, sort_keys=True, separators=(",", ":"))


async def snapshot(connection):
    tables = (await connection.execute(text(
        "SELECT tablename FROM pg_tables WHERE schemaname='wardrobe' ORDER BY tablename"
    ))).scalars().all()
    result = {}
    for table in tables:
        raw = (await connection.execute(text(
            f'SELECT to_jsonb(t)::text FROM wardrobe."{table}" t'
        ))).scalars().all()
        result[table] = [json.loads(row) for row in raw]
    return result


async def transfer(clone, apply):
    runtime = json.loads((ROOT / "test-results/recovery-normalization/runtime.json").read_text())
    cloud = dotenv_values(ROOT / ".env.cloud")
    local = create_async_engine(
        f"postgresql+asyncpg://wardrobe:{runtime['postgres_password']}@127.0.0.1:57433/wardrobe_demo_recovered"
    )
    if clone:
        values = dotenv_values(OUT / "clone.env")
        target = create_async_engine(
            f"postgresql+asyncpg://wardrobe:{values['POSTGRES_PASSWORD']}@127.0.0.1:57434/cloud_clone_verified"
        )
    else:
        if not (OUT / "cloud-before.dump").exists() or not (OUT / "original-objects.json").exists():
            raise ValueError("Verified pre-release DB/object backup required")
        target = create_async_engine(cloud["DATABASE_URL"], connect_args={
            "ssl": ssl.create_default_context(cafile=str(ROOT / "infra/cloud/supabase-ca.crt")),
            "timeout": 10,
        })
    try:
        async with local.connect() as source:
            rows = await snapshot(source)
            fk = (await source.execute(text("""
              SELECT child.relname AS child,parent.relname AS parent,
              ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n,o)
                JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) AS cols,
              ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n,o)
                JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) AS refs
              FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid
              JOIN pg_class parent ON parent.oid=c.confrelid
              WHERE c.contype='f' AND c.connamespace='wardrobe'::regnamespace
            """))).mappings().all()
            keys = (await source.execute(text("""
              SELECT t.relname AS tablename,
              ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n,o)
                JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) AS cols
              FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
              WHERE c.contype='p' AND c.connamespace='wardrobe'::regnamespace
            """))).mappings().all()
        pk = {r["tablename"]: list(r["cols"]) for r in keys}
        household = str(identity("household"))
        members = {str(identity(who)) for who in ["mom", "son", "dad", "daughter"]}
        chosen = {table: {} for table in rows}

        def add(table, row):
            if row.get("household_id") not in (None, household):
                raise ValueError("Reference leaves approved household: " + table)
            chosen[table][canon(row)] = row

        for table, data in rows.items():
            if table in EXCLUDED:
                continue
            for row in data:
                if (row.get("household_id") == household
                        or (table == "household" and row.get("id") == household)
                        or any(row.get(col) in members for col in ["member_id", "owner_id", "actor_id"])):
                    add(table, row)
        # Resolve real FK parents and children, including composite keys.
        changed = True
        while changed:
            before = sum(len(x) for x in chosen.values())
            for ref in fk:
                child, parent = ref["child"], ref["parent"]
                if child in EXCLUDED or parent in EXCLUDED:
                    continue
                if child not in rows or parent not in rows:
                    continue
                parent_values = {tuple(row.get(col) for col in ref["refs"])
                                 for row in chosen[parent].values()}
                child_values = {tuple(row.get(col) for col in ref["cols"])
                                for row in chosen[child].values()
                                if all(row.get(col) is not None for col in ref["cols"])}
                for row in rows[parent]:
                    if tuple(row.get(col) for col in ref["refs"]) in child_values:
                        add(parent, row)
                for row in rows[child]:
                    if row.get("household_id") not in (None, household):
                        continue
                    if tuple(row.get(col) for col in ref["cols"]) in parent_values:
                        add(child, row)
            changed = sum(len(x) for x in chosen.values()) != before
        garments = list(chosen["garment"].values())
        if len(garments) != 104:
            raise ValueError("Approved104 only")
        pending = {table for table, records in chosen.items() if records}
        order = []
        while pending:
            ready = sorted(table for table in pending if not any(
                ref["child"] == table and ref["parent"] in pending and ref["parent"] != table
                for ref in fk
            ))
            if not ready:
                raise ValueError("FK cycle requires explicit handling: " + ",".join(sorted(pending)))
            order.extend(ready)
            pending.difference_update(ready)
        report = {"mode": "CLONE" if clone else "CLOUD", "counts": {
            table: len(records) for table, records in chosen.items() if records
        }, "order": order, "applied": False}
        if apply and not clone:
            async with target.connect() as preflight:
                if await preflight.scalar(text("SELECT version_num FROM public.alembic_version")) != "0006_fitroom_budget":
                    raise ValueError("Verified cloud migration to 0006 required")
                if await preflight.scalar(text("SELECT 1 FROM wardrobe.household WHERE id=:id"),
                                          {"id": UUID(household)}):
                    raise ValueError("Existing household; objects not copied")
                existing = await snapshot(preflight)
                for table in order:
                    old_keys = {tuple(row.get(col) for col in pk[table])
                                for row in existing.get(table, [])}
                    if any(tuple(row.get(col) for col in pk[table]) in old_keys
                           for row in chosen[table].values()):
                        raise ValueError("Existing row collision; objects not copied")
            # Avoid holding an idle managed DB transaction during remote uploads.
            await asyncio.to_thread(copy_objects, cloud, runtime, list(chosen["asset"].values()))
        async with target.begin() as dest:
            old = await snapshot(dest)
            if await dest.scalar(text("SELECT 1 FROM wardrobe.household WHERE id=:id"), {"id": UUID(household)}):
                raise ValueError("Approved household already exists; refuse overwrite")
            for table in order:
                if table not in pk:
                    raise ValueError("No primary key: " + table)
                old_keys = {tuple(row.get(col) for col in pk[table]) for row in old.get(table, [])}
                if any(tuple(row.get(col) for col in pk[table]) in old_keys for row in chosen[table].values()):
                    raise ValueError("Existing primary key collision: " + table)
            if not apply:
                return report
            for table in order:
                for row in chosen[table].values():
                    if table == "device":
                        # household AFTER INSERT created a new empty device. Replace only
                        # that transaction's generated identity, before members are inserted.
                        await dest.execute(text(
                            "UPDATE wardrobe.device SET id=:desired WHERE household_id=:h"
                        ), {"desired": UUID(row["id"]), "h": UUID(household)})
                    exists = await dest.scalar(text(
                        f'SELECT 1 FROM wardrobe."{table}" WHERE ' + " AND ".join(
                            f'"{col}" = (json_populate_record(NULL::wardrobe."{table}",CAST(:row AS json)))."{col}"'
                            for col in pk[table]
                        )
                    ), {"row": canon(row)})
                    if exists:
                        # Only rows created by bootstrap triggers inside this new household.
                        if table not in {"device", "device_member", "member_settings", "member_preferences", "privacy_settings"}:
                            raise ValueError("Unexpected generated row: " + table)
                        cols = [col for col in row if col not in pk[table]]
                        query = f'UPDATE wardrobe."{table}" SET ' + ",".join(
                            f'"{col}"=(json_populate_record(NULL::wardrobe."{table}",CAST(:row AS json)))."{col}"'
                            for col in cols
                        ) + " WHERE " + " AND ".join(
                            f'"{col}"=(json_populate_record(NULL::wardrobe."{table}",CAST(:row AS json)))."{col}"'
                            for col in pk[table]
                        )
                    else:
                        query = f'INSERT INTO wardrobe."{table}" SELECT * FROM json_populate_record(NULL::wardrobe."{table}",CAST(:row AS json))'
                    await dest.execute(text(query), {"row": canon(row)})
            after = await snapshot(dest)
            for table, data in old.items():
                if not {canon(row) for row in data} <= {canon(row) for row in after[table]}:
                    raise ValueError("Existing rows changed: " + table)
            for table in order:
                if not set(chosen[table]) <= {canon(row) for row in after[table]}:
                    raise ValueError("Transferred rows differ: " + table)
            report.update(applied=True, old_rows_preserved=True, transferred_rows_verified=True)
        return report
    finally:
        await local.dispose()
        await target.dispose()


def copy_objects(cloud, runtime, assets):
    options = Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 0})
    source = boto3.client("s3", endpoint_url="http://127.0.0.1:19100", region_name="us-east-1",
                          aws_access_key_id=runtime["storage_access"], aws_secret_access_key=runtime["storage_secret"], config=options)
    target = boto3.client("s3", endpoint_url=cloud["STORAGE_ENDPOINT"], region_name=cloud["STORAGE_REGION"],
                          aws_access_key_id=cloud["STORAGE_ACCESS_KEY"], aws_secret_access_key=cloud["STORAGE_SECRET_KEY"], config=options)
    records = []
    try:
        for asset in assets:
            if asset["status"] != "READY":
                continue
            key = asset["asset_key"]
            data = source.get_object(Bucket="wardrobe-assets", Key=key)["Body"].read()
            sha = hashlib.sha256(data).hexdigest()
            if sha != asset["metadata"].get("checksum_sha256"):
                raise ValueError("Source object differs from registered asset checksum")
            try:
                prior = target.get_object(Bucket=cloud["STORAGE_BUCKET"], Key=key)["Body"].read()
            except ClientError as error:
                if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 404:
                    raise
                prior = None
            if prior is not None and hashlib.sha256(prior).hexdigest() != sha:
                raise ValueError("Existing object differs; no overwrite")
            if prior is None:
                target.put_object(Bucket=cloud["STORAGE_BUCKET"], Key=key, Body=data,
                                  ContentType=asset["content_type"])
            check = target.get_object(Bucket=cloud["STORAGE_BUCKET"], Key=key)["Body"].read()
            if hashlib.sha256(check).hexdigest() != sha:
                raise ValueError("Cloud object SHA mismatch")
            records.append({"key": key, "bytes": len(data), "sha256": sha, "created": prior is None})
            (OUT / "transferred-objects.json").write_text(json.dumps(records, indent=2))
    finally:
        source.close()
        target.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clone", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    result = asyncio.run(transfer(args.clone, args.apply))
    (OUT / ("clone-transfer.json" if args.clone else "cloud-transfer.json")).write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
