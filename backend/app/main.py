import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import Settings, load_settings
from app.core.errors import register_error_handlers
from app.core.logging import RequestLogMiddleware, configure_logging


def create_app(settings: Settings | None = None, resources=None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if resources is None:
            from app.infrastructure.resources import RuntimeResources

            app.state.resources = RuntimeResources(settings)
        else:
            app.state.resources = resources
        try:
            yield
        finally:
            await app.state.resources.close()

    app = FastAPI(
        title="Smart Wardrobe Prototype API",
        version="1.7.0",
        lifespan=lifespan,
        description="Sprint 0 platform and Sprint 1-7 backend contract revision 1.7.",
    )
    app.state.settings = settings
    register_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "If-Match",
            "X-Request-ID",
        ],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestLogMiddleware)

    from app.api.v1 import sprint2, sprint3, sprint4, sprint5, sprint6, sprint7
    from app.api.v1.sprint1 import router

    app.include_router(router)
    app.include_router(sprint2.router)
    app.include_router(sprint3.router)
    app.include_router(sprint4.router)
    app.include_router(sprint5.router)
    app.include_router(sprint6.router)
    app.include_router(sprint7.router)
    from app.api.v1 import (
        integration,
        shopping,  # noqa: F401 -- registers additive integration routes
    )

    app.include_router(integration.router)

    # Operational paths are outside the supplied business OpenAPI contract.
    @app.get("/health/live", include_in_schema=False)
    async def live():
        return {"status": "live"}

    @app.get("/health/ready", include_in_schema=False)
    async def ready(request: Request):
        runtime = request.app.state.resources

        async def check(probe):
            try:
                await asyncio.wait_for(probe(), timeout=settings.health_timeout_seconds)
                return "ok"
            except Exception:
                # No connection URLs, keys or provider exception text in public health output.
                return "unavailable"

        names = ["database", "redis", "storage", "renderer"]
        values = await asyncio.gather(*(check(getattr(runtime, f"probe_{name}")) for name in names))
        checks = dict(zip(names, values, strict=True))
        healthy = all(value == "ok" for value in values)
        return JSONResponse(
            {"status": "ready" if healthy else "not_ready", "checks": checks},
            status_code=200 if healthy else 503,
        )

    return app
