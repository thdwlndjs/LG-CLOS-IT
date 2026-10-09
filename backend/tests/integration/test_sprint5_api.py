import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text

from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import FAMILY, GARMENT, OWNER, run_case
from tests.integration.test_sprint2_api import SEED_OUTFIT, composition, family, key

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def timestamp():
    return datetime.now(UTC).isoformat()


async def schedule(client, **patch):
    return await client.post(
        "/api/v1/care-schedules",
        headers=key(),
        json={
            "garment_id": GARMENT,
            "scheduled_at": timestamp(),
            "care_type": "WASH",
            **patch,
        },
    )


async def complete(client, row, **patch):
    return await client.post(
        "/api/v1/care-schedules/" + row["id"] + "/complete",
        headers=key(),
        json={"completed_at": timestamp(), "expected_version": row["version"], **patch},
    )


def test_explicit_wear_frozen_replay_cancel_scope(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        body = dict(
            member_id=OWNER, outfit_id=SEED_OUTFIT, worn_at=timestamp(), confirmation_method="USER"
        )
        headers = key()
        first, second = await asyncio.gather(
            *[
                client.post("/api/v1/wear-confirmations", headers=headers, json=body)
                for _ in range(2)
            ]
        )
        assert first.status_code == second.status_code == 201, first.text
        row = first.json()
        assert row == second.json() and row["items_snapshot"] == composition()
        assert (
            await client.post("/api/v1/wear-confirmations", headers=key(), json=body)
        ).status_code == 409
        assert row["snapshot_status"] == "FROZEN"
        # A later composition edit must not rewrite the past composition.
        edited = await client.patch(
            "/api/v1/outfits/" + SEED_OUTFIT,
            headers={"If-Match": "1"},
            json=dict(title="Later look", status="SAVED", items=composition()[:2]),
        )
        assert edited.status_code == 200, edited.text
        history = (await client.get("/api/v1/history?kind=WEAR")).json()
        assert history["page"]["total"] == 1
        assert history["items"][0]["items_snapshot"] == composition()
        auth = client.headers["Authorization"]
        await family(client, settings)
        assert (await client.get("/api/v1/history")).json()["page"]["total"] == 0
        assert (await client.get("/api/v1/history?member_id=" + OWNER)).status_code == 403
        cancel = dict(expected_version=1, reason="Incorrect wear date")
        url = "/api/v1/wear-confirmations/" + row["id"] + "/cancel"
        assert (await client.post(url, headers=key(), json=cancel)).status_code == 404
        client.headers["Authorization"] = auth
        headers = key()
        canceled = await client.post(url, headers=headers, json=cancel)
        assert canceled.status_code == 201 and canceled.json()["version"] == 2
        assert (await client.post(url, headers=headers, json=cancel)).json() == canceled.json()
        assert (await client.post(url, headers=key(), json=cancel)).status_code == 409
        assert (await client.get("/api/v1/history")).json()["items"][0]["status"] == "CANCELLED"
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 1
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.domain_event_outbox "
                        "WHERE event_type IN ('OutfitWearConfirmed','OutfitWearCancelled')"
                    )
                )
                == 2
            )

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"confirmation_method": "SENSOR_VERIFIED"}, 503),
        ({"member_id": FAMILY}, 403),
        ({"worn_at": "2026-01-01T00:00:00"}, 422),
        ({"worn_at": 123}, 422),
        ({"worn_at": "2099-01-01T00:00:00Z"}, 422),
    ],
)
def test_wear_rejects_unsupported_unowned_and_bad_time(real_dsn, settings_values, patch, code):
    async def case(client, engine, settings, *unused):
        response = await client.post(
            "/api/v1/wear-confirmations",
            headers=key(),
            json={
                "member_id": OWNER,
                "outfit_id": SEED_OUTFIT,
                "worn_at": timestamp(),
                "confirmation_method": "USER",
                **patch,
            },
        )
        assert response.status_code == code, response.text
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0

    run_case(real_dsn, settings_values, case)


def test_care_label_priority_profile_version_and_owner_permissions(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.garment SET care_label='null'::jsonb WHERE id=:g"),
                dict(g=UUID(GARMENT)),
            )
        url = "/api/v1/garments/" + GARMENT
        guide = (await client.get(url + "/care-guide")).json()
        assert guide["confidence"] == "REVIEW_REQUIRED"
        assert guide["constraints"]["max_wash_temperature_c"] is None
        body = dict(
            expected_version=guide["profile_version"],
            care_group="USER-DELICATE",
            instructions=["Ask manufacturer"],
            constraints={"machine_wash_allowed": True},
        )
        headers = key()
        updated = await client.put(url + "/care-profile", headers=headers, json=body)
        assert updated.status_code == 200, updated.text
        assert updated.json()["source"] == "USER_PROFILE"
        assert (
            await client.put(url + "/care-profile", headers=headers, json=body)
        ).json() == updated.json()
        assert (
            await client.put(url + "/care-profile", headers=key(), json=body)
        ).status_code == 409
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE wardrobe.garment SET care_label=to_jsonb(CAST('DO NOT WASH' AS text)) "
                    "WHERE id=:g"
                ),
                dict(g=UUID(GARMENT)),
            )
        guide = (await client.get(url + "/care-guide")).json()
        assert guide["source"] == "LABEL" and guide["constraints"]["machine_wash_allowed"] is False
        assert guide["confidence"] == "REVIEW_REQUIRED" and len(guide["warnings"]) == 2
        body = dict(
            expected_version=guide["profile_version"],
            care_group="USER-DELICATE",
            constraints={"max_wash_temperature_c": 95},
        )
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE wardrobe.garment SET care_label=to_jsonb(CAST('WASH AT 30 C' AS text)) "
                    "WHERE id=:g"
                ),
                dict(g=UUID(GARMENT)),
            )
        guide = (await client.put(url + "/care-profile", headers=key(), json=body)).json()
        assert guide["instructions"] == ["WASH AT 30 C"]
        assert guide["constraints"]["max_wash_temperature_c"] is None
        assert guide["confidence"] == "REVIEW_REQUIRED"
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.garment_share(garment_id,member_id,household_id) "
                    "SELECT id,:m,household_id FROM wardrobe.garment WHERE id=:g"
                ),
                dict(m=UUID(FAMILY), g=UUID(GARMENT)),
            )
        await family(client, settings)
        # Explicit share grants reading, while care management remains owner-only.
        assert (await client.get(url + "/care-guide")).status_code == 200
        assert (
            await client.put(url + "/care-profile", headers=key(), json=body)
        ).status_code == 404
        assert (await schedule(client)).status_code == 404

    run_case(real_dsn, settings_values, case)


def test_schedule_duplicate_edit_cancel_and_read_only_overdue(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        at = (datetime.now(UTC) - timedelta(days=2)).isoformat()
        first, second = await asyncio.gather(
            schedule(client, scheduled_at=at), schedule(client, scheduled_at=at)
        )
        assert sorted([first.status_code, second.status_code]) == [201, 409]
        row = (first if first.status_code == 201 else second).json()
        assert row["status"] == "OVERDUE"
        async with engine.connect() as conn:
            assert (
                await conn.scalar(text("SELECT status::text FROM wardrobe.care_schedule"))
                == "SCHEDULED"
            )
        body = dict(expected_version=1, scheduled_at=at, care_type="INSPECT", status="SCHEDULED")
        url = "/api/v1/care-schedules/" + row["id"]
        updated = await client.patch(url, headers=key(), json=body)
        assert updated.status_code == 200 and updated.json()["version"] == 2
        assert (await client.patch(url, headers=key(), json=body)).status_code == 409
        canceled = await client.patch(
            url, headers=key(), json={**body, "expected_version": 2, "status": "CANCELLED"}
        )
        assert canceled.status_code == 200 and canceled.json()["status"] == "CANCELLED"
        assert (await complete(client, canceled.json())).status_code == 409
        assert (await client.get("/api/v1/care-schedules")).json()["page"]["total"] == 1
        assert (await client.get("/api/v1/history")).json()["page"]["total"] == 0
        await family(client, settings)
        assert (await client.get("/api/v1/care-schedules")).json()["page"]["total"] == 0
        assert (await complete(client, canceled.json())).status_code == 404

    run_case(real_dsn, settings_values, case)


def test_care_not_done_completion_recurrence_and_reversal_preserve_state(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        row = (await schedule(client, recurrence_days=7, timezone="Asia/Seoul")).json()
        missed = await complete(client, row, outcome="NOT_DONE")
        assert missed.status_code == 201, missed.text
        assert missed.json()["status"] == "OVERDUE" and missed.json()["next_schedule_id"] is None
        assert missed.json()["completed_at"] is None
        headers = key()
        body = dict(completed_at=timestamp(), expected_version=2)
        url = "/api/v1/care-schedules/" + row["id"] + "/complete"
        successful = await client.post(url, headers=headers, json=body)
        assert successful.status_code == 201, successful.text
        done = successful.json()
        assert done["status"] == "COMPLETED" and done["next_schedule_id"]
        assert datetime.fromisoformat(done["next_due_at"]) > datetime.fromisoformat(
            body["completed_at"]
        )
        assert (await client.post(url, headers=headers, json=body)).json() == done
        assert (await client.post(url, headers=key(), json=body)).status_code == 409
        events = (await client.get("/api/v1/history?kind=CARE")).json()["items"]
        assert {e["status"] for e in events} == {"COMPLETED", "NOT_DONE"}
        cancel = await client.post(
            "/api/v1/care-schedules/" + row["id"] + "/completion/cancel",
            headers=key(),
            json=dict(expected_version=3, reason="Wrong entry"),
        )
        assert cancel.status_code == 201, cancel.text
        assert cancel.json()["next_due_at"] is None
        rows = (await client.get("/api/v1/care-schedules?to=2099-01-01&from=2098-12-01")).json()
        assert rows["page"]["total"] == 0
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.care_event")) == 2
            assert (
                await conn.scalar(
                    text("SELECT count(*) FROM wardrobe.care_schedule WHERE status='CANCELLED'")
                )
                == 2
            )
            assert (
                await conn.scalar(
                    text("SELECT status::text FROM wardrobe.garment_state WHERE garment_id=:g"),
                    dict(g=UUID(GARMENT)),
                )
                == "AVAILABLE"
            )

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize(
    "query",
    [
        "timezone=Invalid/Zone",
        "from=2026-02-02&to=2026-01-01",
        "from=2025-01-01&to=2026-01-02",
        "limit=101",
    ],
)
def test_history_schedule_invalid_filters(real_dsn, settings_values, query):
    async def case(client, engine, settings, *unused):
        for path in ("/history", "/care-schedules"):
            response = await client.get("/api/v1" + path + "?" + query)
            assert response.status_code == 422, response.text

    run_case(real_dsn, settings_values, case)


def test_session_selection_is_not_wear_and_confirmation_unique(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        from tests.integration.test_sprint3_api import new_session

        selected = (await new_session(client)).json()
        body = dict(
            member_id=OWNER,
            outfit_id=selected["outfit_id"],
            session_id=selected["id"],
            confirmation_method="USER",
            worn_at=timestamp(),
        )
        assert (
            await client.post("/api/v1/wear-confirmations", headers=key(), json=body)
        ).status_code == 409
        ended = await client.post(
            "/api/v1/vton-sessions/" + selected["id"] + "/end",
            headers=key(),
            json=dict(expected_revision=0, save_outfit=True),
        )
        assert ended.status_code == 201, ended.text
        history = (await client.get("/api/v1/history")).json()["items"]
        assert len(history) == 1 and history[0]["kind"] == "OUTFIT_SELECTION"
        first, second = await asyncio.gather(
            *[
                client.post(
                    "/api/v1/wear-confirmations",
                    headers=key(),
                    json={**body, "worn_at": timestamp()},
                )
                for _ in range(2)
            ]
        )
        assert sorted([first.status_code, second.status_code]) == [201, 409]
        history = (await client.get("/api/v1/history")).json()["items"]
        assert {r["kind"] for r in history} == {"OUTFIT_SELECTION", "WEAR"}
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 1

    run_case(real_dsn, settings_values, case)


def test_local_history_dates_legacy_snapshot_and_pagination(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.wear_event "
                    "(member_id,outfit_id,worn_at,confirmation_method) "
                    "VALUES (:m,:o,'2026-01-01T15:30:00Z','USER'),"
                    "(:m,:o,'2026-01-02T15:30:00Z','USER')"
                ),
                dict(m=UUID(OWNER), o=UUID(SEED_OUTFIT)),
            )
        url = "/api/v1/history?from=2026-01-02&to=2026-01-02&timezone=Asia/Seoul"
        items = (await client.get(url)).json()["items"]
        assert len(items) == 1 and items[0]["local_date"] == "2026-01-02"
        assert items[0]["items_snapshot"] is None
        all_url = "/api/v1/history?from=2026-01-01&to=2026-01-03&limit=1"
        page1 = (await client.get(all_url)).json()
        page2 = (await client.get(all_url + "&offset=1")).json()
        assert page1["page"]["total"] == page2["page"]["total"] == 2
        assert page1["items"][0]["id"] != page2["items"][0]["id"]

    run_case(real_dsn, settings_values, case)


def test_repeat_conflict_rolls_back_completion_and_outbox(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        due = datetime.now(UTC)
        row = (await schedule(client, scheduled_at=due.isoformat(), recurrence_days=7)).json()
        assert (
            await schedule(client, scheduled_at=(due + timedelta(days=7)).isoformat())
        ).status_code == 201
        failed = await complete(client, row)
        assert failed.status_code == 409, failed.text
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.care_event")) == 0
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.domain_event_outbox "
                        "WHERE event_type='CareCompleted'"
                    )
                )
                == 0
            )
            assert (
                await conn.scalar(
                    text("SELECT version FROM wardrobe.care_schedule WHERE id=:id"),
                    dict(id=UUID(row["id"])),
                )
                == 1
            )

    run_case(real_dsn, settings_values, case)


def test_completed_next_occurrence_blocks_reversal(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        row = (await schedule(client, recurrence_days=1)).json()
        done = (await complete(client, row)).json()
        next_row = next(
            r
            for r in (
                await client.get(
                    "/api/v1/care-schedules?from="
                    + datetime.now(UTC).date().isoformat()
                    + "&to="
                    + (datetime.now(UTC) + timedelta(days=3)).date().isoformat()
                )
            ).json()["items"]
            if r["id"] == done["next_schedule_id"]
        )
        assert (await complete(client, next_row)).status_code == 201
        response = await client.post(
            "/api/v1/care-schedules/" + row["id"] + "/completion/cancel",
            headers=key(),
            json=dict(expected_version=2, reason="Wrong"),
        )
        assert response.status_code == 409
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text("SELECT count(*) FROM wardrobe.care_event WHERE cancelled_at IS NOT NULL")
                )
                == 0
            )

    run_case(real_dsn, settings_values, case)


def test_recommendation_uses_frozen_wear_and_excludes_cancelled(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        from tests.integration.test_sprint2_api import capture

        response = await client.post(
            "/api/v1/wear-confirmations",
            headers=key(),
            json=dict(
                member_id=OWNER,
                outfit_id=SEED_OUTFIT,
                worn_at=timestamp(),
                confirmation_method="USER",
            ),
        )
        assert response.status_code == 201, response.text
        row = response.json()
        edited = await client.patch(
            "/api/v1/outfits/" + SEED_OUTFIT,
            headers={"If-Match": "1"},
            json=dict(items=composition()[:2], title="Changed", status="SAVED"),
        )
        assert edited.status_code == 200
        context = (await capture(client)).json()["id"]
        body = dict(member_id=OWNER, context_snapshot_id=context, constraints={"season": "SPRING"})
        before = await client.post("/api/v1/outfit-recommendations", headers=key(), json=body)
        assert before.status_code == 201, before.text
        assert before.json()["candidates"][0]["score"] == 55  # 70 - three frozen wears * 5
        canceled = await client.post(
            "/api/v1/wear-confirmations/" + row["id"] + "/cancel",
            headers=key(),
            json=dict(expected_version=1, reason="Incorrect"),
        )
        assert canceled.status_code == 201
        after = await client.post("/api/v1/outfit-recommendations", headers=key(), json=body)
        assert after.status_code == 201 and after.json()["candidates"][0]["score"] == 70

    run_case(real_dsn, settings_values, case)
