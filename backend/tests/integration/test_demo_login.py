from uuid import UUID

import pytest
from sqlalchemy import text

from tests.integration import test_sprint1_api as existing

pytestmark = pytest.mark.integration


@pytest.fixture
def real_dsn():
    yield from existing.real_dsn.__wrapped__()


def test_demo_button_session_is_fixed_scoped_revocable_and_disabled_outside_demo(
    real_dsn, settings_values
):
    async def case(client, engine, settings, *unused):
        path = "/api/v1/integration/demo-login"
        assert (await client.post(path)).status_code == 503
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                    "VALUES (:member,'demo','not-a-password-login')"
                ),
                dict(member=UUID(existing.OWNER)),
            )
        response = await client.post(path)
        assert response.status_code == 200, response.text
        assert str(response.json()["member"]["id"]) == existing.OWNER
        client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
        rows = (await client.get("/api/v1/garments")).json()["items"]
        assert rows and all(row["device_id"] for row in rows)
        assert (await client.get("/api/v1/integration/devices")).json()["items"]
        assert (await client.post("/api/v1/integration/logout")).status_code == 200
        assert (await client.get("/api/v1/integration/devices")).status_code == 401
        app = client._transport.app
        for patch in (
            {"demo_auth_enabled": False},
            {"auth_mode": "JWT"},
            {"app_env": "production"},
            {"public_deployment": True},
        ):
            app.state.settings = settings.model_copy(update=patch)
            assert (await client.post(path)).status_code == 403
        app.state.settings = settings
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE wardrobe.account_credential SET enabled=false"))
        assert (await client.post(path)).status_code == 503

    existing.run_case(real_dsn, settings_values, case)


def test_public_demo_is_explicit_member_scoped_and_revocable(real_dsn, settings_values):
    async def case(client, engine, settings, *unused):
        path = "/api/v1/integration/demo-login"
        public = settings.model_copy(update=dict(app_env="production", public_deployment=True,
            auth_mode="JWT", demo_auth_enabled=False, public_demo_login_enabled=True,
            public_demo_member_id=UUID(existing.FAMILY)))
        client._transport.app.state.settings = public
        assert (await client.post(path)).status_code == 503
        async with engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                "VALUES (:member,'public-demo','not-a-password-login')"),
                dict(member=UUID(existing.FAMILY)))
        response = await client.post(path)
        assert response.status_code == 200, response.text
        assert response.json()["member"]["id"] == existing.FAMILY
        assert response.json()["member"]["role"] == "MEMBER"
        client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
        assert (await client.get("/api/v1/integration/devices")).status_code == 200
        rows = (await client.get("/api/v1/garments")).json()["items"]
        assert rows and all(r["id"] != existing.OTHER_GARMENT for r in rows)
        owned = next(r for r in rows if r["owner_id"] == existing.OWNER)
        change = await client.patch("/api/v1/garments/" + owned["id"],
            headers={"If-Match": str(owned["version"])}, json={
                "owner_id": existing.FAMILY, "category": owned["category"],
                "color": "DO-NOT-CHANGE", "device_id": owned["device_id"]})
        assert change.status_code == 404
        assert (await client.post("/api/v1/integration/login", json={
            "login": "public-demo", "password": "any-password-value"})).status_code == 401

        assert (await client.get("/api/v1/garments/" + existing.OTHER_GARMENT)).status_code == 404
        assert (await client.post("/api/v1/integration/logout")).status_code == 200
        assert (await client.get("/api/v1/integration/devices")).status_code == 401
        for patch in ({"public_demo_login_enabled": False},
                      {"public_demo_member_id": UUID(existing.OWNER)}):
            client._transport.app.state.settings = public.model_copy(update=patch)
            assert (await client.post(path)).status_code in {403, 503}
        client._transport.app.state.settings = public
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE wardrobe.account_credential SET enabled=false"))
        assert (await client.post(path)).status_code == 503
    existing.run_case(real_dsn, settings_values, case)
