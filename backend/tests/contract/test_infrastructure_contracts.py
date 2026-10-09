import pytest
import yaml

from app.core.paths import PROJECT_ROOT

pytestmark = pytest.mark.contract


def test_test_db_has_no_shared_volume_or_production_url():
    compose = yaml.safe_load((PROJECT_ROOT / "infra/compose.yaml").read_text(encoding="utf-8"))
    services = compose["services"]
    test_db = services["postgres-test"]
    assert test_db["profiles"] == ["test"]
    assert "volumes" not in test_db
    assert test_db["tmpfs"] == ["/var/lib/postgresql/data"]
    assert services["tests"]["environment"]["TEST_DATABASE_URL"].endswith(
        "@postgres-test:5432/wardrobe_test"
    )
    for service in services.values():
        for mapping in service.get("ports", []):
            assert mapping.startswith("127.0.0.1:")


def test_docker_build_has_original_contracts_and_windows_tasks_exist():
    dockerfile = (PROJECT_ROOT / "backend/Dockerfile").read_text(encoding="utf-8")
    assert "COPY docs /workspace/docs" in dockerfile
    assert "COPY scripts /workspace/scripts" in dockerfile
    for filename in ("bootstrap.py", "seed.py", "smoke.py", "tasks.py", "init_storage.py"):
        assert (PROJECT_ROOT / "scripts" / filename).is_file()
