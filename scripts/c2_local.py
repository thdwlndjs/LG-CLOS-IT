"""C-2 local evidence server. Fixed isolated DB; provider traffic always disabled."""

import asyncio
import json
import os
import sys

from handoff_local import RUNTIME
from remediation_local import DATABASE, ROOT, engine, environment, identity


async def migrate():
    from alembic import command
    from alembic.config import Config

    e = engine()
    try:
        assert e.url.database == DATABASE == "wardrobe_test_remediation"
        async with e.begin() as c:

            def apply(connection):
                cfg = Config(str(ROOT / "backend/alembic.ini"))
                cfg.attributes["connection"] = connection
                command.upgrade(cfg, "head")

            await c.run_sync(apply)
        print("Isolated C-2 migration applied; no seed, approval or provider call")
    finally:
        await e.dispose()


if __name__ == "__main__":
    if sys.argv[1:] == ["migrate"]:
        asyncio.run(migrate())
    elif sys.argv[1:] == ["serve"]:
        os.environ.update(environment())
        runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
        os.environ.update(
            FITROOM_LIVE_ENABLED="false",
            FITROOM_API_KEY="",
            FITROOM_STATUS_READ_UNBILLED_VERIFIED="false",
            WORKER_EXECUTION="INLINE",
            JWT_SECRET=runtime["jwt_secret"],
            CARD_RENDERER_URL="http://127.0.0.1:3300",
            LOCAL_DEMO_MEMBER_ID=str(identity("son")),
            LOCAL_DEMO_MOTHER_MEMBER_ID=str(identity("mom")),
            LOCAL_DEMO_STATION_ID=str(identity("station")),
            STORAGE_PUBLIC_BASE_URL="http://localhost:9000",
            CELERY_BROKER_URL="redis://127.0.0.1:16379/0",
            CELERY_RESULT_BACKEND="redis://127.0.0.1:16379/1",
            DECART_API_KEY="",
            PUBLIC_DEMO_LOGIN_ENABLED="false",
        )
        import uvicorn

        uvicorn.run("app.main:create_app", factory=True, host="127.0.0.1", port=18082)
    else:
        raise SystemExit("Usage: c2_local.py migrate|serve")
