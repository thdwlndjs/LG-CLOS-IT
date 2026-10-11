"""Verify local Stage B seed twice against full row fingerprints, not just counts."""

import asyncio
import json
import subprocess
import sys

from sqlalchemy import text

from remediation_local import PACKAGE, ROOT, engine

TABLES = [
    "garment",
    "garment_state",
    "asset",
    "outfit",
    "outfit_item",
    "outfit_card",
    "vton_job",
    "context_snapshot",
    "wear_event",
    "liked_item",
    "scene_placement",
    "storage_location",
    "lighting_zone",
]


async def snapshot():
    e = engine()
    try:
        async with e.connect() as c:
            return {
                t: dict(
                    (
                        await c.execute(
                            text(
                                "SELECT count(*) AS count,md5(string_agg(md5(to_jsonb(t)::text),'' "
                                "ORDER BY to_jsonb(t)::text)) AS rows_hash FROM wardrobe."
                                + t
                                + " t"
                            )
                        )
                    )
                    .mappings()
                    .one()
                )
                for t in TABLES
            }
    finally:
        await e.dispose()


def main():
    before = asyncio.run(snapshot())
    runs = []
    for _ in range(2):
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/stage_b_seed.py")], check=True
        )
        after = asyncio.run(snapshot())
        assert after == before, "Seed changed counts or row content on repeat"
        runs.append(after)
    output = PACKAGE / "reports/evidence/stage-b/idempotence.json"
    output.write_text(
        json.dumps(
            {"before": before, "runs": runs, "duplicate_or_changed_rows": 0}, indent=2
        ),
        encoding="utf-8",
    )
    print("Two reruns: counts and full-row fingerprints unchanged")


if __name__ == "__main__":
    main()
