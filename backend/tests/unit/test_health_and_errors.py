import logging
from typing import Annotated
from uuid import UUID, uuid4

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.core.errors import ApiError
from app.core.logging import JsonFormatter
from app.core.security import current_actor
from app.main import create_app


class ProbeDouble:
    """Explicit unit-only probe double; provides no DB/service integration evidence."""

    def __init__(self, failed=None):
        self.failed = failed
        self.closed = False

    async def check(self, name):
        if self.failed == name:
            raise RuntimeError("secret://private-connection")

    async def probe_database(self):
        await self.check("database")

    async def probe_redis(self):
        await self.check("redis")

    async def probe_storage(self):
        await self.check("storage")

    async def probe_renderer(self):
        await self.check("renderer")

    async def close(self):
        self.closed = True


def test_operational_health_and_swagger(settings):
    resources = ProbeDouble()
    with TestClient(create_app(settings, resources)) as client:
        assert client.get("/health/live").json() == {"status": "live"}
        response = client.get("/health/ready")
        assert response.status_code == 200
        assert response.json()["checks"] == {
            "database": "ok",
            "redis": "ok",
            "storage": "ok",
            "renderer": "ok",
        }
        assert client.get("/docs").status_code == 200
        paths = client.get("/openapi.json").json()["paths"]
        assert "/api/v1/sessions" in paths
        assert "/health/live" not in paths and "/health/ready" not in paths
    assert resources.closed


@pytest.mark.parametrize("failed", ["database", "redis", "storage", "renderer"])
def test_dependency_failure_is_503_without_secret_leak(settings, failed):
    with TestClient(create_app(settings, ProbeDouble(failed))) as client:
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json()["checks"][failed] == "unavailable"
        assert "secret://" not in response.text
        assert client.get("/health/live").status_code == 200


def test_request_id_and_standard_404(settings):
    request_id = str(uuid4())
    with TestClient(create_app(settings, ProbeDouble())) as client:
        response = client.get("/not-implemented", headers={"X-Request-ID": request_id})
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
        assert response.json()["error"]["request_id"] == request_id
        assert response.headers["X-Request-ID"] == request_id
        regenerated = client.get("/health/live", headers={"X-Request-ID": "untrusted-input"})
        UUID(regenerated.headers["X-Request-ID"])


def test_error_handlers_and_missing_authentication(settings):
    app = create_app(settings, ProbeDouble())

    @app.get("/test/number")
    async def number(value: int):
        return value

    @app.get("/test/protected")
    async def protected(actor: Annotated[object, Depends(current_actor)]):
        return {"member_id": str(actor.member_id)}

    @app.get("/test/conflict")
    async def conflict():
        raise ApiError(409, "CONFLICT", "Version conflict")

    @app.get("/test/crash")
    async def crash():
        raise RuntimeError("internal-private-secret")

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/test/protected").status_code == 401
        response = client.get("/test/number?value=private-secret")
        assert response.status_code == 422
        assert "private-secret" not in response.text
        assert client.get("/test/conflict").json()["error"]["code"] == "CONFLICT"
        response = client.get("/test/crash")
        assert response.status_code == 500
        assert "internal-private-secret" not in response.text
        assert response.headers["X-Request-ID"] == response.json()["error"]["request_id"]


def test_cors_allowlist(settings):
    with TestClient(create_app(settings, ProbeDouble())) as client:
        headers = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}
        assert client.options("/health/live", headers=headers).status_code == 200
        headers["Origin"] = "https://untrusted.example"
        assert client.options("/health/live", headers=headers).status_code == 400


def test_structured_log_contains_only_selected_fields():
    import json

    record = logging.LogRecord("wardrobe", logging.INFO, "", 0, "http_request", (), None)
    record.request_id = "unit-request"
    record.authorization = "Bearer secret"
    output = json.loads(JsonFormatter().format(record))
    assert output["request_id"] == "unit-request"
    assert "authorization" not in output
