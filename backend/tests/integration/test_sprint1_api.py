"""Real PostgreSQL API tests, each in its own migrated/seeded disposable DB."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid4

import httpx
import pytest
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.paths import DOCS_DIR, PROJECT_ROOT
from app.core.security import issue_token
from app.infrastructure.db.sql_scripts import read_transaction_statements
from app.main import create_app

pytestmark = pytest.mark.integration
HOUSEHOLD = "10000000-0000-4000-8000-000000000001"
OWNER = "20000000-0000-4000-8000-000000000001"
FAMILY = "20000000-0000-4000-8000-000000000002"
OTHER_HOUSEHOLD = "10000000-0000-4000-8000-000000000002"
OTHER_MEMBER = "20000000-0000-4000-8000-000000000003"
OTHER_GARMENT = "40000000-0000-4000-8000-000000000004"
OTHER_LOCATION = "30000000-0000-4000-8000-000000000003"
GARMENT = "40000000-0000-4000-8000-000000000001"
LOCATION = "30000000-0000-4000-8000-000000000001"
BOX = "30000000-0000-4000-8000-000000000002"


@pytest.fixture
def real_dsn():
    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("TEST_DATABASE_URL absent; real Sprint 1 API tests not executed")
    url = make_url(dsn)
    assert url.drivername == "postgresql+asyncpg" and url.database == "wardrobe_test"
    name = "wardrobe_test_" + uuid4().hex

    async def prepare():
        from alembic import command
        from alembic.config import Config

        admin = create_async_engine(url, isolation_level="AUTOCOMMIT")
        try:
            async with admin.connect() as connection:
                await connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
        finally:
            await admin.dispose()
        engine = create_async_engine(url.set(database=name))
        try:

            def migrate(connection):
                cfg = Config(str(PROJECT_ROOT / "backend/alembic.ini"))
                cfg.attributes["connection"] = connection
                command.upgrade(cfg, "head")

            async with engine.begin() as connection:
                await connection.run_sync(migrate)
                for statement in read_transaction_statements(DOCS_DIR / "07_DATABASE_SEED.sql"):
                    await connection.exec_driver_sql(statement)
                await connection.execute(
                    text("INSERT INTO wardrobe.household(id,name) VALUES (:id,'Other fixture')"),
                    {"id": UUID(OTHER_HOUSEHOLD)},
                )
                await connection.execute(
                    text(
                        "INSERT INTO wardrobe.member(id,household_id,display_name,role) "
                        "VALUES (:id,:household,'Other fixture','OWNER')"
                    ),
                    {"id": UUID(OTHER_MEMBER), "household": UUID(OTHER_HOUSEHOLD)},
                )
                await connection.execute(
                    text(
                        "INSERT INTO wardrobe.garment(id,household_id,owner_id,category,color) "
                        "VALUES (:id,:household,:owner,'TOP','SECRET')"
                    ),
                    {
                        "id": UUID(OTHER_GARMENT),
                        "household": UUID(OTHER_HOUSEHOLD),
                        "owner": UUID(OTHER_MEMBER),
                    },
                )
                await connection.execute(
                    text(
                        "INSERT INTO wardrobe.storage_location(id,household_id,name,location_type) "
                        "VALUES (:id,:household,'Secret Location','BOX')"
                    ),
                    {"id": UUID(OTHER_LOCATION), "household": UUID(OTHER_HOUSEHOLD)},
                )
        finally:
            await engine.dispose()

    async def cleanup():
        admin = create_async_engine(url, isolation_level="AUTOCOMMIT")
        try:
            async with admin.connect() as connection:
                await connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        finally:
            await admin.dispose()

    try:
        asyncio.run(prepare())
        yield url.set(database=name).render_as_string(hide_password=False)
    finally:
        asyncio.run(cleanup())


async def exercise(dsn, settings_values, case):
    from app.core.config import Settings, load_settings
    from app.infrastructure.adapters.object_storage import storage_client
    actual = load_settings()
    storage_values = {k: getattr(actual,k) for k in (
        "storage_endpoint", "storage_access_key", "storage_secret_key", "storage_public_base_url")}
    settings = Settings(**{**settings_values, **storage_values, "database_url": dsn})
    settings = settings.model_copy(update={"storage_public_base_url": settings.storage_endpoint})
    engine = create_async_engine(dsn)
    resources = SimpleNamespace(
        database=SimpleNamespace(sessions=async_sessionmaker(engine, expire_on_commit=False))
    )
    resources.storage = storage_client(settings)
    redis_url = urlsplit(os.environ.get("REDIS_URL", settings.redis_url.get_secret_value()))
    resources.redis = Redis.from_url(urlunsplit(redis_url), socket_timeout=2)

    async def close():
        resources.storage.close()
        await resources.redis.aclose()
        await engine.dispose()

    resources.close = close
    app = create_app(settings, resources)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client:
            key = {"Idempotency-Key": str(uuid4())}
            body = {"household_id": HOUSEHOLD, "member_id": OWNER, "demo_mode": True}
            response = await client.post("/api/v1/sessions", json=body, headers=key)
            assert response.status_code == 201, response.text
            token = response.json()["access_token"]
            client.headers["Authorization"] = "Bearer " + token
            await case(client, engine, settings, response, key, body)


def run_case(real_dsn, settings_values, case):
    asyncio.run(exercise(real_dsn, settings_values, case))


def test_demo_session_replay_profile_scope_and_expiry(real_dsn, settings_values):
    async def case(client, engine, settings, first, key, body):
        replay = await client.post("/api/v1/sessions", json=body, headers=key)
        assert replay.json() == first.json()
        for patch, status in [
            ({"demo_mode": "true"}, 422),
            ({"demo_mode": False}, 403),
            ({"member_id": OTHER_MEMBER}, 403),
            ({"household_id": OTHER_HOUSEHOLD}, 403),
        ]:
            result = await client.post(
                "/api/v1/sessions",
                json={**body, **patch},
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert result.status_code == status
        changed = await client.post(
            "/api/v1/sessions", json={**body, "member_id": FAMILY}, headers=key
        )
        # Idempotency scope is per member, so another allowed profile has a separate key space.
        assert changed.status_code == 201 and changed.json()["member"]["role"] == "MEMBER"
        response = await client.get("/api/v1/garments", headers={"Authorization": "Bearer bad"})
        assert response.status_code == 401
        import jwt

        claims = jwt.decode(
            first.json()["access_token"],
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience=settings.jwt_audience,
        )
        claims["exp"] = datetime.now(UTC) - timedelta(seconds=1)
        expired = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")
        assert (
            await client.get("/api/v1/garments", headers={"Authorization": "Bearer " + expired})
        ).status_code == 401
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0

    run_case(real_dsn, settings_values, case)


def test_household_and_owner_isolation_all_sprint1_boundaries(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        for path in (
            f"/api/v1/garments/{OTHER_GARMENT}",
            f"/api/v1/garments?owner_id={OTHER_MEMBER}",
        ):
            response = await client.get(path)
            assert response.status_code == 404 and "SECRET" not in response.text
        assert (await client.get(f"/api/v1/settings?member_id={FAMILY}")).status_code == 403
        assert (await client.get(f"/api/v1/garments?member_id={FAMILY}")).status_code == 403
        assert (await client.get(f"/api/v1/garments?owner_id={FAMILY}")).json()["items"] == []
        body = {"owner_id": OTHER_MEMBER, "category": "TOP", "color": "RED"}
        assert (
            await client.post(
                "/api/v1/garments", json=body, headers={"Idempotency-Key": str(uuid4())}
            )
        ).status_code == 403
        assert (
            await client.patch(
                f"/api/v1/garments/{OTHER_GARMENT}",
                json={**body, "owner_id": OWNER},
                headers={"If-Match": "1"},
            )
        ).status_code == 404
        assert (
            await client.post("/api/v1/garments/locate", json={"owner_id": OTHER_MEMBER})
        ).status_code == 404
        assert (
            await client.post("/api/v1/garments/locate", json={"garment_id": OTHER_GARMENT})
        ).json()["page"]["total"] == 0
        payload = dict(
            garment_id=GARMENT,
            location_id=OTHER_LOCATION,
            sensor_type="MOCK",
            confidence=1,
            observed_at=datetime.now(UTC).isoformat(),
            source_id="foreign",
        )
        assert (
            await client.post(
                "/api/v1/garment-observations",
                json=payload,
                headers={"Idempotency-Key": str(uuid4())},
            )
        ).status_code == 404
        sid, token, expires = issue_token(settings, UUID(FAMILY), UUID(HOUSEHOLD), "MEMBER")
        family_headers = {"Authorization": "Bearer " + token}
        assert (await client.get("/api/v1/garments", headers=family_headers)).json()["items"] == []
        assert (
            await client.get(f"/api/v1/garments/{GARMENT}", headers=family_headers)
        ).status_code == 404
        assert (await client.get("/api/v1/settings", headers=family_headers)).json()[
            "member_id"
        ] == FAMILY

    run_case(real_dsn, settings_values, case)


def test_registration_search_unknown_location_and_optimistic_update(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        payload = dict(
            owner_id=OWNER,
            category="OUTER",
            color="BLUE",
            material="COTTON",
            season_tags=["WINTER"],
        )
        key = {"Idempotency-Key": str(uuid4())}
        first, second = await asyncio.gather(
            *[client.post("/api/v1/garments", json=payload, headers=key) for _ in range(2)]
        )
        assert first.status_code == second.status_code == 201
        assert first.json() == second.json()
        garment = first.json()
        from app.api.v1.sprint1 import source_contract

        original = source_contract()["components"]["schemas"]["Garment"]
        assert original["additionalProperties"] is False
        assert set(garment) <= set(original["properties"])
        assert set(original["required"]) <= set(garment)
        assert garment["status"] == "UNKNOWN" and garment["location_id"] is None
        assert garment["location_confidence"] is None and garment["last_seen_at"] is None
        gid = garment["id"]
        assert (await client.get(f"/api/v1/garments/{gid}")).json() == garment
        filtered = await client.get(
            "/api/v1/garments",
            params=dict(
                category="OUTER", color="BLUE", season="WINTER", status="UNKNOWN", limit=1, offset=0
            ),
        )
        assert [item["id"] for item in filtered.json()["items"]] == [gid]
        assert all(set(item) <= set(original["properties"])
                   for item in filtered.json()["items"])
        assert filtered.json()["page"] == dict(limit=1, offset=0, total=1)
        assert (await client.get("/api/v1/garments?limit=0")).status_code == 422
        empty_page = await client.get("/api/v1/garments?category=OUTER&offset=1")
        assert empty_page.json()["items"] == [] and empty_page.json()["page"]["total"] == 1
        located = (await client.post("/api/v1/garments/locate", json={"garment_id": gid})).json()
        assert located["items"][0] == dict(
            garment_id=gid,
            location_id=None,
            location_label=None,
            confidence=None,
            last_seen_at=None,
            status="UNKNOWN",
            fallback="Register a location or a new observation",
        )
        assert (
            await client.post("/api/v1/garments", json={**payload, "color": "RED"}, headers=key)
        ).status_code == 409
        updates = await asyncio.gather(
            *[
                client.patch(
                    f"/api/v1/garments/{gid}",
                    json={"owner_id": OWNER, "category": "OUTER", "color": color},
                    headers={"If-Match": '"1"'},
                )
                for color in ("GREEN", "BLACK")
            ]
        )
        assert sorted(response.status_code for response in updates) == [200, 409]
        winner = next(response.json() for response in updates if response.status_code == 200)
        assert winner["version"] == 2 and winner["material"] == "COTTON"
        assert winner["season_tags"] == ["WINTER"]  # PATCH omissions preserve data.
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text("SELECT count(*) FROM wardrobe.garment WHERE category='OUTER'")
                )
                == 1
            )
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.domain_event_outbox WHERE aggregate_id=:id"
                    ),
                    {"id": UUID(gid)},
                )
                == 2
            )

    run_case(real_dsn, settings_values, case)


def test_observation_replay_stale_confidence_conflict_and_no_wear(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        initial = (await client.get(f"/api/v1/garments/{GARMENT}")).json()
        latest = datetime.fromisoformat(initial["last_seen_at"].replace("Z", "+00:00"))
        now = datetime.now(UTC)
        payload = dict(
            garment_id=GARMENT,
            location_id=BOX,
            sensor_type="MOCK",
            confidence=0.99,
            observed_at=now.isoformat(),
            source_id="event-one",
        )
        key = {"Idempotency-Key": str(uuid4())}
        response = await client.post("/api/v1/garment-observations", json=payload, headers=key)
        assert response.status_code == 201, response.text
        first = response.json()
        assert first["state_updated"] and first["garment"]["location_id"] == BOX
        assert first["garment"]["location_confidence"] == 0.99
        for headers in (key, {"Idempotency-Key": str(uuid4())}):
            replay = await client.post(
                "/api/v1/garment-observations", json=payload, headers=headers
            )
            assert replay.status_code == 201 and replay.json() == first
        for changes in [
            dict(observed_at=(latest - timedelta(days=1)).isoformat(), source_id="late"),
            dict(confidence=0.1, observed_at=datetime.now(UTC).isoformat(), source_id="weak"),
        ]:
            result = await client.post(
                "/api/v1/garment-observations",
                json={**payload, **changes},
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert result.status_code == 201 and not result.json()["state_updated"]
            assert result.json()["garment"]["location_id"] == BOX
        conflict = await client.post(
            "/api/v1/garment-observations",
            json={**payload, "source_id": "conflicting", "location_id": LOCATION},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert conflict.status_code == 201 and conflict.json()["state_updated"]
        assert conflict.json()["garment"]["location_id"] is None
        assert conflict.json()["garment"]["location_confidence"] is None
        assert conflict.json()["garment"]["status"] == "UNKNOWN"
        for changes in [
            dict(confidence=1.1),
            dict(confidence="0.5"),
            dict(observed_at=1),
            dict(observed_at=(now + timedelta(days=1)).isoformat()),
            dict(observed_at="2026-01-01T00:00:00"),
        ]:
            assert (
                await client.post(
                    "/api/v1/garment-observations",
                    json={**payload, **changes},
                    headers={"Idempotency-Key": str(uuid4())},
                )
            ).status_code == 422
        assert (
            await client.post(
                "/api/v1/garment-observations",
                json={**payload, "confidence": 0.5},
                headers={"Idempotency-Key": str(uuid4())},
            )
        ).status_code == 409
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment_observation")) == 4
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
            assert (
                await conn.scalar(
                    text(
                        "SELECT count(*) FROM wardrobe.domain_event_outbox "
                        "WHERE event_type='GarmentObserved'"
                    )
                )
                == 4
            )

    run_case(real_dsn, settings_values, case)


def test_settings_scope_persistence_and_server_provider_policy(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        body = (await client.get("/api/v1/settings")).json()
        updated = {**body, "timezone": "UTC", "units": "IMPERIAL", "notifications_enabled": False}
        response = await client.put("/api/v1/settings", json=updated)
        assert response.status_code == 200 and response.json() == updated
        assert (await client.get("/api/v1/settings")).json() == updated
        for patch, expected in [
            ({"calendar_enabled": "false"}, 422),
            ({"notifications_enabled": "true"}, 422),
            ({"member_id": FAMILY}, 403),
            ({"timezone": "Not/AZone"}, 422),
            ({"vton_provider": "DECART"}, 403),
            ({"weather_mode": "LIVE"}, 503),
            ({"calendar_enabled": True}, 503),
            ({"consents": {}}, 422),
        ]:
            assert (
                await client.put("/api/v1/settings", json={**updated, **patch})
            ).status_code == expected
        assert (await client.get("/api/v1/settings")).json() == updated

    run_case(real_dsn, settings_values, case)


def test_approved_status_and_care_contract(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        payload = dict(owner_id=OWNER, category="TOP", color="BLACK", care_label="hand wash")
        response = await client.post(
            "/api/v1/garments", json=payload, headers={"Idempotency-Key": str(uuid4())}
        )
        assert response.status_code == 201
        care_garment = UUID(response.json()["id"])
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text("SELECT care_label FROM wardrobe.garment WHERE id=:id"),
                    {"id": care_garment},
                )
                == "hand wash"
            )
        patched = await client.patch(
            f"/api/v1/garments/{care_garment}",
            json={**payload, "care_label": None},
            headers={"If-Match": "1"},
        )
        assert patched.status_code == 200
        async with engine.connect() as conn:
            assert (
                await conn.scalar(
                    text("SELECT jsonb_typeof(care_label) FROM wardrobe.garment WHERE id=:id"),
                    {"id": care_garment},
                )
                == "null"
            )
        assert (await client.get("/api/v1/garments?status=WORN")).status_code == 422
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.garment_state SET status='IN_USE' WHERE garment_id=:id"),
                {"id": UUID(GARMENT)},
            )
        assert (await client.get(f"/api/v1/garments/{GARMENT}")).json()["status"] == "IN_USE"
        assert (await client.delete(f"/api/v1/garments/{GARMENT}")).status_code == 422
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment")) == 5
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.domain_event_outbox")) == 2

    run_case(real_dsn, settings_values, case)


def test_invalid_asset_and_outbox_failure_roll_back_entire_command(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        payload = dict(owner_id=OWNER, category="TEST_ROLLBACK", color="BLUE")
        headers = {"Idempotency-Key": str(uuid4())}
        response = await client.post(
            "/api/v1/garments", json={**payload, "image_asset_id": str(uuid4())}, headers=headers
        )
        assert response.status_code == 404
        async with engine.begin() as conn:
            await conn.exec_driver_sql("""
                CREATE FUNCTION wardrobe.reject_fixture_event() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION 'deliberate test outbox failure'; END;
                $$ LANGUAGE plpgsql
            """)
            await conn.exec_driver_sql("""
                CREATE TRIGGER reject_fixture_event BEFORE INSERT ON wardrobe.domain_event_outbox
                FOR EACH ROW EXECUTE FUNCTION wardrobe.reject_fixture_event()
            """)
        failure = await client.post("/api/v1/garments", json=payload, headers=headers)
        assert failure.status_code == 500
        assert "deliberate test outbox failure" not in failure.text
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment")) == 4
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment_state")) == 3
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.domain_event_outbox")) == 0
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.idempotency_key")) == 1
        async with engine.begin() as conn:
            await conn.exec_driver_sql(
                "DROP TRIGGER reject_fixture_event ON wardrobe.domain_event_outbox"
            )
        # A failed transaction never consumes the caller's key.
        success = await client.post("/api/v1/garments", json=payload, headers=headers)
        assert success.status_code == 201

    run_case(real_dsn, settings_values, case)


def test_concurrent_observation_and_authenticated_principal_revalidation(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        payload = dict(
            garment_id=GARMENT,
            location_id=BOX,
            sensor_type="MOCK",
            confidence=1,
            observed_at=datetime.now(UTC).isoformat(),
            source_id="concurrent",
        )
        results = await asyncio.gather(
            *[
                client.post(
                    "/api/v1/garment-observations",
                    json=payload,
                    headers={"Idempotency-Key": str(uuid4())},
                )
                for _ in range(2)
            ]
        )
        assert all(result.status_code == 201 for result in results)
        assert results[0].json() == results[1].json()
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.garment_observation")) == 1
            assert await conn.scalar(text("SELECT count(*) FROM wardrobe.domain_event_outbox")) == 2
            assert (
                await conn.scalar(
                    text("SELECT version FROM wardrobe.garment WHERE id=:id"), {"id": UUID(GARMENT)}
                )
                == 2
            )
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wardrobe.member SET role='MEMBER' WHERE id=:id"), {"id": UUID(OWNER)}
            )
        # The same unexpired token is invalid once its DB principal role changes.
        assert (await client.get("/api/v1/garments")).status_code == 401

    run_case(real_dsn, settings_values, case)


def test_real_redis_session_rate_limit(real_dsn, settings_values):
    async def case(client, engine, settings, first, key, body):
        # The first login in exercise already consumed one of 30 requests.
        for _ in range(29):
            result = await client.post("/api/v1/sessions", json=body, headers=key)
            assert result.status_code == 201
        limited = await client.post("/api/v1/sessions", json=body, headers=key)
        assert limited.status_code == 429
        assert limited.json()["error"]["code"] == "RATE_LIMITED"
        assert limited.headers["Retry-After"] == "60"
        # Read budget is independent of session issuance budget.
        assert (await client.get("/api/v1/garments")).status_code == 200

    run_case(real_dsn, settings_values, case)


@pytest.mark.parametrize("explicit_null", [False, True])
def test_missing_or_cleared_location_has_no_last_seen_time(
    real_dsn, settings_values, explicit_null
):
    async def case(client, engine, settings, *unused):
        payload = dict(owner_id=OWNER, category="TOP", color="WHITE")
        if explicit_null:
            payload["location_id"] = None
        created = await client.post(
            "/api/v1/garments", json=payload, headers={"Idempotency-Key": str(uuid4())}
        )
        assert created.status_code == 201
        garment = created.json()
        assert garment["last_seen_at"] is None and garment["location_id"] is None
        url = "/api/v1/garments/" + garment["id"]
        located = await client.patch(
            url, json={**payload, "location_id": LOCATION},
            headers={"If-Match": str(garment["version"])},
        )
        assert located.status_code == 200
        assert located.json()["last_seen_at"] is not None
        cleared = await client.patch(
            url, json={**payload, "location_id": None},
            headers={"If-Match": str(located.json()["version"])},
        )
        assert cleared.status_code == 200
        assert cleared.json()["location_id"] is None
        assert cleared.json()["location_confidence"] is None
        assert cleared.json()["last_seen_at"] is None
        assert (await client.get(url)).json()["last_seen_at"] is None
        async with engine.connect() as connection:
            row = (await connection.execute(
                text("SELECT location_id, last_seen_at FROM wardrobe.garment_state "
                     "WHERE garment_id=:id"),
                {"id": UUID(garment["id"])},
            )).mappings().one()
            assert row["location_id"] is None and row["last_seen_at"] is None

    run_case(real_dsn, settings_values, case)
