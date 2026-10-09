import importlib.util
from pathlib import Path

import pytest


def module():
    path = Path(__file__).resolve().parents[3] / "scripts/start_cloud.py"
    spec = importlib.util.spec_from_file_location("cloud_entry", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def values():
    return dict(
        DATABASE_URL="postgres://test:test@db/wardrobe",
        REDIS_URL="rediss://test:test@redis:6379/0?ssl_cert_reqs=required",
        MINIO_HOSTPORT="storage:9000",
        RENDERER_HOSTPORT="renderer:3000",
        API_PUBLIC_ORIGIN="https://wardrobe.example",
    )


def test_cloud_uses_private_services_jwt_and_tls_redis():
    original = values()
    result = module().configure(original)
    assert original == values()
    assert result["DATABASE_URL"].startswith("postgresql+asyncpg://")
    assert result["CELERY_RESULT_BACKEND"].endswith("/1?ssl_cert_reqs=required")
    assert result["STORAGE_ENDPOINT"] == "http://storage:9000"
    assert result["STORAGE_PUBLIC_BASE_URL"] == "https://wardrobe.example"
    assert result["AUTH_MODE"] == "JWT" and result["DEMO_AUTH_ENABLED"] == "false"


@pytest.mark.parametrize(
    "origin",
    [
        "http://public.example",
        "https://public.example/path",
        "",
        "https://user:password@public.example",
    ],
)
def test_cloud_refuses_bad_public_origins(origin):
    with pytest.raises(ValueError):
        module().configure({**values(), "API_PUBLIC_ORIGIN": origin})
