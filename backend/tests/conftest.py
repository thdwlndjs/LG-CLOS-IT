import pytest

from app.core.config import Settings


@pytest.fixture
def settings_values():
    return dict(
        app_env="test", database_url="postgresql+asyncpg://unit:unit@localhost/unit_test",
        redis_url="redis://localhost:6379/0", celery_broker_url="redis://localhost:6379/0",
        celery_result_backend="redis://localhost:6379/1", storage_endpoint="http://localhost:9000",
        storage_access_key="unit-access-key", storage_secret_key="unit-secret-key",
        jwt_secret="unit-test-only-secret-32-characters-minimum",
    )


@pytest.fixture
def settings(settings_values):
    return Settings(**settings_values)

