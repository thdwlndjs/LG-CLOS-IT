"""Read-only current Sprint 5 readiness and contract smoke."""

import json

import httpx

with httpx.Client(base_url="http://127.0.0.1:8000", timeout=10) as client:
    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"] == dict(
        database="ok", redis="ok", storage="ok", renderer="ok"
    )
    document = client.get("/openapi.json").json()
    assert document["info"]["version"] == "1.7.0"
    assert sum(len(methods) for methods in document["paths"].values()) == 52
    for path in (
        "/api/v1/history",
        "/api/v1/wear-confirmations",
        "/api/v1/care-schedules",
        "/api/v1/garments/{garment_id}/care-profile",
    ):
        assert path in document["paths"]
    for path in ("/api/v1/history", "/api/v1/care-schedules"):
        assert client.get(path).status_code == 401
    assert client.get("/docs").status_code == 200
    assert client.get("/api/v1/cards").status_code == 401
    assert client.get("/api/v1/card-shares/invalid").status_code == 404
print(json.dumps(dict(status="passed", checks=ready.json()["checks"])))
