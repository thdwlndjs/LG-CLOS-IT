import asyncio
import io
from uuid import UUID

import httpx
import pytest
from PIL import Image
from sqlalchemy import text

from app.application.card_worker import process_cards
from app.infrastructure.resources import RuntimeResources
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import run_case
from tests.integration.test_sprint2_api import SEED_OUTFIT, family, key
from tests.integration.test_sprint3_api import prepared

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


async def draft(client, **patch):
    return await client.post(
        "/api/v1/cards/drafts",
        headers=key(),
        json={"outfit_id": SEED_OUTFIT, "template_id": "minimal-v1", **patch},
    )


async def render(client, card, **patch):
    return await client.post(
        "/api/v1/card-render-jobs", headers=key(), json=dict(card_id=card["id"], **patch)
    )


@pytest.mark.parametrize("format", ["PNG", "WEBP"])
def test_real_chromium_storage_save_share_reuse_revoke(real_dsn, settings_values, format):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            response = await draft(
                client, context_snapshot_id="50000000-0000-4000-8000-000000000001"
            )
            assert response.status_code == 201, response.text
            card = response.json()
            assert card["data"]["date"] and "schedule" not in card["data"]
            again = (
                await draft(client, context_snapshot_id="50000000-0000-4000-8000-000000000001")
            ).json()
            assert card["data"] == again["data"]
            queued = await render(client, card, output_format=format)
            assert queued.status_code == 202, queued.text
            assert (await render(client, card)).status_code == 409
            assert (
                await client.post(
                    "/api/v1/cards/" + card["id"] + "/save",
                    headers=key(),
                    json=dict(visibility="SHAREABLE"),
                )
            ).status_code == 409
            assert await process_cards(settings, resources) == 1
            job = (await client.get("/api/v1/jobs/" + queued.json()["job_id"])).json()
            assert job["status"] == "SUCCEEDED", job
            assert job["provider_mode"] is None and job["card_id"] == card["id"]
            async with httpx.AsyncClient(timeout=10) as s3:
                output = await s3.get(job["result_asset"]["read_url"])
                assert output.status_code == 200
                with Image.open(io.BytesIO(output.content)) as image:
                    assert image.size == (1080, 1350) and image.format == format
                    image.load()
            saved = await client.post(
                "/api/v1/cards/" + card["id"] + "/save",
                headers=key(),
                json=dict(visibility="SHAREABLE", reuse_outfit=True, title="Saved title"),
            )
            assert saved.status_code == 201, saved.text
            share = saved.json()["share_url"]
            assert saved.json()["linked_outfit_id"] == SEED_OUTFIT
            public = await client.get(share, headers={"Authorization": ""})
            assert public.status_code == 200 and public.content == output.content
            assert public.headers["cache-control"] == "no-store"
            assert (await client.get("/api/v1/cards")).json()["page"]["total"] == 1
            owner_auth = client.headers["Authorization"]
            await family(client, settings)
            assert (await client.get("/api/v1/cards/" + card["id"])).status_code == 404
            assert (await client.get("/api/v1/jobs/" + job["id"])).status_code == 404
            client.headers["Authorization"] = owner_auth
            async with engine.connect() as conn:
                assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
                token = await conn.scalar(
                    text("SELECT share_token_hash FROM wardrobe.outfit_card WHERE id=:id"),
                    dict(id=UUID(card["id"])),
                )
                assert token and token not in share
                cache = await conn.scalar(
                    text(
                        "SELECT response_body FROM wardrobe.idempotency_key "
                        "WHERE operation='card_save' ORDER BY created_at DESC LIMIT 1"
                    )
                )
                assert share.split("/")[-1] not in str(cache)
            private = await client.post(
                "/api/v1/cards/" + card["id"] + "/save",
                headers=key(),
                json=dict(visibility="PRIVATE"),
            )
            assert private.status_code == 201 and (await client.get(share)).status_code == 404
            share2 = (
                await client.post(
                    "/api/v1/cards/" + card["id"] + "/save",
                    headers=key(),
                    json=dict(visibility="SHAREABLE"),
                )
            ).json()["share_url"]
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "UPDATE wardrobe.outfit_card SET share_expires_at="
                        "now()-interval '1 second' WHERE id=:id"
                    ),
                    dict(id=UUID(card["id"])),
                )
            assert (await client.get(share2)).status_code == 404
            config = (await client.get("/api/v1/settings")).json()
            assert (
                await client.put("/api/v1/settings", json={**config, "image_upload_consent": False})
            ).status_code == 200
            async with httpx.AsyncClient() as s3:
                assert (await s3.get(job["result_asset"]["read_url"])).status_code == 404

    run_case(real_dsn, settings_values, case)


def test_running_cancel_late_result_and_new_render_recovery(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            card = (await draft(client)).json()
            job = (await render(client, card)).json()["job_id"]
            entered, resume = asyncio.Event(), asyncio.Event()

            async def delayed(config, payload):
                entered.set()
                await resume.wait()
                output = io.BytesIO()
                Image.new("RGB", (1080, 1350), "blue").save(output, "PNG")
                return output.getvalue()

            task = asyncio.create_task(process_cards(settings, resources, delayed))
            await asyncio.wait_for(entered.wait(), 10)
            headers = key()
            cancelled = await client.post("/api/v1/jobs/" + job + "/cancel", headers=headers)
            assert cancelled.status_code == 201, cancelled.text
            assert cancelled.json()["status"] == "CANCELLED"
            assert (
                await client.post("/api/v1/jobs/" + job + "/cancel", headers=headers)
            ).json() == cancelled.json()
            resume.set()
            await task
            assert (await client.get("/api/v1/jobs/" + job)).json()["result_asset"] is None
            assert (await client.get("/api/v1/cards/" + card["id"])).json()["status"] == "FAILED"
            async with engine.connect() as conn:
                rows = (
                    await conn.execute(
                        text(
                            "SELECT asset_key FROM wardrobe.asset "
                            "WHERE kind='CARD' AND status='DELETED'"
                        )
                    )
                ).all()
                assert len(rows) == 1
            from app.application.assets import cleanup_assets

            await cleanup_assets(settings, resources.database.sessions, resources.storage)
            from botocore.exceptions import ClientError

            with pytest.raises(ClientError):
                resources.storage.head_object(Bucket=settings.storage_bucket, Key=rows[0][0])
            replacement = await render(client, card)
            assert replacement.status_code == 202
            assert await process_cards(settings, resources) == 1
            assert (await client.get("/api/v1/cards/" + card["id"])).json()["status"] == "READY"

    run_case(real_dsn, settings_values, case)


def test_placeholder_idempotency_validation_scope(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        config = (await client.get("/api/v1/settings")).json()
        await client.put("/api/v1/settings", json={**config, "image_upload_consent": True})
        headers = key()
        body = dict(outfit_id=SEED_OUTFIT, template_id="minimal-v1")
        first, second = await asyncio.gather(
            *[client.post("/api/v1/cards/drafts", headers=headers, json=body) for _ in range(2)]
        )
        assert first.status_code == second.status_code == 201 and first.json() == second.json()
        assert all(i["image_asset_id"] is None for i in first.json()["data"]["items"])
        assert first.json()["data"]["date"] is None
        assert (
            await client.post(
                "/api/v1/cards/drafts",
                headers=headers,
                json={**body, "context_snapshot_id": "50000000-0000-4000-8000-000000000001"},
            )
        ).status_code == 409
        assert (await draft(client, template_id="invalid")).status_code == 422
        assert (await render(client, first.json(), width=100)).status_code == 422
        assert (
            await client.get(
                "/api/v1/cards", params=dict(member_id="20000000-0000-4000-8000-000000000002")
            )
        ).status_code == 403
        resources = RuntimeResources(settings)
        try:
            await render(client, first.json())
            assert await process_cards(settings, resources) == 1
            assert (await client.get("/api/v1/cards/" + first.json()["id"])).json()[
                "status"
            ] == "READY"
        finally:
            from app.application.assets import cleanup_assets

            async with engine.begin() as conn:
                await conn.execute(text("UPDATE wardrobe.asset SET status='DELETED'"))
            await cleanup_assets(settings, resources.database.sessions, resources.storage)
            await resources.close()

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize("failure", ["unavailable", "timeout", "invalid", "lease", "consent"])
def test_failure_retry_lease_cleanup_and_input_policy(real_dsn, settings_values, failure):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            card = (await draft(client)).json()
            job = (await render(client, card)).json()["job_id"]

            async def broken(config, payload):
                if failure == "timeout":
                    raise TimeoutError()
                if failure == "invalid":
                    return b"not PNG"
                raise RuntimeError("private-secret")

            if failure == "lease":
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "UPDATE wardrobe.job SET status='RUNNING',"
                            "leased_until=now()-interval '1 second' WHERE id=:id"
                        ),
                        dict(id=UUID(job)),
                    )
            if failure == "consent":
                config = (await client.get("/api/v1/settings")).json()
                await client.put("/api/v1/settings", json={**config, "image_upload_consent": False})
            await process_cards(settings, resources, broken)
            for _ in range(2):
                async with engine.begin() as conn:
                    await conn.execute(
                        text("UPDATE wardrobe.job SET next_attempt_at=now() WHERE id=:id"),
                        dict(id=UUID(job)),
                    )
                await process_cards(settings, resources, broken)
            got = (await client.get("/api/v1/jobs/" + job)).json()
            assert got["status"] in ("FAILED", "TIMED_OUT"), got
            assert "private-secret" not in str(got)
            assert got["attempt_count"] == (
                3 if failure in ("unavailable", "timeout") else 0 if failure == "lease" else 1
            )
            assert (await client.get("/api/v1/cards/" + card["id"])).json()["status"] == "FAILED"
            async with engine.connect() as conn:
                assert (
                    await conn.scalar(
                        text(
                            "SELECT count(*) FROM wardrobe.asset "
                            "WHERE kind='CARD' AND status='READY'"
                        )
                    )
                    == 0
                )

    run_case(real_dsn, settings_values, case)
