import asyncio
import hashlib
import io
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import httpx
import pytest
from botocore.exceptions import ClientError
from PIL import Image
from sqlalchemy import text

from app.application.assets import cleanup_assets
from app.application.vton_worker import process_jobs
from app.domain.vton import ProviderFailure
from app.infrastructure.adapters.vton import MockVtonProvider
from app.infrastructure.resources import RuntimeResources
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import GARMENT, OWNER, run_case
from tests.integration.test_sprint2_api import SEED_OUTFIT, composition, family, key

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


async def new_session(client, **patch):
    return await client.post(
        "/api/v1/vton-sessions",
        headers=key(),
        json={
            "member_id": OWNER,
            "source_screen": "MY_OUTFITS",
            "outfit_id": SEED_OUTFIT,
            **patch,
        },
    )


async def submit(client, session, person, headers=None, **patch):
    return await client.post(
        "/api/v1/vton-jobs",
        headers=headers or key(),
        json={
            "session_id": session["id"],
            "expected_revision": session["revision"],
            "outfit_id": session["outfit_id"],
            "person_asset_id": person,
            **patch,
        },
    )


async def upload(client, purpose):
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, "PNG")
    data = output.getvalue()
    intent = await client.post(
        "/api/v1/assets/upload-intents",
        headers=key(),
        json=dict(
            purpose=purpose,
            file_name="fixture.png",
            content_type="image/png",
            size_bytes=len(data),
        ),
    )
    assert intent.status_code == 201, intent.text
    async with httpx.AsyncClient(timeout=10) as storage:
        response = await storage.put(
            intent.json()["upload_url"], content=data, headers=intent.json()["required_headers"]
        )
        assert response.status_code == 200
    asset = await client.post(
        "/api/v1/assets/" + intent.json()["asset_id"] + "/finalize",
        headers=key(),
        json=dict(checksum_sha256=hashlib.sha256(data).hexdigest()),
    )
    assert asset.status_code == 201, asset.text
    return asset.json()["asset_id"]


@asynccontextmanager
async def prepared(client, engine, settings):
    resources = RuntimeResources(settings)
    try:
        config = (await client.get("/api/v1/settings")).json()
        assert (
            await client.put("/api/v1/settings", json={**config, "image_upload_consent": True})
        ).status_code == 200
        person = await upload(client, "PERSON_VTON")
        garment = await upload(client, "GARMENT")
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.garment SET image_asset_id=:a WHERE owner_id=:m"),
                dict(a=UUID(garment), m=UUID(OWNER)),
            )
        created = await new_session(client, person_asset_id=person)
        assert created.status_code == 201, created.text
        yield created.json(), person, resources
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE wardrobe.asset SET status='DELETED'"))
        await cleanup_assets(settings, resources.database.sessions, resources.storage)
        await resources.close()


@pytest.mark.parametrize(
    "source", ["HOME", "GARMENT_DETAIL", "MY_OUTFITS", "OUTFIT_EDITOR", "CALENDAR", "OTHER"]
)
def test_entry_source_clone_scope_and_idempotency(real_dsn, settings_values, source):
    async def case(client, engine, settings, *unused):
        headers = key()
        body = dict(member_id=OWNER, source_screen=source, outfit_id=SEED_OUTFIT)
        first, second = await asyncio.gather(
            *[client.post("/api/v1/vton-sessions", headers=headers, json=body) for _ in range(2)]
        )
        assert first.status_code == second.status_code == 201, first.text
        assert first.json() == second.json()
        session = first.json()
        assert session["source_outfit_id"] == SEED_OUTFIT and session["outfit_id"] != SEED_OUTFIT
        assert session["source_screen"] == source and session["provider_mode"] == "MOCK"
        assert (
            not session["vton_available"]
            and "PERSON_IMAGE_REQUIRED" in session["unavailable_reasons"]
        )
        assert (await client.get("/api/v1/vton-sessions/" + session["id"])).json() == session
        assert (
            await client.patch(
                "/api/v1/outfits/" + session["outfit_id"],
                headers={"If-Match": "1"},
                json=dict(items=composition()),
            )
        ).status_code == 409
        assert (await client.get("/api/v1/outfits/" + SEED_OUTFIT)).json()["version"] == 1
        await family(client, settings)
        assert (await client.get("/api/v1/vton-sessions/" + session["id"])).status_code == 404
        assert (await new_session(client)).status_code == 403
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit_session")) == 1

    run_case(real_dsn, settings_values, case)


def test_revision_snapshot_end_feedback_and_no_wear(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        created = await new_session(client)
        assert created.status_code == 201, created.text
        original = created.json()
        changed = await client.patch(
            "/api/v1/vton-sessions/" + original["id"] + "/outfit",
            json=dict(expected_revision=0, items=composition()[:2]),
        )
        assert changed.status_code == 200, changed.text
        current = changed.json()
        assert current["revision"] == 1 and current["outfit_id"] != original["outfit_id"]
        assert (
            len((await client.get("/api/v1/outfits/" + original["outfit_id"])).json()["items"]) == 3
        )
        assert (
            await client.patch(
                "/api/v1/vton-sessions/" + current["id"] + "/outfit",
                json=dict(expected_revision=0, items=[]),
            )
        ).status_code == 409
        body = dict(expected_revision=1, final_outfit_id=current["outfit_id"], save_outfit=True)
        headers = key()
        ended = await client.post(
            "/api/v1/vton-sessions/" + current["id"] + "/end", json=body, headers=headers
        )
        assert ended.status_code == 201, ended.text
        assert (
            ended.json()["status"] == "ENDED"
            and ended.json()["card_entry_payload"]["outfit_id"] == current["outfit_id"]
        )
        assert (
            await client.post(
                "/api/v1/vton-sessions/" + current["id"] + "/end", json=body, headers=headers
            )
        ).json() == ended.json()
        assert (
            await client.post(
                "/api/v1/vton-sessions/" + current["id"] + "/end", json=body, headers=key()
            )
        ).status_code == 409
        assert (await client.get("/api/v1/outfits/" + current["outfit_id"])).json()[
            "status"
        ] == "SAVED"
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
            assert (
                await conn.scalar(text("SELECT feedback_type FROM wardrobe.outfit_feedback"))
                == "MODIFIED"
            )
            assert (
                await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit_session_event")) == 3
            )

    run_case(real_dsn, settings_values, case)


def test_mock_worker_image_current_stale_and_consent(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (session, person, resources):
            assert session["vton_available"]
            headers = key()
            first, second = await asyncio.gather(
                *[submit(client, session, person, headers) for _ in range(2)]
            )
            assert first.status_code == second.status_code == 202 and first.json() == second.json()
            target = first.json()["job_id"]
            assert (await client.get("/api/v1/jobs/" + target)).json()["status"] == "QUEUED"
            assert await process_jobs(settings, resources) == 1
            assert await process_jobs(settings, resources) == 0
            job = (await client.get("/api/v1/jobs/" + target)).json()
            assert (
                job["status"] == "SUCCEEDED"
                and job["provider_mode"] == "MOCK"
                and job["is_current"]
            )
            async with httpx.AsyncClient(timeout=10) as storage:
                data = (await storage.get(job["result_asset"]["read_url"])).content
                with Image.open(io.BytesIO(data)) as image:
                    assert image.format == "PNG" and image.size == (320, 240)
                assert (
                    await storage.get(job["result_asset"]["read_url"].split("?")[0])
                ).status_code == 403
                detail = (await client.get("/api/v1/vton-sessions/" + session["id"])).json()
                assert detail["current_result_job_id"] == target
                changed = await client.patch(
                    "/api/v1/vton-sessions/" + session["id"] + "/outfit",
                    json=dict(expected_revision=0, items=composition()[:2]),
                )
                assert (
                    changed.status_code == 200 and changed.json()["current_result_job_id"] is None
                )
                old = (await client.get("/api/v1/jobs/" + target)).json()
                assert old["stale"] and not old["is_current"]
                newer = await submit(client, changed.json(), person)
                assert newer.status_code == 202
                await process_jobs(settings, resources)
                assert (await client.get("/api/v1/vton-sessions/" + session["id"])).json()[
                    "current_result_job_id"
                ] == newer.json()["job_id"]
                config = (await client.get("/api/v1/settings")).json()
                assert (
                    await client.put(
                        "/api/v1/settings", json={**config, "image_upload_consent": False}
                    )
                ).status_code == 200
                assert (await storage.get(job["result_asset"]["read_url"])).status_code == 404
                assert (await client.get("/api/v1/jobs/" + target)).json()["result_asset"] is None
                assert not (await client.get("/api/v1/vton-sessions/" + session["id"])).json()[
                    "vton_available"
                ]
            async with engine.connect() as conn:
                assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
                assert await conn.scalar(
                    text(
                        "SELECT (provider_metadata->>'is_mock')::boolean "
                        "FROM wardrobe.vton_job LIMIT 1"
                    )
                )

    run_case(real_dsn, settings_values, case)


def test_late_result_after_revision_and_running_cancel(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (session, person, resources):
            started, release = asyncio.Event(), asyncio.Event()

            class Slow(MockVtonProvider):
                async def submit(self, request):
                    started.set()
                    await release.wait()
                    return await super().submit(request)

            first = await submit(client, session, person)
            task = asyncio.create_task(process_jobs(settings, resources, lambda _: Slow()))
            await asyncio.wait_for(started.wait(), 5)
            changed = await client.patch(
                "/api/v1/vton-sessions/" + session["id"] + "/outfit",
                json=dict(expected_revision=0, items=composition()[:2]),
            )
            assert changed.status_code == 200
            release.set()
            await task
            assert (await client.get("/api/v1/jobs/" + first.json()["job_id"])).json()["stale"]
            assert (await client.get("/api/v1/vton-sessions/" + session["id"])).json()[
                "current_result_job_id"
            ] is None
            started.clear()
            release.clear()
            second = await submit(client, changed.json(), person)
            task = asyncio.create_task(process_jobs(settings, resources, lambda _: Slow()))
            await asyncio.wait_for(started.wait(), 5)
            headers = key()
            cancelled = await client.post(
                "/api/v1/jobs/" + second.json()["job_id"] + "/cancel", headers=headers
            )
            assert cancelled.status_code == 201 and cancelled.json()["status"] == "CANCELLED"
            release.set()
            await task
            assert (await client.get("/api/v1/jobs/" + second.json()["job_id"])).json()[
                "result_asset"
            ] is None
            assert (
                await client.post(
                    "/api/v1/jobs/" + second.json()["job_id"] + "/cancel", headers=headers
                )
            ).json() == cancelled.json()
            assert (
                await client.post(
                    "/api/v1/jobs/" + second.json()["job_id"] + "/cancel", headers=key()
                )
            ).status_code == 409

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize("failure", ["retry", "policy", "timeout", "invalid_result", "lease"])
def test_provider_failures_bounded_retry_timeout_and_lease(real_dsn, settings_values, failure):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (session, person, resources):
            accepted = await submit(client, session, person)
            target = accepted.json()["job_id"]

            class Failing(MockVtonProvider):
                async def submit(self, request):
                    if failure == "timeout":
                        await asyncio.sleep(2)
                    if failure == "policy":
                        raise ProviderFailure("PROVIDER_CAPABILITY_UNAVAILABLE")
                    if failure == "retry":
                        raise ProviderFailure("PROVIDER_RATE_LIMITED", True)
                    return await super().submit(request)

                async def get_status(self, reference):
                    if failure == "invalid_result":
                        from app.domain.vton import ProviderStatus

                        return ProviderStatus("SUCCEEDED", b"bad image", True)
                    return await super().get_status(reference)

            if failure == "lease":
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "UPDATE wardrobe.job SET status='RUNNING',lease_owner='lost',"
                            "leased_until=now()-interval '1 second' WHERE id=:id"
                        ),
                        dict(id=UUID(target)),
                    )
            await process_jobs(
                settings.model_copy(update={"decart_timeout_seconds": 1}),
                resources,
                lambda _: Failing(),
            )
            first = (await client.get("/api/v1/jobs/" + target)).json()
            if failure == "retry":
                assert first["status"] == "QUEUED" and first["attempt_count"] == 1
                for _ in range(2):
                    async with engine.begin() as conn:
                        await conn.execute(
                            text("UPDATE wardrobe.job SET next_attempt_at=now() WHERE id=:id"),
                            dict(id=UUID(target)),
                        )
                    await process_jobs(settings, resources, lambda _: Failing())
                final = (await client.get("/api/v1/jobs/" + target)).json()
                assert final["status"] == "FAILED" and final["attempt_count"] == 3
                assert final["error"]["code"] == "PROVIDER_RATE_LIMITED"
            else:
                assert first["status"] == (
                    "TIMED_OUT" if failure in {"timeout", "lease"} else "FAILED"
                )
                assert first["error"] and first["result_asset"] is None
            assert await process_jobs(settings, resources) == 0

    run_case(real_dsn, settings_values, case)


def test_job_scope_input_validation_queue_cancel_and_live_boundary(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (session, person, resources):
            assert (await submit(client, session, person, provider="DECART")).status_code == 503
            assert (
                await submit(client, session, person, expected_revision=True)
            ).status_code == 422
            assert (await submit(client, session, person, outfit_id=SEED_OUTFIT)).status_code == 409
            assert (await submit(client, session, str(uuid4()))).status_code == 409
            accepted = await submit(client, session, person)
            target = accepted.json()["job_id"]
            owner_auth = client.headers["Authorization"]
            await family(client, settings)
            assert (await client.get("/api/v1/jobs/" + target)).status_code == 404
            assert (
                await client.post("/api/v1/jobs/" + target + "/cancel", headers=key())
            ).status_code == 404
            assert (await submit(client, session, person)).status_code == 404
            client.headers["Authorization"] = owner_auth
            assert (
                await client.post("/api/v1/jobs/" + target + "/cancel", headers=key())
            ).status_code == 201
            assert await process_jobs(settings, resources) == 0

    run_case(real_dsn, settings_values, case)


def test_uploaded_orphan_tracked_on_commit_failure(real_dsn, settings_values, monkeypatch):
    from app.application import vton_worker

    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (session, person, resources):
            accepted = await submit(client, session, person)
            target = accepted.json()["job_id"]
            async with engine.begin() as conn:
                await conn.execute(
                    text("UPDATE wardrobe.job SET max_attempts=1 WHERE id=:id"),
                    dict(id=UUID(target)),
                )
            original = vton_worker.worker_event

            async def fail(repo, row, event, payload):
                if event == "VtonJobSucceeded":
                    raise RuntimeError("Injected commit failure")
                return await original(repo, row, event, payload)

            monkeypatch.setattr(vton_worker, "worker_event", fail)
            await process_jobs(settings, resources)
            job = (await client.get("/api/v1/jobs/" + target)).json()
            assert job["status"] == "FAILED" and job["result_asset"] is None
            async with engine.connect() as conn:
                asset = (
                    (
                        await conn.execute(
                            text(
                                "SELECT asset_key,status FROM wardrobe.asset "
                                "WHERE kind='VTON_RESULT'"
                            )
                        )
                    )
                    .mappings()
                    .one()
                )
                assert asset["status"] == "DELETED"
            resources.storage.head_object(Bucket=settings.storage_bucket, Key=asset["asset_key"])
            await cleanup_assets(settings, resources.database.sessions, resources.storage)
            with pytest.raises(ClientError) as error:
                resources.storage.head_object(
                    Bucket=settings.storage_bucket, Key=asset["asset_key"]
                )
            assert error.value.response["Error"]["Code"] == "404"

    run_case(real_dsn, settings_values, case)


def test_single_garment_empty_entry_and_unsupported_slot(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        empty = await new_session(client, outfit_id=None)
        assert empty.status_code == 201 and empty.json()["items"] == []
        single = await new_session(client, outfit_id=None, garment_id=GARMENT)
        assert single.status_code == 201 and len(single.json()["items"]) == 1
        assert not single.json()["vton_available"]
        assert (await new_session(client, garment_id=GARMENT)).status_code == 422
        assert (
            await new_session(client, outfit_id=None, garment_id=str(uuid4()))
        ).status_code == 404
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.garment SET category='UNSUPPORTED' WHERE id=:id"),
                dict(id=UUID(GARMENT)),
            )
        assert (await new_session(client, outfit_id=None, garment_id=GARMENT)).status_code == 422
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit_session")) == 2

    run_case(real_dsn, settings_values, case)


def test_missing_media_no_job_and_end_without_wear_or_save(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (session, person, resources):
            async with engine.begin() as conn:
                await conn.execute(text("UPDATE wardrobe.garment SET image_asset_id=NULL"))
            assert (await submit(client, session, person)).status_code == 409
            ended = await client.post(
                "/api/v1/vton-sessions/" + session["id"] + "/end",
                json=dict(expected_revision=0, save_outfit=False),
                headers=key(),
            )
            assert ended.status_code == 201, ended.text
            assert ended.json()["final_items_snapshot"] == session["items"]
            assert (await client.get("/api/v1/outfits/" + session["outfit_id"])).json()[
                "status"
            ] == "DRAFT"
            async with engine.connect() as conn:
                assert await conn.scalar(text("SELECT count(*) FROM wardrobe.job")) == 0
                assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
                assert (
                    await conn.scalar(text("SELECT feedback_type FROM wardrobe.outfit_feedback"))
                    == "ACCEPTED"
                )

    run_case(real_dsn, settings_values, case)


def test_reverted_selection_is_accepted_final_feedback(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        session = (await new_session(client)).json()
        for revision, items in enumerate((composition()[:2], composition())):
            response = await client.patch(
                "/api/v1/vton-sessions/" + session["id"] + "/outfit",
                json=dict(expected_revision=revision, items=items),
            )
            assert response.status_code == 200
        ended = await client.post(
            "/api/v1/vton-sessions/" + session["id"] + "/end",
            json=dict(expected_revision=2),
            headers=key(),
        )
        assert ended.status_code == 201
        async with engine.connect() as conn:
            assert (
                await conn.scalar(text("SELECT feedback_type FROM wardrobe.outfit_feedback"))
                == "ACCEPTED"
            )
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0

    run_case(real_dsn, settings_values, case)
