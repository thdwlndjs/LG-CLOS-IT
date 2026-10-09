"""Verify Sprint 3 loopback readiness/routes, without creating business fixtures."""

from uuid import uuid4

import httpx


def main():
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=10) as client:
        ready = client.get("/health/ready")
        assert ready.status_code == 200 and set(ready.json()["checks"].values()) == {
            "ok"
        }
        document = client.get("/openapi.json").json()
        assert document["info"]["version"] == "1.7.0"
        assert sum(len(methods) for methods in document["paths"].values()) == 52
        for path in ("/api/v1/vton-sessions/", "/api/v1/jobs/"):
            assert client.get(path + str(uuid4())).status_code == 401
        login = client.post(
            "/api/v1/sessions",
            json=dict(
                household_id="10000000-0000-4000-8000-000000000001",
                member_id="20000000-0000-4000-8000-000000000001",
                demo_mode=True,
            ),
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert login.status_code == 201
        client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
        for path in ("/api/v1/vton-sessions/", "/api/v1/jobs/"):
            assert client.get(path + str(uuid4())).status_code == 404
        print("Sprint 3 readiness/OpenAPI/auth/scoped-not-found smoke passed")


if __name__ == "__main__":
    main()
