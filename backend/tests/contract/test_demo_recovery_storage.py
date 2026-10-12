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
    assert set(config["services"]) == {"postgres", "minio", "redis", "renderer"}
    for service in config["services"].values():
        assert "tmpfs" not in service
        assert "container_name" not in service
        assert service["restart"] == "no"
        assert all(port.startswith("127.0.0.1:") for port in service["ports"])
        if service is config["services"]["renderer"]:
            assert "volumes" not in service
            continue
        volume = service["volumes"][0].split(":")[0]
        assert volume in config["volumes"]
        if service is config["services"]["redis"]:
            assert config["volumes"][volume]["external"] is True
            assert config["volumes"][volume]["name"] == (
                "wardrobe-recovery-demo_redis-restored-v3"
            )
        else:
            assert not config["volumes"][volume]  # Fresh PG/MinIO only.


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
    assert module.plan("npipe:////./pipe/docker_engine", str(env), False, True)[2] == (
        "npipe:////./pipe/docker_engine"
    )


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


def test_legacy_prepare_cannot_execute_docker_or_initialize_storage(monkeypatch):
    legacy_spec = importlib.util.spec_from_file_location(
        "legacy_handoff", ROOT / "scripts/handoff_local.py"
    )
    legacy = importlib.util.module_from_spec(legacy_spec)
    legacy_spec.loader.exec_module(legacy)

    def forbidden(*args, **kwargs):
        raise AssertionError("Legacy startup must not reach subprocess execution")

    monkeypatch.setattr(legacy.subprocess, "run", forbidden)
    for startup in [legacy.prepare, legacy.prepare_test_services]:
        with pytest.raises(RuntimeError, match="disabled"):
            startup()


def test_backup_aborts_when_preserved_candidate_hash_differs(tmp_path):
    import json

    backup_spec = importlib.util.spec_from_file_location(
        "recovery_backup", ROOT / "scripts/recovery_backup.py"
    )
    backup_module = importlib.util.module_from_spec(backup_spec)
    backup_spec.loader.exec_module(backup_module)
    backup_module.PRESERVED = tmp_path
    for name in ["postgres", "minio"]:
        path = tmp_path / name / "_data/file"
        path.parent.mkdir(parents=True)
        path.write_bytes(b"preserved")
        inventory = {"files": [{"path": "_data/file", "bytes": 9,
                                 "sha256": backup_module.digest(path)}]}
        (tmp_path / f"{name}-files-sha256.json").write_text(json.dumps(inventory))
    assert backup_module.verify_preserved() == 2
    (tmp_path / "minio/_data/file").write_bytes(b"changed!!")
    with pytest.raises(ValueError, match="changed"):
        backup_module.verify_preserved()
