import asyncio

import pytest

from app.application.inline_worker import InlineWorker
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import run_case
from tests.integration.test_sprint3_api import prepared
from tests.integration.test_sprint4_api import draft, render

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def test_queued_card_survives_worker_restart_and_renders(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            worker = InlineWorker(settings, resources)
            worker.start()
            await asyncio.sleep(0.1)
            await worker.close()
            card = (await draft(client)).json()
            queued = await render(client, card)
            assert queued.status_code == 202, queued.text
            job_id = queued.json()["job_id"]
            restarted = InlineWorker(settings, resources)
            restarted.start()
            try:
                for _ in range(60):
                    job = (await client.get("/api/v1/jobs/" + job_id)).json()
                    if job["status"] != "QUEUED" and job["status"] != "RUNNING":
                        break
                    await asyncio.sleep(0.5)
                assert job["status"] == "SUCCEEDED", job
                assert job["result_asset"]["read_url"]
                await restarted.probe()
            finally:
                await restarted.close()

    run_case(real_dsn, settings_values, case)
