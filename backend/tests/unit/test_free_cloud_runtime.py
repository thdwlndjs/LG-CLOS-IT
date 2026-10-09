import asyncio
import ssl
from pathlib import Path

import pytest

from app.application.inline_worker import InlineWorker
from app.infrastructure.db.session import database_connect_args


def test_public_database_requires_verified_tls(settings):
    ca = Path(__file__).resolve().parents[3] / "infra/cloud/supabase-ca.crt"
    public = settings.model_copy(update={"public_deployment": True, "database_ca_file": str(ca)})
    context = database_connect_args(public)["ssl"]
    assert context.check_hostname
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert "ssl" not in database_connect_args(settings)


def test_inline_readiness_tracks_cycle_failure_and_shutdown(monkeypatch, settings):
    import app.application.inline_worker as module
    import app.workers.external_vton as external

    calls = []

    async def succeed(*args):
        calls.append("success")

    async def fail(*args):
        raise RuntimeError("private provider message")

    for name in ("process_jobs", "process_cards", "process_storage", "dispatch"):
        monkeypatch.setattr(module, name, succeed)
    monkeypatch.setattr(external, "process", succeed)

    async def run():
        worker = InlineWorker(settings, object())
        worker.last_cleanup = module.monotonic()
        with pytest.raises(RuntimeError):
            await worker.probe()
        worker.start()
        for _ in range(10):
            await asyncio.sleep(0)
            if worker.healthy:
                break
        await worker.probe()
        monkeypatch.setattr(module, "process_cards", fail)
        await worker.cycle()
        with pytest.raises(RuntimeError):
            await worker.probe()
        assert len(calls) == 9
        await worker.close()
        assert worker.task.done()
        with pytest.raises(RuntimeError):
            await worker.probe()

    asyncio.run(run())
