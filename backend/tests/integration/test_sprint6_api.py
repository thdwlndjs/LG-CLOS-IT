import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text

from app.application.storage_worker import process_storage
from app.domain.storage import plan
from app.infrastructure.resources import RuntimeResources
from tests.integration import test_sprint1_api as existing
from tests.integration.test_sprint1_api import BOX, GARMENT, HOUSEHOLD, LOCATION, OWNER, run_case
from tests.integration.test_sprint2_api import family, key

pytestmark = pytest.mark.integration
SECOND = "40000000-0000-4000-8000-000000000002"


@pytest.mark.parametrize("kind", ["retired_other_owner", "stale_source"])
def test_non_targets_occupy_capacity_and_stale_source_blocked(real_dsn, settings_values, kind):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        async with engine.begin() as conn:
            if kind == "stale_source":
                await conn.execute(
                    text(
                        "UPDATE wardrobe.garment_state SET last_seen_at=now()-interval '8 "
                        "days' WHERE garment_id=:id"
                    ),
                    {"id": UUID(GARMENT)},
                )
            else:
                await conn.execute(
                    text("UPDATE wardrobe.storage_location SET capacity_units=1 WHERE id=:id"),
                    {"id": UUID(BOX)},
                )
                await conn.execute(
                    text(
                        "UPDATE wardrobe.garment SET owner_id=:owner,retired_at=now() WHERE id=:id"
                    ),
                    {"owner": UUID(existing.FAMILY), "id": UUID(SECOND)},
                )
                await conn.execute(
                    text("UPDATE wardrobe.garment_state SET location_id=:box WHERE garment_id=:id"),
                    {"box": UUID(BOX), "id": UUID(SECOND)},
                )
        job, action = await analyzed(client, settings, garment_ids=[GARMENT])
        assert action is None
        reasons = job["storage_result"]["blocked"][0]["reasons"]
        assert ("LOCATION_STALE" if kind == "stale_source" else "CAPACITY_EXCEEDED") in reasons

    run_case(real_dsn, settings_values, case)


def test_wear_snapshot_and_cancellation_change_storage_score(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        wear = []
        for days in (1, 2):
            response = await client.post(
                "/api/v1/wear-confirmations",
                headers=key(),
                json=dict(
                    member_id=OWNER,
                    outfit_id="60000000-0000-4000-8000-000000000001",
                    worn_at=(datetime.now(UTC) - timedelta(days=days)).isoformat(),
                    confirmation_method="USER",
                ),
            )
            assert response.status_code == 201, response.text
            wear.append(response.json())
        job, action = await analyzed(client, settings, garment_ids=[GARMENT])
        assert action is None and job["storage_result"]["status"] == "NO_CHANGE"
        for row in wear:
            response = await client.post(
                "/api/v1/wear-confirmations/" + row["id"] + "/cancel",
                headers=key(),
                json=dict(expected_version=1, reason="Mistaken wear"),
            )
            assert response.status_code == 201, response.text
        job, action = await analyzed(client, settings, garment_ids=[GARMENT])
        assert action and job["storage_result"]["status"] == "FEASIBLE"

    run_case(real_dsn, settings_values, case)


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def timestamp():
    return datetime.now(UTC).isoformat()


async def setup(engine):
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE wardrobe.garment SET season_tags=ARRAY['SPRING']"))


async def submit(client, **patch):
    return await client.post(
        "/api/v1/storage-optimization-jobs",
        headers=key(),
        json={
            **dict(
                household_id=HOUSEHOLD,
                member_id=OWNER,
                mode="WEAR_PATTERN",
                season="SUMMER",
                garment_ids=[GARMENT, SECOND],
            ),
            **patch,
        },
    )


async def analyzed(client, settings, **patch):
    response = await submit(client, **patch)
    assert response.status_code == 202, response.text
    resources = RuntimeResources(settings)
    try:
        assert await process_storage(settings, resources) == 1
    finally:
        await resources.close()
    job = (await client.get("/api/v1/jobs/" + response.json()["job_id"])).json()
    assert job["status"] == "SUCCEEDED", job
    assert job["kind"] == "STORAGE_OPTIMIZATION"
    result = job["storage_result"]
    if result["action_ids"]:
        action = await client.get("/api/v1/storage-actions/" + result["action_ids"][0])
        assert action.status_code == 200, action.text
        return job, action.json()
    return job, None


async def decide(client, action, decision="APPROVE", headers=None):
    return await client.post(
        "/api/v1/storage-actions/" + action["id"] + "/decision",
        headers=headers or key(),
        json=dict(expected_version=action["version"], decision=decision),
    )


def success(garment=GARMENT, **patch):
    return dict(
        garment_id=garment,
        confirmed=True,
        observed_location_id=BOX,
        observed_at=timestamp(),
        confirmation_method="USER",
        **patch,
    )


async def confirm(client, action, items, headers=None):
    return await client.post(
        "/api/v1/storage-actions/" + action["id"] + "/confirm",
        headers=headers or key(),
        json=dict(expected_version=action["version"], items=items),
    )


async def locations(engine):
    async with engine.connect() as conn:
        return list(
            (
                await conn.execute(
                    text(
                        (
                            "SELECT garment_id,location_id,version FROM wardrobe.garment_state"
                            " ORDER BY garment_id"
                        )
                    )
                )
            ).all()
        )


def test_approval_is_not_movement_partial_failure_and_replay(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        before = await locations(engine)
        job, action = await analyzed(client, settings)
        assert len(action["items"]) == 2 and action["status"] == "PROPOSED"
        assert job["storage_result"]["feasible"]
        assert (await confirm(client, action, [success()])).status_code == 409
        headers = key()
        approved = await decide(client, action, headers=headers)
        assert approved.status_code == 201, approved.text
        assert (await decide(client, action, headers=headers)).json() == approved.json()
        assert await locations(engine) == before
        assert (await decide(client, action)).status_code == 409
        action = approved.json()
        item = success()
        headers = key()
        partial = await confirm(client, action, [item], headers)
        assert partial.status_code == 201, partial.text
        assert partial.json()["status"] == "AWAITING_CONFIRMATION"
        assert (await confirm(client, action, [item], headers)).json() == partial.json()
        action = partial.json()
        assert (await confirm(client, action, [success()])).status_code == 409
        failure = await confirm(
            client,
            action,
            [dict(garment_id=SECOND, confirmed=False, failure_reason="Not physically moved")],
        )
        assert failure.status_code == 201 and failure.json()["status"] == "FAILED"
        after = {str(row[0]): (str(row[1]), row[2]) for row in await locations(engine)}
        assert after[GARMENT] == (BOX, 2) and after[SECOND] == (LOCATION, 1)
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment_observation")) == 1
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.domain_event_outbox WHERE "
                        "event_type='StorageMovementConfirmed'"
                    )
                )
                == 1
            )

    run_case(real_dsn, settings_values, case)


def test_full_confirmation_and_idempotent_concurrent_requests(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        _, action = await analyzed(client, settings)
        headers = key()
        responses = await asyncio.gather(
            *(decide(client, action, headers=headers) for _ in range(2))
        )
        assert all(r.status_code == 201 for r in responses)
        assert responses[0].json() == responses[1].json()
        action = responses[0].json()
        items = [success(), success(SECOND)]
        headers = key()
        responses = await asyncio.gather(
            *(confirm(client, action, items, headers) for _ in range(2))
        )
        assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
        assert responses[0].json() == responses[1].json()
        assert responses[0].json()["status"] == "COMPLETED"
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment_observation")) == 2
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.garment_state WHERE "
                        "location_id=:box AND location_confidence=1 AND version=2"
                    ),
                    {"box": UUID(BOX)},
                )
                == 2
            )

    run_case(real_dsn, settings_values, case)


def test_reservations_prevent_overbooking_cancel_releases(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.storage_location SET capacity_units=1 WHERE id=:id"),
                {"id": UUID(BOX)},
            )
        _, first = await analyzed(client, settings, garment_ids=[GARMENT])
        _, second = await analyzed(client, settings, garment_ids=[SECOND])
        first = (await decide(client, first)).json()
        rejected = await decide(client, second)
        assert rejected.status_code == 409, rejected.text
        assert (await client.get("/api/v1/storage-actions/" + second["id"])).json()["version"] == 1
        assert (await decide(client, first, "CANCEL")).json()["status"] == "CANCELLED"
        assert (await decide(client, second)).status_code == 201

    run_case(real_dsn, settings_values, case)


def test_version_race_only_one_decision_commits(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        _, action = await analyzed(client, settings)
        responses = await asyncio.gather(decide(client, action), decide(client, action))
        assert sorted(r.status_code for r in responses) == [201, 409]

    run_case(real_dsn, settings_values, case)


def test_dry_run_and_cold_start_do_not_create_actions(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        job, action = await analyzed(client, settings, dry_run=True)
        assert action is None and len(job["storage_result"]["proposed_items"]) == 2
        job, action = await analyzed(client, settings, season="ALL")
        assert action is None and job["storage_result"]["status"] == "NO_FEASIBLE_PLAN"
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.storage_action")) == 0

    run_case(real_dsn, settings_values, case)


def test_family_and_household_scope(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        job, action = await analyzed(client, settings)
        await family(client, settings)
        assert (await client.get("/api/v1/jobs/" + job["id"])).status_code == 404
        assert (await client.get("/api/v1/storage-actions/" + action["id"])).status_code == 404
        assert (await decide(client, action)).status_code == 404
        assert (await confirm(client, action, [success()])).status_code == 404
        assert (await client.get("/api/v1/storage-actions")).json()["page"]["total"] == 0
        assert (await submit(client)).status_code == 403

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize("change", ["garment", "capacity", "environment"])
def test_changed_inputs_confirmation_rolls_back(real_dsn, settings_values, change):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        _, action = await analyzed(client, settings)
        action = (await decide(client, action)).json()
        before = await locations(engine)
        async with engine.begin() as conn:
            if change == "garment":
                await conn.execute(
                    text("UPDATE wardrobe.garment SET version=version+1 WHERE id=:id"),
                    {"id": UUID(SECOND)},
                )
            elif change == "capacity":
                await conn.execute(
                    text("UPDATE wardrobe.storage_location SET capacity_units=1 WHERE id=:id"),
                    {"id": UUID(BOX)},
                )
            else:
                await conn.execute(
                    text(
                        "UPDATE wardrobe.storage_location SET "
                        "attributes=jsonb_build_object('enabled',false) WHERE id=:id"
                    ),
                    {"id": UUID(BOX)},
                )
        response = await confirm(client, action, [success(), success(SECOND)])
        assert response.status_code == 409, response.text
        assert await locations(engine) == before
        assert (await client.get("/api/v1/storage-actions/" + action["id"])).json()["version"] == 2
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment_observation")) == 0

    run_case(real_dsn, settings_values, case)


def test_expiry_reject_and_invalid_actual_evidence(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        _, action = await analyzed(client, settings)
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE wardrobe.storage_action SET expires_at=now()-interval '1 "
                    "second' WHERE id=:id"
                ),
                {"id": UUID(action["id"])},
            )
        assert (await decide(client, action)).status_code == 409
        assert (await client.get("/api/v1/storage-actions?status=EXPIRED")).json()["page"][
            "total"
        ] == 1
        _, action = await analyzed(client, settings)
        assert (await decide(client, action, "REJECT")).json()["status"] == "REJECTED"
        _, action = await analyzed(client, settings)
        action = (await decide(client, action)).json()
        for patch, status in [
            ({"observed_location_id": LOCATION}, 409),
            ({"observed_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()}, 422),
            ({"observed_at": "2026-10-08T00:00:00"}, 422),
            ({"confirmed": "true"}, 422),
            ({"confirmation_method": "SENSOR_VERIFIED"}, 503),
        ]:
            item = success()
            item.update(patch)
            assert (await confirm(client, action, [item])).status_code == status
        assert (await confirm(client, action, [success(), success()])).status_code == 422
        assert (
            await confirm(client, action, [dict(garment_id=GARMENT, confirmed=False)])
        ).status_code == 422

    run_case(real_dsn, settings_values, case)


def test_space_environment_uses_real_readings_and_constraints(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE wardrobe.garment SET "
                    "attributes=jsonb_build_object('storage_constraints',jsonb_build_object('max_humidity_pct',50))"
                    " WHERE id=:id"
                ),
                {"id": UUID(GARMENT)},
            )
            for loc, humidity in [(LOCATION, 70), (BOX, 40)]:
                await conn.execute(
                    text(
                        "INSERT INTO "
                        "wardrobe.environment_reading(location_id,temperature_c,humidity_pct,measured_at,source)"
                        " VALUES (:l,20,:h,now(),'MANUAL')"
                    ),
                    {"l": UUID(loc), "h": humidity},
                )
        job, action = await analyzed(
            client, settings, mode="SPACE_ENVIRONMENT", garment_ids=[GARMENT]
        )
        assert action and job["storage_result"]["status"] == "FEASIBLE"
        action = (await decide(client, action)).json()
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO "
                    "wardrobe.environment_reading(location_id,temperature_c,humidity_pct,measured_at,source)"
                    " VALUES (:l,20,80,now(),'MANUAL')"
                ),
                {"l": UUID(BOX)},
            )
        assert (await confirm(client, action, [success()])).status_code == 409

    run_case(real_dsn, settings_values, case)


def test_worker_bounded_retries_lease_and_cancel(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        response = await submit(client)
        identity = response.json()["job_id"]
        resources = RuntimeResources(settings)

        def fail(*args):
            raise RuntimeError("sensitive provider details must not escape")

        try:
            for attempt in range(1, 4):
                await process_storage(settings, resources, planner=fail)
                job = (await client.get("/api/v1/jobs/" + identity)).json()
                assert job["status"] == ("QUEUED" if attempt < 3 else "FAILED")
                assert "sensitive" not in str(job)
                async with engine.begin() as conn:
                    await conn.execute(
                        text("UPDATE wardrobe.job SET next_attempt_at=now() WHERE id=:id"),
                        {"id": UUID(identity)},
                    )
            response = await submit(client)
            identity = response.json()["job_id"]
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "UPDATE wardrobe.job SET "
                        "status='RUNNING',lease_owner='expired',leased_until=now()-interval"
                        " '1 second' WHERE id=:id"
                    ),
                    {"id": UUID(identity)},
                )
            assert await process_storage(settings, resources) == 0
            assert (await client.get("/api/v1/jobs/" + identity)).json()["status"] == "TIMED_OUT"
            response = await submit(client)
            identity = response.json()["job_id"]
            assert (
                await client.post("/api/v1/jobs/" + identity + "/cancel", headers=key())
            ).status_code == 201
            assert await process_storage(settings, resources) == 0
            async with engine.connect() as conn:
                assert await conn.scalar(text("SELECT count(*) FROM wardrobe.storage_action")) == 0
        finally:
            await resources.close()

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize("mode", ["cancel", "changed"])
def test_running_worker_cannot_commit_after_cancel_or_changed_input(
    real_dsn, settings_values, mode
):
    async def case(client, engine, settings, *unused):
        await setup(engine)
        response = await submit(client)
        identity = response.json()["job_id"]
        started, release = asyncio.Event(), asyncio.Event()

        async def paused(*args):
            output = plan(*args)
            started.set()
            await release.wait()
            return output

        resources = RuntimeResources(settings)
        try:
            task = asyncio.create_task(process_storage(settings, resources, planner=paused))
            await asyncio.wait_for(started.wait(), 5)
            if mode == "cancel":
                assert (
                    await client.post("/api/v1/jobs/" + identity + "/cancel", headers=key())
                ).status_code == 201
            else:
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "UPDATE wardrobe.garment_state SET version=version+1 WHERE "
                            "garment_id=:id"
                        ),
                        {"id": UUID(GARMENT)},
                    )
            release.set()
            await task
            job = (await client.get("/api/v1/jobs/" + identity)).json()
            assert job["status"] == ("CANCELLED" if mode == "cancel" else "FAILED")
            async with engine.connect() as conn:
                assert await conn.scalar(text("SELECT count(*) FROM wardrobe.storage_action")) == 0
        finally:
            release.set()
            await resources.close()

    run_case(real_dsn, settings_values, case)
