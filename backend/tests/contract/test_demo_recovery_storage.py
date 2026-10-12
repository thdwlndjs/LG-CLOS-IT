"""Recovery storage safety properties, without reaching any Engine or service."""

import importlib.util
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "recovery_plan", ROOT / "scripts/recovery_compose_plan.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_demo_services_have_persistent_storage_and_no_implicit_writers():
    config = yaml.safe_load((ROOT / "infra/compose.demo-recovery.yaml").read_text())
    assert set(config["services"]) == {"postgres", "minio", "redis"}
    for service in config["services"].values():
        assert "tmpfs" not in service
        assert "container_name" not in service
        assert service["restart"] == "no"
        assert all(port.startswith("127.0.0.1:") for port in service["ports"])
        volume = service["volumes"][0].split(":")[0]
        assert volume in config["volumes"]
        assert not config["volumes"][volume]  # No old/external volume names.


@pytest.mark.parametrize("engine", [
    "npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock",
    "ssh://localhost", "ssh://127.0.0.1", "ssh://192.168.65.7", "ssh://user:password@remote",
])
def test_plan_rejects_existing_or_unprotected_engine(engine, tmp_path):
    env = tmp_path / ".env.recovery"
    env.write_text("PRIVATE=fixture")
    with pytest.raises(ValueError):
        module.plan(engine, str(env), True)


def test_plan_requires_independence_attestation_and_is_storage_only(tmp_path):
    env = tmp_path / ".env.recovery"
    env.write_text("PRIVATE=fixture")
    with pytest.raises(ValueError):
        module.plan("ssh://operator@independent.example", str(env), False)
    command = module.plan("ssh://operator@independent.example", str(env), True)
    assert command[:3] == ["docker", "--host", "ssh://operator@independent.example"]
    assert command[-3:] == ["postgres", "minio", "redis"]
    assert "PRIVATE=fixture" not in " ".join(command)


def test_gap_plan_requires_actual_target_audit_and_preserves_recovered_ids():
    gap_spec = importlib.util.spec_from_file_location(
        "recovery_gaps", ROOT / "scripts/recovery_gap_plan.py"
    )
    gap = importlib.util.module_from_spec(gap_spec)
    gap_spec.loader.exec_module(gap)
    one = "00000000-0000-0000-0000-000000000001"
    two = "00000000-0000-0000-0000-000000000002"
    datasets = {key: [] for key in
                ["stage_b_garment", "synthetic_wear", "liked_item", "future_context"]}
    audit = {
        "database": gap.DATABASE, "household_id": gap.HOUSEHOLD,
        "seed_namespace": gap.NAMESPACE, "revision": gap.REVISION,
        "read_only_audit_complete": True, "reference_integrity_ok": True,
        "fitroom_live_enabled": False,
        "approved_synthetic_ids": {**datasets, "synthetic_wear": [one, two]},
        "recovered_ids": {**datasets, "synthetic_wear": [one]},
    }
    assert gap.build_plan(audit)["missing_approved_ids"]["synthetic_wear"] == [two]
    assert gap.build_plan(audit)["writes_allowed"] is False
    for invalid in [{"database": "wardrobe_test_remediation"},
                    {"read_only_audit_complete": False},
                    {"fitroom_live_enabled": True}, {"revision": "0005_stage_b_data"}]:
        with pytest.raises(ValueError):
            gap.build_plan({**audit, **invalid})


def test_reconstruction_inventory_preserves_approved104_ids_and_stage_source_owners():
    inventory_spec = importlib.util.spec_from_file_location(
        "approved_inventory", ROOT / "scripts/recovery_approved_inventory.py"
    )
    inventory_module = importlib.util.module_from_spec(inventory_spec)
    inventory_spec.loader.exec_module(inventory_module)
    inventory = inventory_module.build_inventory()
    rows = inventory["rows"]
    indexed = {row["garment_id"]: row for row in rows}
    assert len(indexed) == 104
    assert [sum(row["group"] == group for row in rows)
            for group in ["base52", "approved24", "stage28"]] == [52, 24, 28]
    assert len(inventory["right66"]) == 66
    assert len(inventory["left21"]) == 21
    for row in rows:
        if row["group"] == "stage28":
            assert row["owner_id"] == indexed[row["source_garment_id"]]["owner_id"]
    assert inventory["writes_allowed"] is False
