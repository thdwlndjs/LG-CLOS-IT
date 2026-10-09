"""Free prototype worker: existing durable DB jobs, no in-memory job queue."""

import asyncio
import logging
from time import monotonic

from app.application.assets import cleanup_assets
from app.application.card_worker import process_cards
from app.application.outbox import consume, dispatch
from app.application.storage_worker import process_storage
from app.application.vton_worker import process_jobs


class InlineWorker:
    def __init__(self, settings, resources):
        self.settings = settings
        self.resources = resources
        self.last_success = None
        self.healthy = False
        self.task = None
        self.last_cleanup = 0

    async def cycle(self):
        from app.workers.external_vton import process as process_external

        async def publish(message):
            await consume(self.resources, message)

        operations = (
            ("vton", lambda: process_jobs(self.settings, self.resources)),
            ("liked", lambda: process_external(self.settings, self.resources)),
            ("cards", lambda: process_cards(self.settings, self.resources)),
            ("storage", lambda: process_storage(self.settings, self.resources)),
            ("outbox", lambda: dispatch(self.resources, publish)),
        )
        if monotonic() - self.last_cleanup >= 60:
            operations += (("retention", lambda: cleanup_assets(
                self.settings, self.resources.database.sessions, self.resources.storage
            )),)
        self.healthy = True
        for name, execute in operations:
            try:
                await execute()
                if name == "retention":
                    self.last_cleanup = monotonic()
            except Exception:
                self.healthy = False
                logging.getLogger("wardrobe").error("inline_worker_operation_failed",
                                                     extra={"task": name})
        if self.healthy:
            self.last_success = monotonic()

    async def run(self):
        while True:
            await self.cycle()
            await asyncio.sleep(2)

    def start(self):
        if self.task is not None:
            raise RuntimeError("Inline worker already started")
        self.task = asyncio.create_task(self.run(), name="wardrobe-inline-worker")

    async def probe(self):
        if (not self.task or self.task.done() or not self.healthy or self.last_success is None
                or monotonic() - self.last_success > 120):
            raise RuntimeError("Inline worker unavailable")

    async def close(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
