import asyncio

from app.application.assets import cleanup_assets
from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources
from app.workers.celery_app import celery_app


@celery_app.task(name="wardrobe.cleanup_assets")
def cleanup():
    async def run():
        settings = load_settings()
        resources = RuntimeResources(settings)
        try:
            await cleanup_assets(settings, resources.database.sessions, resources.storage)
        finally:
            await resources.close()

    asyncio.run(run())
