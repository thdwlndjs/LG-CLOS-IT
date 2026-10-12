"""Real PostgreSQL/MinIO; all provider submissions are injected local stubs."""

import asyncio
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import text

from app.application.common.authorization import ActorContext
from app.application.fitroom import Fitroom
from app.core.errors import ApiError
from app.schemas.fitroom import FitroomExecute
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint3_api import prepared
from tests.integration.test_stage_c import request_body

pytestmark = pytest.mark.integration
PATH = "/api/v1/integration/fitroom/reviews"


@pytest.fixture(autouse=True)
def forbid_provider_network(monkeypatch):
    import httpx

    original = httpx.AsyncHTTPTransport.handle_async_request

    async def guarded(self, request):
        if request.url.host == "platform.fitroom.app":
            pytest.fail("A real provider transport was reached")
        return await original(self, request)

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", guarded)


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def test_fixture_review_snapshot_storage_and_duplicate(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            body = await request_body(engine, person)
            r = await client.post(PATH, json=dict(request=body))
            assert r.status_code == 200, r.text
            review = r.json()
            assert review["actual_fixture_credits"] == 0
            assert review["authorized"] and review["is_mock"]
            assert len(review["items"]) == 2
            again = (await client.post(PATH, json=dict(request=body))).json()
            assert again["job_id"] == review["job_id"]
            url = PATH + "/" + review["job_id"]
            payload = dict(
                fingerprint=review["fingerprint"], confirmed=True, person_asset_id=person
            )
            results = await asyncio.gather(
                *[client.post(url + "/execute", json=payload) for _ in range(4)]
            )
            assert sum(r.status_code == 200 for r in results) == 1
            assert sum(r.status_code == 409 for r in results) == 3
            result = (await client.get(url)).json()
            assert result["status"] == "SUCCEEDED" and result["consumed"]
            assert result["result_semantics"] == "FIXTURE_NOT_REAL_TRY_ON"
            assert result["request_snapshot"] == review["request_snapshot"]
            obj = resources.storage.get_object(
                Bucket=settings.storage_bucket,
                Key=(await get_asset_key(engine, result["result_asset"]["asset_id"])),
            )
            assert obj["Body"].read().startswith(b"\x89PNG")
            obj["Body"].close()
            assert (await client.post(url + "/status")).status_code == 403
            async with engine.connect() as c:
                assert (
                    await c.scalar(
                        text("SELECT count(*) FROM wardrobe.fitroom_audit WHERE action='CONSUMED'")
                    )
                    == 1
                )
                assert (
                    await c.scalar(
                        text("SELECT count(*) FROM wardrobe.fitroom_audit WHERE action='BLOCKED'")
                    )
                    == 4
                )
                assert await c.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0

    existing.run_case(real_dsn, settings_values, case)


async def get_asset_key(engine, identity):
    async with engine.connect() as c:
        return await c.scalar(
            text("SELECT asset_key FROM wardrobe.asset WHERE id=:id"), dict(id=UUID(identity))
        )


@pytest.mark.parametrize("failure", [False, True])
def test_persistent_single_attempt_live_stub_timeout_restart(real_dsn, settings_values, failure):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            body = await request_body(engine, person)
            response = await client.post(PATH, json=dict(request=body, mode="LIVE"))
            assert response.status_code == 200, response.text
            review = response.json()
            identity = UUID(review["job_id"])
            payload = FitroomExecute(
                fingerprint=review["fingerprint"], confirmed=True, person_asset_id=person
            )
            actor = ActorContext(
                UUID(existing.HOUSEHOLD), UUID(existing.OWNER), "OWNER", UUID(int=0), "budget-test"
            )
            calls = []

            class Stub:
                def __init__(self, *a):
                    pass

                async def submit(self, req, permit, hd):
                    calls.append(req)
                    async with engine.connect() as c:
                        assert await c.scalar(
                            text(
                                "SELECT consumed_at IS NOT NULL FROM "
                                "wardrobe.fitroom_request WHERE "
                                "job_id=:j"
                            ),
                            dict(j=identity),
                        )
                    await asyncio.sleep(0.01)
                    if failure:
                        raise TimeoutError("Synthetic; no provider request")
                    return "fixture-provider-task"

            def service(config):
                return Fitroom(
                    SimpleNamespace(
                        app=SimpleNamespace(
                            state=SimpleNamespace(settings=config, resources=resources)
                        )
                    )
                )

            # Dev, even with a synthetic approval, cannot invoke adapter.
            async with engine.begin() as c:
                await c.execute(
                    text(
                        "UPDATE wardrobe.fitroom_request SET approved_at=now(),"
                        "approved_by='fixture',"
                        "expires_at=now()+interval '10 minutes' WHERE job_id=:j"
                    ),
                    dict(j=identity),
                )
            with pytest.raises(ApiError):
                await service(settings).execute(actor, identity, payload, Stub)
            assert calls == []
            from pydantic import SecretStr

            config = settings.model_copy(
                update=dict(
                    app_env="staging",
                    fitroom_live_enabled=True,
                    fitroom_api_key=SecretStr("synthetic-key-never-real"),
                    fitroom_status_read_unbilled_verified=True,
                )
            )

            async def attempt():
                try:
                    return await service(config).execute(actor, identity, payload, Stub)
                except ApiError:
                    return None

            await asyncio.gather(*[attempt() for _ in range(8)])
            assert len(calls) == 1
            # Fresh service object models process restart; DB budget survives.
            with pytest.raises(ApiError, match="CALL_PERMISSION_UNAVAILABLE"):
                await service(config).execute(actor, identity, payload, Stub)
            assert len(calls) == 1
            row = await service(config).get(actor, identity)
            assert row["consumed"] and not row["authorized"]
            assert row["status"] == ("FAILED" if failure else "RUNNING")
            assert row["provider_job_known"] is not failure

    existing.run_case(real_dsn, settings_values, case)


def test_unapproved_live_and_other_profile_blocked(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            body = await request_body(engine, person)
            review = (await client.post(PATH, json=dict(request=body, mode="LIVE"))).json()
            url = PATH + "/" + review["job_id"]
            execute = dict(
                fingerprint=review["fingerprint"], confirmed=True, person_asset_id=person
            )
            assert (await client.post(url + "/execute", json=execute)).status_code == 403
            assert (await client.post(url + "/status")).status_code == 403
            # Enabled execution environment still cannot bypass missing approval.
            from pydantic import SecretStr

            config = settings.model_copy(
                update=dict(
                    app_env="staging",
                    fitroom_live_enabled=True,
                    fitroom_api_key=SecretStr("synthetic-key-never-real"),
                    fitroom_status_read_unbilled_verified=True,
                )
            )
            service = Fitroom(
                SimpleNamespace(
                    app=SimpleNamespace(state=SimpleNamespace(settings=config, resources=resources))
                )
            )
            actor = ActorContext(
                UUID(existing.HOUSEHOLD), UUID(existing.OWNER), "OWNER", UUID(int=0), "denied"
            )

            class Forbidden:
                def __init__(self, *a):
                    pytest.fail("Unapproved adapter was constructed")

            with pytest.raises(ApiError, match="CALL_PERMISSION_UNAVAILABLE"):
                await service.execute(
                    actor, UUID(review["job_id"]), FitroomExecute(**execute), Forbidden
                )
            from tests.integration.test_sprint2_api import family

            await family(client, settings)
            assert (await client.get(url)).status_code == 404
            assert (await client.post(url + "/execute", json=execute)).status_code == 404

    existing.run_case(real_dsn, settings_values, case)
