"""Build a read-only reconstruction inventory from approved persisted manifests."""

import argparse
import hashlib
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"
NS = "smart-wardrobe-remediation-2026-10-11"


def identity(key: str) -> str:
    return str(uuid5(NAMESPACE_URL, NS + ":" + key))


def build_inventory(package: Path = PACKAGE) -> dict:
    sources = {}

    def load(relative: str) -> dict:
        data = (package / relative).read_bytes()
        sources[relative] = hashlib.sha256(data).hexdigest()
        return json.loads(data)

    products = load("templates/remediation_products.json")["items"]
    approved = load("templates/approved_scene_manifest.json")
    baseline = load("reports/evidence/stage-b/baseline-fingerprints.json")
    shelf = load("templates/b01_common_shelf_manifest.json")["items"]
    stage = load("reports/STAGE_B_SEED_MANIFEST.json")["shelf"]
    rows = [{"garment_id": identity(p["item_id"]), "group": "base52",
             "owner_id": identity(p["owner"]), "product": p,
             "asset_mapping": "recover exact prior asset IDs from manifests before registration"}
            for p in products]
    items = {item["id"]: item for item in approved["items"]}
    mapping = {row["garment_id"]: row for row in approved["mapping"]}
    rows += [{"garment_id": row["garment_id"], "group": "approved24",
              "owner_id": row["owner_id"], "approved_mapping": row,
              "approved_item": items[row["approved_id"]]}
             for row in mapping.values()]
    originals = {row["garment_id"] for row in rows}
    if len(products) != 52 or len(mapping) != 24 or len(originals) != 76:
        raise ValueError("Expected approved 52+24 identities")
    if originals != set(baseline["original_garments"]):
        raise ValueError("Original76 identity baseline mismatch")
    stage_sources = {row["original_asset_id"]: row for row in mapping.values()
                     if row["approved_id"].startswith("K")}
    for row in stage:
        if row["existing"]:
            continue
        source = stage_sources.get(row["source_asset_id"])
        if source is None:
            raise ValueError("Stage garment source owner cannot be established")
        rows.append({"garment_id": row["garment_id"], "group": "stage28",
                     "owner_id": source["owner_id"], "source_garment_id": source["garment_id"],
                     "source_asset_id": row["source_asset_id"], "stage_mapping": row})
    ids = {row["garment_id"] for row in rows}
    if len(rows) != 104 or len(ids) != 104 or len(shelf) != 66:
        raise ValueError("Expected unique104 and shelf66")
    if not {row["garment_id"] for row in shelf} <= ids:
        raise ValueError("Shelf references unknown garment")
    return {"mode": "PLAN_ONLY", "writes_allowed": False,
            "household_id": identity("household"), "target_database": "wardrobe_demo_recovered",
            "rows": rows, "right66": shelf, "left21": baseline["left_garment_ids"],
            "source_sha256": sources,
            "recovered_nondemo_rows": "preserve; append demo104 without replacing recovered9",
            "registration_gate": "API-generated IDs must not replace approved garment/asset IDs"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    dest = args.output.resolve()
    allowed = ROOT / "test-results/reconstruction-plans"
    if not dest.is_relative_to(allowed) or dest.exists():
        raise ValueError("New output under ignored reconstruction-plans only")
    inventory = build_inventory()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"rows": len(inventory["rows"]), "output": str(dest), "writes_to_db": False}))


if __name__ == "__main__":
    main()
