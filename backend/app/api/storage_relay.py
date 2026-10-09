"""Relay short-lived S3 capabilities without publishing the MinIO service."""

import re
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.core.rate_limit import rate_guard

router = APIRouter(include_in_schema=False, dependencies=[Depends(rate_guard)])
LIMIT = 10 * 1024 * 1024
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
STAGING = re.compile(rf"staging/{UUID}/{UUID}/{UUID}")
ASSET = re.compile(
    rf"assets/{UUID}/{UUID}/{UUID}/(?:[0-9a-f]{{32}}|result\.png|card\.(?:png|webp)|liked-result\.png)"
)


def permitted(method: str, key: str, query: str) -> bool:
    if not (STAGING if method == "PUT" else ASSET).fullmatch(key):
        return False
    fields = parse_qs(query, keep_blank_values=True)
    required = {
        "X-Amz-Algorithm",
        "X-Amz-Credential",
        "X-Amz-Date",
        "X-Amz-Expires",
        "X-Amz-SignedHeaders",
        "X-Amz-Signature",
    }
    if not required <= fields.keys() or any(len(v) != 1 for v in fields.values()):
        return False
    try:
        return (
            fields["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
            and 0 < int(fields["X-Amz-Expires"][0]) <= 300
            and re.fullmatch(r"[a-f0-9]{64}", fields["X-Amz-Signature"][0]) is not None
            and fields["X-Amz-SignedHeaders"][0]
            in {
                "host",
                "content-type;host",
                "content-length;content-type;host",
            }
        )
    except ValueError:
        return False


@router.api_route("/wardrobe-assets/{key:path}", methods=["GET", "PUT"])
async def relay(key: str, request: Request):
    settings = request.app.state.settings
    public = urlparse(settings.storage_public_base_url)
    query = request.scope["query_string"].decode("ascii", errors="replace")
    if (
        settings.storage_bucket != "wardrobe-assets"
        or public.scheme != "https"
        or public.path not in {"", "/"}
        or not permitted(request.method, key, query)
    ):
        return Response(status_code=403)
    body = bytearray()
    if request.method == "PUT":
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > LIMIT:
                return Response(status_code=413)
    # Preserve the signed Host, path, query and content type. MinIO, rather
    # than this gateway, verifies signature, expiry and key permissions.
    headers = {"Host": public.netloc}
    if "content-type" in request.headers:
        headers["Content-Type"] = request.headers["content-type"]
    target = settings.storage_endpoint.rstrip("/") + "/wardrobe-assets/" + key + "?" + query
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            async with client.stream(
                request.method, target, headers=headers, content=bytes(body)
            ) as upstream:
                if upstream.status_code not in {200, 204}:
                    return Response(status_code=403 if upstream.status_code in {400, 403} else 502)
                result = bytearray()
                async for chunk in upstream.aiter_bytes():
                    result.extend(chunk)
                    if len(result) > LIMIT:
                        return Response(status_code=502)
                return Response(
                    bytes(result),
                    status_code=upstream.status_code,
                    headers={"Cache-Control": "no-store"},
                    media_type=upstream.headers.get("content-type", "application/octet-stream"),
                )
    except httpx.HTTPError:
        return Response(status_code=503)
