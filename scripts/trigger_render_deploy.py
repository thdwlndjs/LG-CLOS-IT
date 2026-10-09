"""Trigger one exact Git revision via a secret, service-scoped Render deploy hook."""

import os
import re
from urllib.parse import parse_qs, urlencode, urlparse

import httpx


def target(hook, revision):
    url = urlparse(hook)
    query = parse_qs(url.query, keep_blank_values=True)
    if (url.scheme != "https" or url.hostname != "api.render.com"
            or url.username or url.password or url.port or url.fragment
            or not re.fullmatch(r"/deploy/srv-[a-z0-9]+", url.path)
            or set(query) != {"key"} or len(query["key"]) != 1 or not query["key"][0]
            or not re.fullmatch(r"[0-9a-f]{40}", revision)):
        raise ValueError("Valid Render deploy hook and full Git SHA required")
    return url._replace(query=urlencode({"key": query["key"][0], "ref": revision})).geturl()


def trigger(hook, revision, transport=None):
    url = target(hook, revision)
    try:
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=False,
                          transport=transport) as client:
            response = client.post(url)
        if response.status_code not in {200, 202}:
            raise RuntimeError(f"Render deploy rejected: HTTP {response.status_code}")
    except httpx.HTTPError:
        # Provider exceptions contain the secret request URL. Never print them.
        raise RuntimeError("Render deploy request failed") from None
    print("Requested exact commit deployment; readiness is verified separately")


if __name__ == "__main__":
    trigger(os.environ.get("RENDER_DEPLOY_HOOK_URL", ""),
            os.environ.get("EXPECTED_REVISION", ""))
