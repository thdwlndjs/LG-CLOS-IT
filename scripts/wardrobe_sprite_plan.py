"""Build an offline, source-hash-bound sprite generation plan; no DB writes."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"
OUT = ROOT / "test-results/remediation/sprite-inputs"


def main():
    if (PACKAGE / "templates/wardrobe_sprite_manifest.json").exists():
        raise RuntimeError("Preserve generated manifest; use a new version for replanning")
    OUT.mkdir(parents=True, exist_ok=True)
    products = json.loads(
        (PACKAGE / "templates/remediation_products.json").read_text(encoding="utf-8")
    )["items"]
    batches = []
    for start in range(0, len(products), 8):
        items = products[start : start + 8]
        group = f"batch-{start // 8 + 1:02}"
        photos = []
        for p in items:
            source = ROOT / p["local_image"]
            assert hashlib.sha256(source.read_bytes()).hexdigest() == p["image_sha256"]
            photos.append(
                f'<figure><img src="{source.as_uri()}"><figcaption>{p["item_id"]} {p["category"]}</figcaption></figure>'
            )
        html = (
            '<meta charset="utf-8"><style>body{margin:0}main{display:grid;grid-template-columns:repeat(4,240px)}figure{margin:0}img{width:240px;height:270px;object-fit:contain}figcaption{height:30px;font:16px sans-serif}</style><main>'
            + "".join(photos)
            + "</main>"
        )
        (OUT / (group + ".html")).write_text(html, encoding="utf-8")
        batches.append(
            {
                "batch": group,
                "items": [
                    {
                        "item_id": p["item_id"],
                        "category": p["category"],
                        "source_sha256": p["image_sha256"],
                        "reference_path": str(ROOT / p["local_image"]),
                    }
                    for p in items
                ],
                "status": "PENDING",
                "atlas_dimensions": [1536, 1024],
                "cell_dimensions": [192, 512],
                "mode": "top row side-hanging; bottom row folded/resting; original photos unchanged",
            }
        )
    (PACKAGE / "templates/wardrobe_sprite_manifest.json").write_text(
        json.dumps(
            {
                "version": "wardrobe-sprites-v1",
                "basis": "AI-generated visualization derivatives from actual source photos, not official product photos",
                "rights": "No public redistribution rights inferred",
                "batches": batches,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print("Prepared 7 source-bound batches for 52 products; no DB writes.")


if __name__ == "__main__":
    main()
