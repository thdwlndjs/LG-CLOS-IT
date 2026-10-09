from celery import Celery

from app.core.config import load_settings
from app.core.logging import configure_logging

settings = load_settings()
configure_logging(settings.log_level)
celery_app = Celery(
    "wardrobe",
    broker=settings.celery_broker_url.get_secret_value(),
    backend=settings.celery_result_backend.get_secret_value(),
)
celery_app.conf.update(
    imports=(
        "app.workers.storage_cleanup",
        "app.workers.vton",
        "app.workers.cards",
        "app.workers.storage",
        "app.workers.events",
    ),
    task_default_queue=settings.worker_queue,
    beat_schedule={
        "storage-retention": {"task": "wardrobe.cleanup_assets", "schedule": 60.0},
        "vton-durable-jobs": {"task": "wardrobe.process_vton", "schedule": 2.0},
        "card-durable-jobs": {"task": "wardrobe.process_cards", "schedule": 2.0},
        "storage-durable-jobs": {"task": "wardrobe.process_storage", "schedule": 2.0},
        "outbox-dispatch": {"task": "wardrobe.dispatch_events", "schedule": 2.0},
    },
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"socket_connect_timeout": 5, "socket_timeout": 5},
)
