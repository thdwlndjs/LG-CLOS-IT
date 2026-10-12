"""Plan approved synthetic gaps from an offline audit; never connect or seed."""

import argparse
import json
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

HOUSEHOLD = str(uuid5(NAMESPACE_URL, "smart-wardrobe-remediation-2026-10-11:household"))
DATABASE = "wardrobe_demo_recovered"
NAMESPACE = "poc-stage-b-v1"
REVISION = "0006_fitroom_budget"


def build_plan(audit: dict) -> dict:
    expected = {"database": DATABASE, "household_id": HOUSEHOLD,
                "seed_namespace": NAMESPACE, "revision": REVISION}
    if any(audit.get(key) != value for key, value in expected.items()):
        raise ValueError("Audit target/revision/household/namespace mismatch")
    if audit.get("read_only_audit_complete") is not True:
        raise ValueError("Actual independent-target audit is required")
    if audit.get("fitroom_live_enabled") is not False:
        raise ValueError("Paid provider must be disabled")
    if audit.get("reference_integrity_ok") is not True:
        raise ValueError("Resolve recovered reference defects before gap seeding")
    approved = audit.get("approved_synthetic_ids")
    recovered = audit.get("recovered_ids")
    kinds = {"stage_b_garment", "synthetic_wear", "liked_item", "future_context"}
    if not isinstance(approved, dict) or not isinstance(recovered, dict):
        raise ValueError("Explicit approved and recovered identity inventories required")
    if set(approved) != kinds or set(recovered) != kinds:
        raise ValueError("Unsupported dataset; never regenerate actual jobs/grants/audit/history")
    missing = {}
    for kind in sorted(kinds):
        wanted, found = approved[kind], recovered[kind]
        if not isinstance(wanted, list) or not isinstance(found, list):
            raise ValueError("Identity inventory must be a list")
        if len(set(wanted)) != len(wanted) or len(set(found)) != len(found):
            raise ValueError("Duplicate identities in audit")
        for value in wanted + found:
            UUID(value)
        missing[kind] = sorted(set(wanted) - set(found))
    return {**expected, "mode": "PLAN_ONLY", "writes_allowed": False,
            "missing_approved_ids": missing,
            "actual_history_jobs_grants_audit": "preserve; never synthesize",
            "next_gate": "review concrete gap manifest and target-specific seed runner"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build_plan(json.loads(args.audit.read_text(encoding="utf-8"))), indent=2))


if __name__ == "__main__":
    main()
