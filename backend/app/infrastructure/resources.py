import asyncio

import httpx
from sqlalchemy import text

from app.core.config import Settings

BASELINE_REVISION = "0003_sprint5_history_care"


class RuntimeResources:
    def __init__(self, settings: Settings):
        from redis.asyncio import Redis

        from app.infrastructure.adapters.object_storage import storage_client
        from app.infrastructure.db.session import Database

        self.database = Database(settings)
        self.redis = Redis.from_url(
            settings.redis_url.get_secret_value(), socket_connect_timeout=2, socket_timeout=2
        )
        self.storage = storage_client(settings)
        self.bucket = settings.storage_bucket
        self.renderer_url = settings.card_renderer_url

    async def probe_database(self) -> None:
        async with self.database.engine.connect() as connection:
            revision = await connection.scalar(
                text("SELECT version_num FROM public.alembic_version")
            )
            if revision != BASELINE_REVISION:
                raise RuntimeError("Database migration required")
            await connection.execute(text("SELECT id FROM wardrobe.household LIMIT 1"))

    async def probe_redis(self) -> None:
        if not await self.redis.ping():
            raise RuntimeError("Redis ping failed")

    async def probe_storage(self) -> None:
        await asyncio.to_thread(self.storage.head_bucket, Bucket=self.bucket)

    async def probe_renderer(self) -> None:
        async with httpx.AsyncClient(timeout=4, follow_redirects=False) as client:
            response = await client.get(self.renderer_url.rstrip("/") + "/health/ready")
            response.raise_for_status()

    async def close(self):
        await self.redis.aclose()
        await self.database.close()
        self.storage.close()
