"""Bound private API request bursts using real Redis, shared by API processes."""

import hashlib

from fastapi import Request
from redis.exceptions import RedisError

from app.core.errors import ApiError

WINDOW_SECONDS = 60
LIMITS = {"session": 30, "read": 600, "write": 120}
COUNTER = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
"""


async def rate_guard(request: Request):
    group = (
        "session"
        if request.url.path in {"/api/v1/sessions", "/api/v1/integration/login"}
        else "read"
        if request.method == "GET"
        else "write"
    )
    settings = request.app.state.settings
    # Independent test DBs receive separate counters; the DSN itself is never stored.
    namespace = hashlib.sha256(settings.database_url.get_secret_value().encode()).hexdigest()[:20]
    peer = request.client.host if request.client else "unknown"
    key = f"wardrobe:rate:{namespace}:{peer}:{group}"
    try:
        count = await request.app.state.resources.redis.eval(COUNTER, 1, key, WINDOW_SECONDS)
    except RedisError as exc:
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "Request limiter unavailable") from exc
    if count > LIMITS[group]:
        raise ApiError(429, "RATE_LIMITED", "Request limit exceeded; retry later")
