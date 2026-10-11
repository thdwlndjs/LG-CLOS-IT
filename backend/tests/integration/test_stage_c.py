"""C contracts against independently migrated disposable PostgreSQL and real MinIO."""

import asyncio
import hashlib
import io
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import text

from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint2_api import composition, key
from tests.integration.test_sprint3_api import prepared

pytestmark = pytest.mark.integration
PATH = "/api/v1/integration/vton-jobs"


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


async def request_body(engine, person):
    async with engine.connect() as c:
        assets = {
            str(r["id"]): str(r["image_asset_id"])
            for r in (
                await c.execute(text("SELECT id,image_asset_id FROM wardrobe.garment"))
            ).mappings()
        }
    return dict(
        client_context_id=str(uuid4()),
        draft_id="fixture-draft",
        draft_revision=0,
        person_asset_id=person,
        provider="MOCK",
        items=[
            dict(
                kind="OWNED",
                id=i["garment_id"],
                slot=i["slot"],
                position=0,
                expected_asset_id=assets[i["garment_id"]],
            )
            for i in composition()[:2]
        ],
    )


async def add_interests(engine, body):
    identities = []
    async with engine.begin() as c:
        for item in body["items"]:
            identity = uuid4()
            await c.execute(
                text(
                    "INSERT INTO wardrobe.liked_item(id,household_id,member_id,product_id,name,"
                    "category,color,image_asset_id,metadata) "
                    "VALUES(:id,:h,:m,:product,'Fixture',:slot,'BLUE',:a,'{}')"
                ),
                dict(
                    id=identity,
                    h=UUID(existing.HOUSEHOLD),
                    m=UUID(existing.OWNER),
                    product=str(identity),
                    slot=item["slot"],
                    a=UUID(item["expected_asset_id"]),
                ),
            )
            identities.append(str(identity))
    return identities


async def distinct_upload(client, color, purpose):
    import httpx

    output = io.BytesIO()
    Image.new("RGB", (13, 9), color).save(output, "PNG")
    data = output.getvalue()
    response = await client.post(
        "/api/v1/assets/upload-intents",
        headers=key(),
        json=dict(
            purpose=purpose,
            file_name="independent.png",
            content_type="image/png",
            size_bytes=len(data),
        ),
    )
    assert response.status_code == 201, response.text
    intent = response.json()
    async with httpx.AsyncClient() as storage:
        assert (
            await storage.put(
                intent["upload_url"], content=data, headers=intent["required_headers"]
            )
        ).status_code == 200
    response = await client.post(
        "/api/v1/assets/" + intent["asset_id"] + "/finalize",
        headers=key(),
        json=dict(checksum_sha256=hashlib.sha256(data).hexdigest()),
    )
    assert response.status_code == 201, response.text
    return response.json()["asset_id"]


@pytest.mark.parametrize("mode", ["OWNED", "LIKED", "MIXED"])
def test_c1_sources_permissions_images(real_dsn, settings_values, mode):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            body = await request_body(engine, person)
            ids = await add_interests(engine, body)
            for n, item in enumerate(body["items"]):
                if mode == "LIKED" or (mode == "MIXED" and n == 1):
                    item.update(kind="LIKED", id=ids[n])
            from app.application.common.authorization import ActorContext
            from app.application.poc_vton import resolve_inputs
            from app.infrastructure.db.sprint1_repository import Sprint1Repository
            from app.schemas.poc_vton import UnifiedVtonRequest

            actor = ActorContext(
                UUID(existing.HOUSEHOLD), UUID(existing.OWNER), "OWNER", uuid4(), "fixture"
            )
            async with resources.database.sessions.begin() as session:
                _, images, manifest = await resolve_inputs(
                    Sprint1Repository(session), actor, UnifiedVtonRequest(**body)
                )
                assert len(images) == len(manifest["items"]) == 2
                assert all(len(i["checksum_sha256"]) == 64 for i in manifest["items"])
            item = body["items"][0]
            item["expected_asset_id"] = str(uuid4())
            assert (await client.post(PATH, headers=key(), json=body)).status_code == 409
            item["id"] = existing.OTHER_GARMENT
            item["kind"] = "OWNED"
            assert (await client.post(PATH, headers=key(), json=body)).status_code == 404

    existing.run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize("mode", ["OWNED", "LIKED", "MIXED"])
def test_c3_all_real_input_bytes_and_result_storage(real_dsn, settings_values, mode):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            person = await distinct_upload(client, "red", "PERSON_VTON")
            bottom = await distinct_upload(client, "green", "GARMENT")
            async with engine.begin() as c:
                await c.execute(
                    text("UPDATE wardrobe.garment SET image_asset_id=:a WHERE id=:id"),
                    {"a": UUID(bottom), "id": UUID(composition()[1]["garment_id"])},
                )
            body = await request_body(engine, person)
            ids = await add_interests(engine, body)
            for n, item in enumerate(body["items"]):
                if mode == "LIKED" or (mode == "MIXED" and n == 1):
                    item.update(kind="LIKED", id=ids[n])
            response = await client.post(PATH, headers=key(), json=body)
            assert response.status_code == 202, response.text
            job = response.json()
            from app.application.poc_vton_worker import process_jobs
            from app.infrastructure.adapters.vton import MockVtonProvider

            received = []

            class Spy(MockVtonProvider):
                async def submit(self, request):
                    received.append(request)
                    return await super().submit(request)

            await process_jobs(settings, resources, lambda mode: Spy())
            fetched = await client.get(PATH + "/" + job["job_id"])
            assert fetched.status_code == 200, fetched.text
            result = fetched.json()
            assert result["status"] == "SUCCEEDED", result
            assert result["is_mock"] is True
            assert result["result_semantics"] == "MOCK_RECEIPT_NOT_REAL_TRY_ON"
            assert result["request_snapshot"] == job["request_snapshot"]
            assert len(received) == 1 and len(received[0].garments) == 2
            # Expected bytes come independently from actual object store records, not worker output.
            async with engine.connect() as c:
                for request_item, data, manifest_item in zip(
                    body["items"], received[0].garments, received[0].input_manifest, strict=True
                ):
                    asset = (
                        (
                            await c.execute(
                                text("SELECT * FROM wardrobe.asset WHERE id=:id"),
                                {"id": UUID(request_item["expected_asset_id"])},
                            )
                        )
                        .mappings()
                        .one()
                    )
                    stored = resources.storage.get_object(
                        Bucket=settings.storage_bucket, Key=asset["asset_key"]
                    )
                    try:
                        expected = stored["Body"].read()
                    finally:
                        stored["Body"].close()
                    assert data == expected
                    assert manifest_item.id == request_item["id"]
                    assert manifest_item.kind == request_item["kind"]
                    assert hashlib.sha256(data).hexdigest() == manifest_item.checksum_sha256
                assert await c.scalar(text("SELECT count(*) FROM wardrobe.garment")) == 4
                assert await c.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
            import httpx

            async with httpx.AsyncClient() as storage:
                image = await storage.get(result["result_asset"]["read_url"])
                assert image.status_code == 200 and image.content.startswith(b"\x89PNG")

    existing.run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize(
    "failure",
    ["tampered", "changed", "commit_changed", "consent", "cancel", "timeout", "provider_timeout"],
)
def test_c3_terminal_guards(real_dsn, settings_values, failure):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            body = await request_body(engine, person)
            job = (await client.post(PATH, headers=key(), json=body)).json()
            from app.application.poc_vton_worker import process_jobs
            from app.infrastructure.adapters.vton import MockVtonProvider

            class Racing(MockVtonProvider):
                async def get_status(self, reference):
                    if failure == "provider_timeout":
                        await asyncio.sleep(2)
                    if failure == "commit_changed":
                        async with engine.begin() as c:
                            await c.execute(
                                text("UPDATE wardrobe.garment SET version=version+1 WHERE id=:id"),
                                {"id": UUID(body["items"][0]["id"])},
                            )
                    if failure == "cancel":
                        await client.post(PATH + "/" + job["job_id"] + "/cancel", headers=key())
                    if failure == "timeout":
                        async with engine.begin() as c:
                            await c.execute(
                                text("UPDATE wardrobe.job SET status='TIMED_OUT' WHERE id=:id"),
                                {"id": UUID(job["job_id"])},
                            )
                    return await super().get_status(reference)

            async with engine.begin() as c:
                if failure == "changed":
                    await c.execute(
                        text("UPDATE wardrobe.garment SET version=version+1 WHERE id=:id"),
                        {"id": UUID(body["items"][0]["id"])},
                    )
                if failure == "consent":
                    await c.execute(
                        text("UPDATE wardrobe.member_settings SET image_upload_consent=false")
                    )
                if failure == "tampered":
                    asset_key = await c.scalar(
                        text("SELECT asset_key FROM wardrobe.asset WHERE id=:id"),
                        {"id": UUID(person)},
                    )
                    resources.storage.put_object(
                        Bucket=settings.storage_bucket,
                        Key=asset_key,
                        Body=b"bad image",
                        ContentType="image/png",
                    )
            worker_settings = (
                settings.model_copy(update={"decart_timeout_seconds": 1})
                if failure == "provider_timeout"
                else settings
            )
            await process_jobs(worker_settings, resources, lambda mode: Racing())
            async with engine.connect() as c:
                row = (
                    (
                        await c.execute(
                            text("SELECT * FROM wardrobe.job WHERE id=:id"),
                            {"id": UUID(job["job_id"])},
                        )
                    )
                    .mappings()
                    .one()
                )
                assert row["status"] in {"FAILED", "CANCELLED", "TIMED_OUT"}
                assert row["result_ref"] is None
                assert (
                    await c.scalar(
                        text(
                            "SELECT count(*) FROM wardrobe.asset WHERE kind='VTON_RESULT' "
                            "AND status='READY'"
                        )
                    )
                    == 0
                )

    existing.run_case(real_dsn, settings_values, case)


def test_c2_idempotency_active_context_cancel_and_scope(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            body = await request_body(engine, person)
            headers = key()
            a, b = await asyncio.gather(
                *[client.post(PATH, headers=headers, json=body) for _ in range(2)]
            )
            assert a.status_code == b.status_code == 202, a.text
            assert a.json() == b.json()
            identity = a.json()["job_id"]
            assert (await client.post(PATH, headers=key(), json=body)).status_code == 409
            changed = {**body, "draft_revision": 1}
            assert (await client.post(PATH, headers=headers, json=changed)).status_code == 409
            fetched = await client.get(PATH + "/" + identity)
            assert fetched.status_code == 200, fetched.text
            assert fetched.json()["request_snapshot"] == a.json()["request_snapshot"]
            assert (await client.get("/api/v1/jobs/" + identity)).status_code == 404
            cancel_key = key()
            for _ in range(2):
                assert (
                    await client.post(PATH + "/" + identity + "/cancel", headers=cancel_key)
                ).json()["status"] == "CANCELLED"
            from tests.integration.test_sprint2_api import family

            await family(client, settings)
            assert (await client.get(PATH + "/" + identity)).status_code == 404
            assert (
                await client.post(PATH + "/" + identity + "/cancel", headers=key())
            ).status_code == 404

    existing.run_case(real_dsn, settings_values, case)


def test_c_auth_family_device_liked_and_person_separation(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, owner_person, resources):
            body = await request_body(engine, owner_person)
            owner_liked = await add_interests(engine, body)
            from tests.integration.test_handoff import personal
            from tests.integration.test_sprint3_api import upload

            await personal(client, engine, settings, existing.FAMILY, "MEMBER")
            # Actor cannot borrow a family member's PERSON, even for a shared device.
            assert (await client.post(PATH, headers=key(), json=body)).status_code == 409
            config = (await client.get("/api/v1/settings")).json()
            assert (
                await client.put("/api/v1/settings", json={**config, "image_upload_consent": True})
            ).status_code == 200
            body["person_asset_id"] = await upload(client, "PERSON_VTON")
            response = await client.post(PATH, headers=key(), json=body)
            assert response.status_code == 202, response.text
            assert all(
                i["owner_id"] == existing.OWNER
                for i in response.json()["request_snapshot"]["items"]
            )
            await client.post(PATH + "/" + response.json()["job_id"] + "/cancel", headers=key())
            body["items"][0].update(kind="LIKED", id=owner_liked[0])
            assert (await client.post(PATH, headers=key(), json=body)).status_code == 404
            body["items"][0].update(kind="OWNED", id=composition()[0]["garment_id"])
            async with engine.begin() as c:
                await c.execute(
                    text("DELETE FROM wardrobe.device_member WHERE member_id=:id"),
                    {"id": UUID(existing.FAMILY)},
                )
            assert (await client.post(PATH, headers=key(), json=body)).status_code == 404
            await personal(client, engine, settings)
            async with engine.begin() as c:
                await c.execute(
                    text(
                        "UPDATE wardrobe.member_settings SET image_upload_consent=false "
                        "WHERE member_id=:id"
                    ),
                    {"id": UUID(existing.OWNER)},
                )
            assert (await client.get(PATH + "/" + response.json()["job_id"])).status_code == 404

    existing.run_case(real_dsn, settings_values, case)


def test_existing_stage_b_revision_is_ready_for_c_without_migration(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        from app.infrastructure.resources import RuntimeResources

        resources = RuntimeResources(settings)
        try:
            await resources.probe_database()
        finally:
            await resources.close()

    existing.run_case(real_dsn, settings_values, case)


def test_legacy_single_liked_worker_and_getter_remain_isolated(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with prepared(client, engine, settings) as (_, person, resources):
            c_body = await request_body(engine, person)
            unified = await client.post(PATH, headers=key(), json=c_body)
            assert unified.status_code == 202, unified.text
            legacy_path = "/api/v1/integration/shopping/liked/vton-jobs"
            headers = key()
            old_body = dict(external_item_id="mock-liked-top", person_asset_id=person)
            a = await client.post(legacy_path, headers=headers, json=old_body)
            b = await client.post(legacy_path, headers=headers, json=old_body)
            assert a.status_code == b.status_code == 202, a.text
            assert a.json() == b.json()
            from app.workers.external_vton import process

            await process(settings, resources)
            old = await client.get(legacy_path + "/" + a.json()["job_id"])
            assert old.status_code == 200 and old.json()["status"] == "SUCCEEDED", old.text
            assert old.json()["is_mock"] is True
            assert (await client.get(PATH + "/" + unified.json()["job_id"])).json()[
                "status"
            ] == "QUEUED"
            await client.post(PATH + "/" + unified.json()["job_id"] + "/cancel", headers=key())
            async with engine.connect() as c:
                assert await c.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
                assert await c.scalar(text("SELECT count(*) FROM wardrobe.garment")) == 4

    existing.run_case(real_dsn, settings_values, case)
