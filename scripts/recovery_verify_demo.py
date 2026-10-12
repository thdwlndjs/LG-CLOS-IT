"""Read-only approved-demo and recovered-row validation on the new persistent DB."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from uuid import UUID

import asyncpg

from recovery_seed_demo import ROOT, plan
from remediation_local import identity


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str).encode()
    ).hexdigest()


async def verify(runtime_path):
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    inventory = plan()
    connect = dict(
        host="127.0.0.1",
        port=57433,
        user="wardrobe",
        password=runtime["postgres_password"],
        timeout=10,
    )
    current = await asyncpg.connect(database="wardrobe_demo_recovered", **connect)
    reference = await asyncpg.connect(database="normalization_restore_drill", **connect)
    report = {"mode": "READ_ONLY", "checks": {}, "failures": []}

    def check(name, valid, detail):
        report["checks"][name] = {"pass": bool(valid), "detail": detail}
        if not valid:
            report["failures"].append(name)

    try:
        async with (
            current.transaction(readonly=True),
            reference.transaction(readonly=True),
        ):
            await current.execute("SET LOCAL statement_timeout='10s'")
            await reference.execute("SET LOCAL statement_timeout='10s'")
            revision = await current.fetchval(
                "SELECT version_num FROM public.alembic_version"
            )
            check("revision", revision == "0006_fitroom_budget", revision)
            expected = {row["garment_id"]: row for row in inventory["rows"]}
            rows = await current.fetch(
                "SELECT id,owner_id,image_asset_id FROM wardrobe.garment WHERE household_id=$1",
                identity("household"),
            )
            actual = {str(row["id"]): row for row in rows}
            check(
                "approved104_id_set",
                set(actual) == set(expected),
                {
                    "actual": len(actual),
                    "missing": sorted(set(expected) - set(actual)),
                    "unexpected": sorted(set(actual) - set(expected)),
                },
            )
            mismatches = [
                gid
                for gid in set(actual) & set(expected)
                if str(actual[gid]["owner_id"]) != expected[gid]["owner_id"]
            ]
            check("approved_owners", not mismatches, mismatches)
            links = await current.fetchval(
                "SELECT count(*) FROM wardrobe.garment g JOIN wardrobe.asset a ON a.id=g.image_asset_id AND a.household_id=g.household_id AND a.status='READY' WHERE g.household_id=$1",
                identity("household"),
            )
            check("ready_original_images", links == 104, links)
            placements = await current.fetch(
                "SELECT garment_id,compartment_id,geometry FROM wardrobe.scene_placement"
            )
            by_id = {str(row["garment_id"]): row for row in placements}
            right = {row["garment_id"]: row for row in inventory["right66"]}
            mismatch = [
                gid
                for gid, wanted in right.items()
                if gid not in by_id
                or str(by_id[gid]["compartment_id"]) != wanted["compartment_id"]
                or json.loads(by_id[gid]["geometry"]) != wanted["geometry"]
            ]
            check(
                "right66_geometry",
                len(by_id) == 66 and not mismatch,
                {"count": len(by_id), "mismatches": mismatch},
            )
            missing_assets = []
            for wanted in right.values():
                exists = await current.fetchval(
                    "SELECT id FROM wardrobe.asset WHERE id=$1 AND status='READY'",
                    UUID(wanted["derivative_asset_id"]),
                )
                if not exists:
                    missing_assets.append(wanted["derivative_asset_id"])
            check(
                "right66_derivative_assets",
                not missing_assets,
                sorted(set(missing_assets)),
            )
            check(
                "left21_ids",
                len(inventory["left21"]) == 21
                and set(inventory["left21"]) <= set(actual),
                len(set(inventory["left21"]) & set(actual)),
            )
            for owner in ("mom", "son"):
                wear = await current.fetchval(
                    "SELECT count(*) FROM wardrobe.wear_event WHERE member_id=$1 AND cancelled_at IS NULL",
                    identity(owner),
                )
                contexts = await current.fetchval(
                    "SELECT count(*) FROM wardrobe.wear_event w JOIN wardrobe.context_snapshot c ON c.id=w.context_snapshot_id WHERE w.member_id=$1 AND w.cancelled_at IS NULL",
                    identity(owner),
                )
                liked = await current.fetchval(
                    "SELECT count(*) FROM wardrobe.liked_item WHERE member_id=$1",
                    identity(owner),
                )
                check(
                    owner + "_wear_context",
                    wear == contexts == 54,
                    {"wear": wear, "contexts": contexts},
                )
                check(owner + "_liked", liked == 3, liked)
            recovered = {}
            for table in (
                "garment",
                "garment_state",
                "asset",
                "outfit",
                "outfit_item",
                "wear_event",
                "outfit_card",
                "audit_log",
            ):
                exists = await reference.fetchval(
                    "SELECT to_regclass($1)", "wardrobe." + table
                )
                if not exists:
                    continue
                before = await reference.fetch(
                    f'SELECT to_jsonb(t)::text AS value FROM wardrobe."{table}" t'
                )
                after = await current.fetch(
                    f'SELECT to_jsonb(t)::text AS value FROM wardrobe."{table}" t'
                )
                hashes = {digest(json.loads(row["value"])) for row in after}
                missing = [
                    digest(json.loads(row["value"]))
                    for row in before
                    if digest(json.loads(row["value"])) not in hashes
                ]
                recovered[table] = {
                    "reference_rows": len(before),
                    "unchanged": len(before) - len(missing),
                    "mismatch_hashes": missing,
                }
            check(
                "recovered_reference_rows",
                not any(value["mismatch_hashes"] for value in recovered.values()),
                recovered,
            )
            constraints = await current.fetch(
                "SELECT conname,convalidated FROM pg_constraint WHERE contype='f' AND connamespace='wardrobe'::regnamespace"
            )
            check(
                "fk_constraints_validated",
                all(row["convalidated"] for row in constraints),
                {"count": len(constraints)},
            )
            definitions = await current.fetch("""
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

            orphans = {}
            for foreign in definitions:
                source = (
                    quote(foreign["source_schema"])
                    + "."
                    + quote(foreign["source_table"])
                )
                parent = (
                    quote(foreign["parent_schema"])
                    + "."
                    + quote(foreign["parent_table"])
                )
                comparisons = " AND ".join(
                    f"s.{quote(a)}=p.{quote(b)}"
                    for a, b in zip(
                        foreign["source_columns"], foreign["parent_columns"]
                    )
                )
                null_join = " OR " if foreign["confmatchtype"] == "f" else " AND "
                present = null_join.join(
                    f"s.{quote(a)} IS NOT NULL" for a in foreign["source_columns"]
                )
                orphans[foreign["conname"]] = await current.fetchval(
                    f"SELECT count(*) FROM {source} s WHERE ({present}) AND NOT EXISTS (SELECT 1 FROM {parent} p WHERE {comparisons})"
                )
            check("fk_orphans", not any(orphans.values()), orphans)
    finally:
        await current.close()
        await reference.close()
    report["pass"] = not report["failures"]
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to(ROOT / "test-results"):
        parser.error("Evidence output under test-results only")
    result = asyncio.run(verify(args.runtime))
    args.output.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"pass": result["pass"], "failures": result["failures"]}))


if __name__ == "__main__":
    main()
