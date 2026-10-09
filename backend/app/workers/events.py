import asyncio

from app.application.outbox import consume, dispatch
from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources
from app.workers.celery_app import celery_app


@celery_app.task(name="wardrobe.dispatch_events")
def dispatch_events():
    async def run():
        resources = RuntimeResources(load_settings())

        async def publish(message):
            await asyncio.to_thread(
                celery_app.send_task,
                "wardrobe.consume_event",
                args=[message],
                retry=False,
                argsrepr="[<internal event envelope>]",
            )

        try:
            return await dispatch(resources, publish)
        finally:
            await resources.close()

    return asyncio.run(run())


@celery_app.task(
    name="wardrobe.consume_event",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=30,
    retry_kwargs={"max_retries": 3},
    retry_jitter=False,
)
def consume_event(message):
    async def run():
        settings = load_settings()
        resources = RuntimeResources(settings)
        try:
            inserted = await consume(resources, message)
            if (
                inserted
                and message["aggregate_type"] == "job"
                and message["event_type"].endswith("Requested")
            ):
                from app.application.card_worker import process_cards
                from app.application.storage_worker import process_storage
                from app.application.vton_worker import process_jobs

                await process_jobs(settings, resources)
                await process_cards(settings, resources)
                await process_storage(settings, resources)
            return dict(event_id=message["event_id"], duplicate=not inserted)
        finally:
            await resources.close()

    return asyncio.run(run())
