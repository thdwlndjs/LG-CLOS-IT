import json
import logging
from datetime import UTC, datetime
from time import perf_counter
from uuid import UUID, uuid4

from starlette.datastructures import MutableHeaders


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        output = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        for key in (
            "request_id",
            "correlation_id",
            "method",
            "status",
            "duration_ms",
            "event_id",
            "job_id",
            "provider_mode",
            "attempts",
            "outcome",
            "source",
        ):
            if hasattr(record, key):
                output[key] = getattr(record, key)
        return json.dumps(output, ensure_ascii=False)


def configure_logging(level: str) -> None:
    logger = logging.getLogger("wardrobe")
    logger.setLevel(level)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)


class RequestLogMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        try:
            request_id = str(UUID(headers.get(b"x-request-id", b"").decode("ascii")))
        except (ValueError, UnicodeDecodeError):
            request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        scope["state"]["correlation_id"] = request_id
        started = perf_counter()
        status = 500

        async def send_with_id(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            logging.getLogger("wardrobe").info(
                "http_request",
                extra={
                    "request_id": request_id,
                    "correlation_id": request_id,
                    "method": scope["method"],
                    "status": status,
                    "duration_ms": round((perf_counter() - started) * 1000, 2),
                },
            )
