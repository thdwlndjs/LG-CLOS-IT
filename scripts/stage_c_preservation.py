"""Read-only C baseline with full row hashes and approved tracked visual file hashes."""

import asyncio
import hashlib
import json
import subprocess
import sys

from sqlalchemy import text

from remediation_local import PACKAGE, ROOT, engine
from stage_b_verify import digest

OUT = PACKAGE / "reports/evidence/stage-c"
TABLES = [
    "garment",
    "garment_state",
    "scene_placement",
    "outfit",
    "outfit_item",
    "outfit_card",
    "vton_job",
    "wear_event",
    "liked_item",
    "context_snapshot",
    "storage_location",
    "lighting_zone",
]


async def snapshot():
    e = engine()
    try:
        async with e.connect() as c:
            result = {
                t: {
                    str(r["id"] if "id" in r else tuple(r.values())): digest(dict(r))
                    for r in (
                        await c.execute(
                            text(
                                "SELECT * FROM wardrobe."
                                + t
                                + " ORDER BY to_jsonb("
                                + t
                                + ")::text"
                            )
                        )
                    ).mappings()
                }
                for t in TABLES
            }
            result["asset"] = {
                str(r["id"]): digest(dict(r))
                for r in (
                    await c.execute(text("SELECT * FROM wardrobe.asset"))
                ).mappings()
            }
        files = (
            subprocess.check_output(
                [
                    "git",
                    "ls-files",
                    "-z",
                    "web/public/assets",
                    str(PACKAGE / "reports/b01-common-v1"),
                    str(PACKAGE / "templates/b01_common_shelf_manifest.json"),
                ],
                cwd=ROOT,
                text=True,
                encoding="utf-8",
            )
            .rstrip("\0")
            .split("\0")
        )
        result["visual_files"] = {
            p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in files
        }
        return result
    finally:
        await e.dispose()


OUT.mkdir(parents=True, exist_ok=True)
current = asyncio.run(snapshot())
if sys.argv[1] == "before":
    path = OUT / "preservation-before.json"
    assert not path.exists(), "Never overwrite original baseline"
    path.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    print("C baseline captured; DB read only")
else:
    before = json.loads((OUT / "preservation-before.json").read_text(encoding="utf-8"))
    differences = {
        t: [i for i, h in rows.items() if current[t].get(i) != h]
        for t, rows in before.items()
    }
    added = {t: len(set(current[t]) - set(rows)) for t, rows in before.items()}
    result = dict(
        changed_or_deleted=differences,
        added=added,
        pass_preservation=not any(differences.values())
        and not any(n for t, n in added.items() if t != "asset"),
    )
    (OUT / "preservation-after.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    assert result["pass_preservation"], "Preservation failed"
    print(
        "Full pre-existing data and approved visual files preserved; new C assets separated"
    )
