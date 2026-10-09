"""Private local Sprint 1 login/read smoke. No garment/settings mutations."""

import argparse
from urllib.parse import urlparse
from uuid import uuid4

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()
    url = urlparse(args.base_url)
    if url.scheme != "http" or url.hostname not in {"localhost", "127.0.0.1"}:
        raise SystemExit("Demo smoke permits only loopback HTTP")
    with httpx.Client(
        base_url=args.base_url, timeout=10, follow_redirects=False
    ) as client:
        ready = client.get("/health/ready")
        ready.raise_for_status()
        assert ready.json()["checks"] == {
            "database": "ok",
            "redis": "ok",
            "storage": "ok",
        }
        response = client.post(
            "/api/v1/sessions",
            json={
                "household_id": "10000000-0000-4000-8000-000000000001",
                "member_id": "20000000-0000-4000-8000-000000000001",
                "demo_mode": True,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        response.raise_for_status()
        assert response.status_code == 201
        client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
        for path in ("/api/v1/garments", "/api/v1/settings"):
            result = client.get(path)
            result.raise_for_status()
            print(f"{path}: HTTP {result.status_code}")
        located = client.post("/api/v1/garments/locate", json={"category": "TOP"})
        located.raise_for_status()
        assert located.status_code == 201
        print("/api/v1/sessions, /api/v1/garments/locate: HTTP 201")
        print("Sprint 1 login/read smoke passed; credentials were not printed")


if __name__ == "__main__":
    main()
