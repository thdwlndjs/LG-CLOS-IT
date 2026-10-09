import asyncio

from app.application.storage_worker import process_storage
from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources
from app.workers.celery_app import celery_app


@celery_app.task(name="wardrobe.process_storage")
def process():
    async def run():
        settings = load_settings()
        resources = RuntimeResources(settings)
        try:
            return await process_storage(settings, resources)
        finally:
            await resources.close()

    return asyncio.run(run())
