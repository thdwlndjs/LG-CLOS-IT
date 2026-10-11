import asyncio

from app.application.vton_worker import process_jobs
from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources
from app.workers.celery_app import celery_app


@celery_app.task(name="wardrobe.process_vton")
def process():
    async def run():
        settings = load_settings()
        resources = RuntimeResources(settings)
        try:
            from app.application.poc_vton_worker import process_jobs as process_unified

            return (await process_jobs(settings, resources)
                    + await process_unified(settings, resources))
        finally:
            await resources.close()

    return asyncio.run(run())
