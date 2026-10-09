"""Real PostgreSQL/Redis/MinIO acceptance and regression for Sprint 2."""

import asyncio
import hashlib
import io
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from PIL import Image
from sqlalchemy import text

from app.core.security import issue_token
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import (
    FAMILY,
    GARMENT,
    HOUSEHOLD,
    OWNER,
    run_case,
)

pytestmark = pytest.mark.integration
BOTTOM = "40000000-0000-4000-8000-000000000002"
SHOES = "40000000-0000-4000-8000-000000000003"
SEED_CONTEXT = "50000000-0000-4000-8000-000000000001"
SEED_OUTFIT = "60000000-0000-4000-8000-000000000001"


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def key():
    return {"Idempotency-Key": str(uuid4())}


def composition():
    return [
        dict(garment_id=GARMENT, slot="TOP", position=0),
        dict(garment_id=BOTTOM, slot="BOTTOM", position=0),
        dict(garment_id=SHOES, slot="SHOES", position=0),
    ]


async def family(client, settings):
    _, token, _ = issue_token(settings, UUID(FAMILY), UUID(HOUSEHOLD), "MEMBER")
    client.headers["Authorization"] = "Bearer " + token


async def capture(client, **patch):
    return await client.post(
        "/api/v1/context-snapshots",
        headers=key(),
        json={"member_id": OWNER, "timezone": "Asia/Seoul", "mode": "MOCK", **patch},
    )


def test_context_provenance_legacy_missing_and_immutable_replay(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        payload = dict(member_id=OWNER, timezone="Asia/Seoul", mode="MOCK")
        headers = key()
        first = await client.post("/api/v1/context-snapshots", json=payload, headers=headers)
        assert first.status_code == 201, first.text
        context = first.json()
        assert context["source_mode"] == "MOCK" and context["is_holiday"] is None
        assert context["weather"]["temperature_c"] == 18 and context["schedule"] == []
        assert context["source_status"]["weather"]["is_mock"] is True
        assert "is_holiday" in context["missing_fields"]
        assert (
            await client.post("/api/v1/context-snapshots", json=payload, headers=headers)
        ).json() == context
        assert (await client.get("/api/v1/context-snapshots/" + context["id"])).json() == context
        legacy = await client.get("/api/v1/context-snapshots/" + SEED_CONTEXT)
        assert legacy.status_code == 200 and legacy.json()["schedule"] == []
        assert any("starts_at" in x for x in legacy.json()["missing_fields"])
        for changes in [
            dict(timezone="Not/AZone"),
            dict(at="2026-01-01T00:00:00"),
            dict(at=(datetime.now(UTC) + timedelta(days=1)).isoformat()),
            dict(at=123),
        ]:
            assert (await capture(client, **changes)).status_code == 422
        assert (await capture(client, member_id=FAMILY)).status_code == 403
        await family(client, settings)
        assert (await client.get("/api/v1/context-snapshots/" + context["id"])).status_code == 404

    run_case(real_dsn, settings_values, case)


def test_outfit_crud_archive_concurrent_idempotency_and_retired_reference(
    real_dsn, settings_values
):
    async def case(client, engine, settings, *unused):
        body = dict(title="Fixture look", status="SAVED", items=composition())
        headers = key()
        first, second = await asyncio.gather(
            *[client.post("/api/v1/outfits", json=body, headers=headers) for _ in range(2)]
        )
        assert first.status_code == second.status_code == 201 and first.json() == second.json()
        outfit = first.json()
        target = outfit["id"]
        assert outfit["try_on_ready"] and outfit["missing_garment_ids"] == []
        assert (await client.get("/api/v1/outfits/" + target)).json() == outfit
        page = (await client.get("/api/v1/outfits?status=SAVED&limit=1&offset=1")).json()
        assert page["page"] == dict(limit=1, offset=1, total=2)
        assert (
            await client.patch(
                "/api/v1/outfits/" + target,
                json={**body, "title": "Updated"},
                headers={"If-Match": "1"},
            )
        ).status_code == 200
        assert (
            await client.patch("/api/v1/outfits/" + target, json=body, headers={"If-Match": "1"})
        ).status_code == 409
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.garment SET retired_at=now() WHERE id=:id"),
                dict(id=UUID(GARMENT)),
            )
        detail = (await client.get("/api/v1/outfits/" + target)).json()
        assert detail["missing_garment_ids"] == [GARMENT] and not detail["try_on_ready"]
        archive = await client.patch(
            "/api/v1/outfits/" + target,
            json={**body, "status": "ARCHIVED"},
            headers={"If-Match": "2"},
        )
        assert archive.status_code == 200 and archive.json()["status"] == "ARCHIVED"
        assert (
            await client.patch("/api/v1/outfits/" + target, json=body, headers={"If-Match": "3"})
        ).status_code == 409
        await family(client, settings)
        assert (await client.get("/api/v1/outfits/" + target)).status_code == 404
        assert (await client.get("/api/v1/outfits?member_id=" + OWNER)).status_code == 403
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit")) == 2

    run_case(real_dsn, settings_values, case)


def test_outfit_invalid_slots_scope_and_effective_saved_status(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        for items in [
            composition() + [composition()[0]],
            [dict(garment_id=GARMENT, slot="SHOES")],
            [dict(garment_id=GARMENT, slot="TOP", position=-1)],
            [dict(garment_id=GARMENT, slot="TOP", position=True)],
            [dict(garment_id=GARMENT, slot="TOP")],
        ]:
            assert (
                await client.post(
                    "/api/v1/outfits", json=dict(items=items, status="SAVED"), headers=key()
                )
            ).status_code == 422
        assert (
            await client.patch(
                "/api/v1/outfits/" + SEED_OUTFIT, json={"items": []}, headers={"If-Match": "1"}
            )
        ).status_code == 422
        draft = await client.post("/api/v1/outfits", json={"items": []}, headers=key())
        assert draft.status_code == 201 and not draft.json()["try_on_ready"]
        await family(client, settings)
        assert (
            await client.post("/api/v1/outfits", json=dict(items=composition()), headers=key())
        ).status_code == 404

    run_case(real_dsn, settings_values, case)


def test_recommendation_fixed_result_filters_trace_replay_and_shared_scope(
    real_dsn, settings_values
):
    async def case(client, engine, settings, *unused):
        ctx = (await capture(client)).json()["id"]
        body = dict(
            member_id=OWNER, context_snapshot_id=ctx, limit=5, constraints={"season": "SPRING"}
        )
        headers = key()
        first, second = await asyncio.gather(
            *[
                client.post("/api/v1/outfit-recommendations", json=body, headers=headers)
                for _ in range(2)
            ]
        )
        assert first.status_code == second.status_code == 201, first.text
        result = first.json()
        assert second.json() == result
        assert len(result["candidates"]) == 1 and result["candidates"][0]["score"] == 70
        assert [i["garment_id"] for i in result["candidates"][0]["outfit"]["items"]] == [
            GARMENT,
            BOTTOM,
            SHOES,
        ]
        assert result["fallback_used"]
        assert (
            await client.get("/api/v1/outfits/" + result["candidates"][0]["outfit"]["id"])
        ).status_code == 200
        async with engine.connect() as conn:
            event = await conn.scalar(
                text(
                    "SELECT payload FROM wardrobe.domain_event_outbox "
                    "WHERE event_type='OutfitRecommended'"
                )
            )
            assert (
                event["context_snapshot_id"] == ctx and event["rule_version"] == "sprint2-rules-v1"
            )
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit_session")) == 0
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.garment_state SET status='LAUNDRY' WHERE garment_id=:id"),
                dict(id=UUID(GARMENT)),
            )
        empty = await client.post("/api/v1/outfit-recommendations", json=body, headers=key())
        assert empty.status_code == 201 and empty.json()["candidates"] == []
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.garment_state SET status='AVAILABLE' WHERE garment_id=:id"),
                dict(id=UUID(GARMENT)),
            )
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.care_profile(garment_id,special_care) "
                    "VALUES (:id,true) ON CONFLICT(garment_id) "
                    "DO UPDATE SET special_care=true"
                ),
                dict(id=UUID(GARMENT)),
            )
        assert (
            await client.post("/api/v1/outfit-recommendations", json=body, headers=key())
        ).json()["candidates"] == []
        await family(client, settings)
        assert (
            await client.post(
                "/api/v1/outfit-recommendations", json={**body, "member_id": FAMILY}, headers=key()
            )
        ).status_code == 404

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize(
    "changes",
    [
        {"limit": 0},
        {"limit": 21},
        {"limit": True},
        {"theme": "ANY"},
        {"constraints": {"unknown": True}},
        {"constraints": {"season": []}},
        {"constraints": {"max_items": True}},
        {"constraints": {"excluded_garment_ids": ["bad"]}},
    ],
)
def test_recommendation_invalid_inputs(real_dsn, settings_values, changes):
    async def case(client, engine, settings, *unused):
        ctx = (await capture(client)).json()["id"]
        result = await client.post(
            "/api/v1/outfit-recommendations",
            json=dict(member_id=OWNER, context_snapshot_id=ctx, **changes),
            headers=key(),
        )
        assert result.status_code == 422

    run_case(real_dsn, settings_values, case)


def test_style_upload_link_filter_scope_delete_and_consent(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        config = (await client.get("/api/v1/settings")).json()
        assert (
            await client.put("/api/v1/settings", json={**config, "image_upload_consent": True})
        ).status_code == 200
        output = io.BytesIO()
        Image.new("RGB", (8, 8), "blue").save(output, "PNG")
        data = output.getvalue()
        intent = await client.post(
            "/api/v1/assets/upload-intents",
            json=dict(
                file_name="reference.png",
                content_type="image/png",
                size_bytes=len(data),
                purpose="STYLE",
            ),
            headers=key(),
        )
        assert intent.status_code == 201, intent.text
        upload = intent.json()
        asset_id = upload["asset_id"]
        async with httpx.AsyncClient(timeout=10) as storage:
            assert (
                await storage.put(
                    upload["upload_url"], content=data, headers=upload["required_headers"]
                )
            ).status_code == 200
            finalized = await client.post(
                "/api/v1/assets/" + asset_id + "/finalize",
                json={"checksum_sha256": hashlib.sha256(data).hexdigest()},
                headers=key(),
            )
            assert finalized.status_code == 201
            asset = finalized.json()
            assert (await storage.get(asset["read_url"])).content == data
            body = dict(
                member_id=OWNER,
                source="INSTAGRAM",
                title="Reference",
                source_url="https://example.com/style",
                image_asset_id=asset_id,
            )
            headers = key()
            created = await client.post("/api/v1/style-references", json=body, headers=headers)
            assert created.status_code == 201, created.text
            assert (
                await client.post("/api/v1/style-references", json=body, headers=headers)
            ).json() == created.json()
            target = created.json()["id"]
            page = (await client.get("/api/v1/style-references?source=INSTAGRAM")).json()
            assert page["page"]["total"] == 1 and page["items"][0]["image_asset_id"] == asset_id
            assert (await storage.get(page["items"][0]["image"]["read_url"])).content == data
            assert (await client.get("/api/v1/style-references?source=SHOPPING")).json()[
                "items"
            ] == []
            assert (
                await client.post(
                    "/api/v1/style-references",
                    json={**body, "source_url": "http://user:pass@example.com/"},
                    headers=key(),
                )
            ).status_code == 422
            assert (
                await client.post(
                    "/api/v1/style-references",
                    json={**body, "source_url": "file:///secret"},
                    headers=key(),
                )
            ).status_code == 422
            owner_auth = client.headers["Authorization"]
            await family(client, settings)
            assert (await client.get("/api/v1/style-references")).json()["items"] == []
            assert (await client.delete("/api/v1/style-references/" + target)).status_code == 404
            assert (
                await client.post(
                    "/api/v1/style-references", json={**body, "member_id": FAMILY}, headers=key()
                )
            ).status_code == 404
            client.headers["Authorization"] = owner_auth
            assert (await client.put("/api/v1/settings", json=config)).status_code == 200
            assert (await storage.get(asset["read_url"])).status_code == 404
            assert (await client.get("/api/v1/style-references")).json()["items"][0][
                "image_asset_id"
            ] is None
            assert (await client.get("/api/v1/style-references")).json()["items"][0][
                "image"
            ] is None
            assert (await client.delete("/api/v1/style-references/" + target)).status_code == 204
            assert (await client.delete("/api/v1/style-references/" + target)).status_code == 404

    run_case(real_dsn, settings_values, case)


def test_partial_context_without_fake_live_provider(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        response = await capture(client, mode="AUTO")
        assert response.status_code == 201
        context = response.json()
        assert context["source_mode"] == "PARTIAL" and context["weather"]["temperature_c"] is None
        assert context["source_status"]["weather"]["source"] == "UNCONFIGURED"
        assert not context["source_status"]["weather"]["is_mock"]
        assert "schedule" in context["missing_fields"]
        response = await client.post(
            "/api/v1/outfit-recommendations",
            headers=key(),
            json=dict(member_id=OWNER, context_snapshot_id=context["id"]),
        )
        assert response.status_code == 201 and response.json()["candidates"][0]["score"] == 50
        assert not any("temperature" in r for r in response.json()["candidates"][0]["reasons"])

    run_case(
        real_dsn, {**settings_values, "weather_provider": "LIVE", "calendar_provider": "LIVE"}, case
    )


def test_shared_recommendation_revoke_and_atomic_failure(real_dsn, settings_values, monkeypatch):
    from app.application.sprint2 import Sprint2

    async def case(client, engine, settings, *unused):
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.garment_share(garment_id,member_id,household_id) "
                    "SELECT id,:m,household_id FROM wardrobe.garment WHERE owner_id=:owner"
                ),
                dict(m=UUID(FAMILY), owner=UUID(OWNER)),
            )
        await family(client, settings)
        ctx = (await capture(client, member_id=FAMILY)).json()["id"]
        body = dict(member_id=FAMILY, context_snapshot_id=ctx)
        recommended = await client.post("/api/v1/outfit-recommendations", json=body, headers=key())
        assert recommended.status_code == 201 and len(recommended.json()["candidates"]) == 1
        outfit_id = recommended.json()["candidates"][0]["outfit"]["id"]
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM wardrobe.garment_share WHERE member_id=:m"), dict(m=UUID(FAMILY))
            )
        detail = (await client.get("/api/v1/outfits/" + outfit_id)).json()
        assert set(detail["missing_garment_ids"]) == {GARMENT, BOTTOM, SHOES}
        assert not detail["try_on_ready"]
        assert (
            await client.post("/api/v1/outfit-recommendations", json=body, headers=key())
        ).json()["candidates"] == []
        _, token, _ = issue_token(settings, UUID(OWNER), UUID(HOUSEHOLD), "OWNER")
        client.headers["Authorization"] = "Bearer " + token
        ctx = (await capture(client)).json()["id"]
        async with engine.connect() as conn:
            before = await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit"))
        original = Sprint2.event

        async def fail(self, repo, actor, event, *args):
            if event == "OutfitRecommended":
                raise RuntimeError("Injected outbox failure after candidate insert")
            return await original(self, repo, actor, event, *args)

        monkeypatch.setattr(Sprint2, "event", fail)
        headers = key()
        body = dict(member_id=OWNER, context_snapshot_id=ctx)
        assert (
            await client.post("/api/v1/outfit-recommendations", json=body, headers=headers)
        ).status_code == 500
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit")) == before
        monkeypatch.setattr(Sprint2, "event", original)
        assert (
            await client.post("/api/v1/outfit-recommendations", json=body, headers=headers)
        ).status_code == 201

    run_case(real_dsn, settings_values, case)


def test_history_temporal_cutoff_mutation_and_schedule_scoring(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        now = datetime.now(UTC)
        at = now - timedelta(hours=1)
        context = (await capture(client, at=at.isoformat())).json()["id"]
        sid = uuid4()
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.outfit SET updated_at=:t WHERE id=:id"),
                dict(t=now - timedelta(days=3), id=UUID(SEED_OUTFIT)),
            )
            for confirmed in [at - timedelta(minutes=1), now]:
                await conn.execute(
                    text(
                        "INSERT INTO wardrobe.wear_event(member_id,outfit_id,worn_at,"
                        "confirmed_at,confirmation_method) "
                        "VALUES (:m,:o,:w,:c,'USER')"
                    ),
                    dict(m=UUID(OWNER), o=UUID(SEED_OUTFIT), w=at - timedelta(days=1), c=confirmed),
                )
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.outfit_session(id,member_id,source_screen) "
                    "VALUES (:id,:m,'TEST')"
                ),
                dict(id=sid, m=UUID(OWNER)),
            )
            for created in [at - timedelta(minutes=1), now]:
                await conn.execute(
                    text(
                        "INSERT INTO wardrobe.outfit_feedback(session_id,outfit_id,"
                        "feedback_type,created_at) "
                        "VALUES (:s,:o,'ACCEPTED',:t)"
                    ),
                    dict(s=sid, o=UUID(SEED_OUTFIT), t=created),
                )
        body = dict(member_id=OWNER, context_snapshot_id=context, constraints={"season": "SPRING"})

        async def score():
            response = await client.post("/api/v1/outfit-recommendations", json=body, headers=key())
            assert response.status_code == 201, response.text
            return response.json()["candidates"][0]

        result = await score()
        assert result["score"] == 61  # 70 - 3 confirmed garment wears*5 + 3 feedbacks*2
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.outfit SET updated_at=:t WHERE id=:id"),
                dict(t=now, id=UUID(SEED_OUTFIT)),
            )
        assert (await score())["score"] == 70  # Changed compositions cannot reconstruct old wear.
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE wardrobe.garment SET attributes='{"
                    + '"style_tags":["WORK"]'
                    + "}'::jsonb WHERE owner_id=:m"
                ),
                dict(m=UUID(OWNER)),
            )
            await conn.execute(
                text(
                    "UPDATE wardrobe.context_snapshot SET schedule=CAST(:s AS jsonb) WHERE id=:id"
                ),
                dict(id=UUID(context), s=json.dumps([dict(kind="WORK", starts_at=at.isoformat())])),
            )
        result = await score()
        assert result["score"] == 80 and "Snapshot schedule kind: WORK" in result["reasons"]
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 2
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.outfit_session")) == 1

    run_case(real_dsn, settings_values, case)
