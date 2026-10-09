"""Observe the exact deployed revision and dependencies; never import personal data in CI."""

import argparse
import time
from urllib.parse import urlparse

import httpx


def check(api, web, revision, timeout):
    for origin in (api, web):
        parsed = urlparse(origin)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
            raise ValueError("Deployment checks require HTTPS origins")
    deadline = time.monotonic() + timeout
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        while time.monotonic() < deadline:
            try:
                version = client.get(api.rstrip("/") + "/health/version")
                ready = client.get(api.rstrip("/") + "/health/ready")
                page = client.get(web)
                if (version.status_code == ready.status_code == page.status_code == 200
                        and version.json().get("revision") == revision
                        and ready.json().get("status") == "ready"
                        and "text/html" in page.headers.get("content-type", "")):
                    print("Exact backend revision and deployment readiness verified")
                    return
            except (httpx.HTTPError, ValueError):
                pass
            time.sleep(10)
    raise RuntimeError("Deployment did not reach the requested revision and readiness")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", required=True)
    parser.add_argument("--web", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--timeout", default=900, type=int)
    args = parser.parse_args()
    check(args.api, args.web, args.revision, args.timeout)


if __name__ == "__main__":
    main()
