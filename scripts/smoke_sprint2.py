"""Loopback Sprint 2 read smoke; persisted Seed remains unchanged."""

from uuid import uuid4

import httpx


def main():
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=10) as client:
        ready = client.get("/health/ready")
        assert ready.status_code == 200
        assert set(ready.json()["checks"].values()) == {"ok"}
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
        for path in (
            "/api/v1/context-snapshots/50000000-0000-4000-8000-000000000001",
            "/api/v1/outfits",
            "/api/v1/outfits/60000000-0000-4000-8000-000000000001",
            "/api/v1/style-references",
        ):
            response = client.get(path)
            assert response.status_code == 200, path
            print(f"{path}: HTTP 200")
        assert client.get("/openapi.json").json()["info"]["version"] == "1.7.0"
        print("Sprint 2 read smoke passed")


if __name__ == "__main__":
    main()
