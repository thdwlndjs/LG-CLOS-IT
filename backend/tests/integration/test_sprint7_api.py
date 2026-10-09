import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.application.outbox import consume, dispatch
from app.application.sprint7 import Sprint7
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import GARMENT, HOUSEHOLD, OWNER, run_case
from tests.integration.test_sprint2_api import capture, family, key
from tests.integration.test_sprint6_api import analyzed, confirm, decide, setup, success

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def resources(engine):
    return SimpleNamespace(database=SimpleNamespace(sessions=async_sessionmaker(engine)))


def test_home_local_day_truncation_and_source_timeout(real_dsn, settings_values, monkeypatch):
    async def case(client, engine, settings, *unused):
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.care_schedule(garment_id,care_type,scheduled_at) "
                    "VALUES (:g,'WASH','2026-09-01T06:00:00Z')"
                ),
                {"g": UUID(GARMENT)},
            )
        at = "2026-09-01T00:00:00Z"
        eastern = (
            await client.get("/api/v1/home", params={"at": at, "timezone": "America/New_York"})
        ).json()
        seoul = (
            await client.get("/api/v1/home", params={"at": at, "timezone": "Asia/Seoul"})
        ).json()
        assert eastern["care_alerts"] == [] and len(seoul["care_alerts"]) == 1
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.care_schedule(garment_id,care_type,scheduled_at) "
                    "SELECT :g,'WASH',now()-interval '1 day'-n*interval '1 minute' "
                    "FROM generate_series(1,21) n"
                ),
                {"g": UUID(GARMENT)},
            )
        result = (await client.get("/api/v1/home")).json()
        assert len(result["care_alerts"]) == 20 and result["source_status"]["care"] == "TRUNCATED"
        await capture(client)
        cancelled = asyncio.Event()

        async def slow(*args):
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.set()

        monkeypatch.setattr(Sprint7, "home_storage", slow)
        response = await client.get("/api/v1/home")
        assert response.status_code == 200, response.text
        assert cancelled.is_set() and response.json()["source_status"]["storage"] == "UNAVAILABLE"
        assert response.json()["today_context"] is not None and response.json()["partial"]

    run_case(real_dsn, settings_values, case)


def test_home_today_context_recommendation_read_only_and_scope(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        initial = await client.get("/api/v1/home")
        assert initial.status_code == 200, initial.text
        context = await capture(client)
        recommendation = await client.post(
            "/api/v1/outfit-recommendations",
            headers=key(),
            json=dict(member_id=OWNER, context_snapshot_id=context.json()["id"], limit=3),
        )
        assert recommendation.status_code == 201, recommendation.text
        async with engine.connect() as conn:
            before = await conn.scalar(text("SELECT count(*) FROM wardrobe.domain_event_outbox"))
        response = await client.get("/api/v1/home?timezone=Asia/Seoul")
        assert response.status_code == 200, response.text
        home = response.json()
        assert home["today_context"]["id"] == context.json()["id"]
        assert home["today_context"]["source_mode"] == "MOCK"
        assert home["today_outfits"] == recommendation.json()["candidates"]
        assert home["source_status"]["recommendations"] == "FRESH"
        async with engine.connect() as conn:
            assert (
                await conn.scalar(text("SELECT count(*) FROM wardrobe.domain_event_outbox"))
                == before
            )
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
        await family(client, settings)
        assert (await client.get("/api/v1/home?member_id=" + OWNER)).status_code == 403
        own = (await client.get("/api/v1/home")).json()
        assert own["today_context"] is None and own["today_outfits"] == [] and own["partial"]
        for query in [
            "timezone=Invalid/Zone",
            "at=1234567890",
            "at=2026-10-08T00:00:00",
            "at=" + (datetime.now(UTC) + timedelta(days=1)).isoformat().replace("+", "%2B"),
        ]:
            assert (await client.get("/api/v1/home?" + query)).status_code == 422

    run_case(real_dsn, settings_values, case)


def test_home_care_storage_transition_and_timezone_day_boundary(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        now = datetime.now(UTC)
        today = (now - timedelta(minutes=1)).isoformat()
        for at in (today, (now + timedelta(days=2)).isoformat()):
            r = await client.post(
                "/api/v1/care-schedules",
                headers=key(),
                json=dict(garment_id=GARMENT, scheduled_at=at, care_type="WASH"),
            )
            assert r.status_code == 201, r.text
        _, action = await analyzed(client, settings, garment_ids=[GARMENT])
        home = (await client.get("/api/v1/home?timezone=UTC")).json()
        assert len(home["care_alerts"]) == 1 and home["care_alerts"][0]["status"] == "OVERDUE"
        assert home["storage_alerts"][0]["id"] == action["id"]
        action = (await decide(client, action)).json()
        assert (await client.get("/api/v1/home")).json()["storage_alerts"][0][
            "status"
        ] == "APPROVED"
        done = await confirm(client, action, [success()])
        assert done.status_code == 201, done.text
        assert (await client.get("/api/v1/home")).json()["storage_alerts"] == []
        scheduled = home["care_alerts"][0]
        r = await client.post(
            "/api/v1/care-schedules/" + scheduled["id"] + "/complete",
            headers=key(),
            json=dict(expected_version=1, completed_at=datetime.now(UTC).isoformat()),
        )
        assert r.status_code == 201, r.text
        assert (await client.get("/api/v1/home")).json()["care_alerts"] == []

    run_case(real_dsn, settings_values, case)


def test_home_partial_failure_and_stale_modified_recommendation(
    real_dsn, settings_values, monkeypatch
):
    async def case(client, engine, settings, *unused):
        context = await capture(client)
        r = await client.post(
            "/api/v1/outfit-recommendations",
            headers=key(),
            json=dict(member_id=OWNER, context_snapshot_id=context.json()["id"], limit=1),
        )
        assert r.status_code == 201, r.text
        outfit = r.json()["candidates"][0]["outfit"]
        r = await client.patch(
            "/api/v1/outfits/" + outfit["id"],
            headers={"If-Match": str(outfit["version"])},
            json=dict(items=outfit["items"], title="Changed", status="SAVED"),
        )
        assert r.status_code == 200, r.text
        home = (await client.get("/api/v1/home")).json()
        assert home["today_outfits"] == [] and home["source_status"]["recommendations"] == "STALE"

        async def broken(*args):
            raise RuntimeError("private information must not escape")

        monkeypatch.setattr(Sprint7, "home_care", broken)
        response = await client.get("/api/v1/home")
        assert response.status_code == 200, response.text
        assert response.json()["source_status"]["care"] == "UNAVAILABLE"
        assert response.json()["partial"] and response.json()["today_context"] is not None
        assert "private information" not in response.text
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.context_snapshot SET captured_at=now()-interval '2 days'")
            )
        home = (await client.get("/api/v1/home")).json()
        assert (
            home["source_status"]["context"] == "STALE"
            and home["today_context"]["source_mode"] == "MOCK"
        )

    run_case(real_dsn, settings_values, case)


def test_outbox_after_commit_delivery_duplicate_and_tamper(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        r = await client.post(
            "/api/v1/garments",
            headers=key(),
            json=dict(owner_id=OWNER, category="TOP", color="BLUE"),
        )
        assert r.status_code == 201, r.text
        messages = []

        async def publish(message):
            messages.append(message)

        runtime = resources(engine)
        claimed = await dispatch(runtime, publish)
        assert claimed > 0 and claimed == len(messages)
        assert await dispatch(runtime, publish) == 0
        row = messages[-1]
        results = await asyncio.gather(consume(runtime, row), consume(runtime, row))
        assert sorted(results) == [False, True]
        with pytest.raises(ValueError, match="committed source"):
            await consume(runtime, {**row, "payload": {"tampered": True}})
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.audit_log "
                        "WHERE action='DOMAIN_EVENT_CONSUMED'"
                    )
                )
                == 1
            )
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.domain_event_outbox WHERE status='PUBLISHED'"
                    )
                )
                == claimed
            )
            assert (
                await conn.scalar(
                    text("SELECT count(*) FROM wardrobe.garment WHERE id=:id"),
                    {"id": UUID(r.json()["id"])},
                )
                == 1
            )

    run_case(real_dsn, settings_values, case)


def test_outbox_bounded_failure_fencing_and_rollback(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        runtime = resources(engine)

        async def broken(message):
            raise RuntimeError("credentials stay private")

        response = await client.post(
            "/api/v1/garments",
            headers=key(),
            json=dict(owner_id=OWNER, category="TOP", color="BLUE"),
        )
        assert response.status_code == 201, response.text

        for attempt in range(1, 6):
            assert await dispatch(runtime, broken) > 0
            async with engine.begin() as conn:
                rows = (
                    await conn.execute(
                        text("SELECT attempts,status,last_error FROM wardrobe.domain_event_outbox")
                    )
                ).all()
                assert all(
                    r[0] == attempt and r[1] == "FAILED" and "credentials" not in r[2] for r in rows
                )
                await conn.execute(
                    text("UPDATE wardrobe.domain_event_outbox SET next_attempt_at=now()")
                )
        assert await dispatch(runtime, broken) == 0
        async with engine.connect() as conn:
            transaction = await conn.begin()
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.domain_event_outbox"
                    "(aggregate_type,aggregate_id,event_type,household_id,payload) "
                    "VALUES ('member',:m,'Uncommitted',:h,'{}'::jsonb)"
                ),
                {"m": UUID(OWNER), "h": UUID(HOUSEHOLD)},
            )
            assert await dispatch(runtime, broken) == 0
            await transaction.rollback()
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.domain_event_outbox "
                        "WHERE event_type='Uncommitted'"
                    )
                )
                == 0
            )

    run_case(real_dsn, settings_values, case)


def test_outbox_concurrent_claim_and_lost_ack_duplicate(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        runtime = resources(engine)
        messages = []
        started, release = asyncio.Event(), asyncio.Event()
        response = await client.post(
            "/api/v1/garments",
            headers=key(),
            json=dict(owner_id=OWNER, category="TOP", color="BLUE"),
        )
        assert response.status_code == 201, response.text

        async def slow(message):
            messages.append(message)
            started.set()
            await release.wait()

        task = asyncio.create_task(dispatch(runtime, slow))
        await asyncio.wait_for(started.wait(), 5)
        assert await dispatch(runtime, slow) == 0
        release.set()
        await task
        message = messages[0]
        assert await consume(runtime, message)
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE wardrobe.domain_event_outbox SET status='FAILED',"
                    "next_attempt_at=now() WHERE id=:id"
                ),
                {"id": UUID(message["event_id"])},
            )

        async def replay(message):
            assert not await consume(runtime, message)

        assert await dispatch(runtime, replay) == 1
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.audit_log "
                        "WHERE action='DOMAIN_EVENT_CONSUMED'"
                    )
                )
                == 1
            )

    run_case(real_dsn, settings_values, case)
