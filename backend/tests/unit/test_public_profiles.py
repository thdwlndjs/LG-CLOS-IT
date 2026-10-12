import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.v1 import integration
from app.core.errors import ApiError
from app.core.security import decode_token


def request(settings):
    @asynccontextmanager
    async def begin():
        yield object()

    database = SimpleNamespace(sessions=SimpleNamespace(begin=begin))
    state = SimpleNamespace(settings=settings, resources=SimpleNamespace(database=database))
    return SimpleNamespace(app=SimpleNamespace(state=state))


def test_public_login_never_reuses_local_profile_configuration(settings):
    public = settings.model_copy(update={
        "public_deployment": True, "public_demo_login_enabled": True,
        "public_demo_member_id": uuid4(), "local_demo_mother_member_id": uuid4(),
    })
    req = request(public)
    assert asyncio.run(integration.demo_profiles(req)) == {"items": []}
    with pytest.raises(ApiError):
        asyncio.run(integration.demo_login(req, integration.DemoLogin(profile="mother")))


def test_explicit_public_mother_is_member_only_and_has_no_home_station(settings, monkeypatch):
    mother, son, household = uuid4(), uuid4(), uuid4()
    public = settings.model_copy(update={
        "app_env": "staging", "public_deployment": True, "auth_mode": "JWT",
        "demo_auth_enabled": False, "public_demo_login_enabled": True,
        "public_demo_member_id": son, "public_demo_mother_member_id": mother,
        "local_demo_station_id": uuid4(),
    })
    calls = []

    class Repository:
        def __init__(self, session):
            pass

        async def one(self, sql, **params):
            calls.append(params)
            assert params["member"] == mother
            assert params["public_profiles"] and not params["configured_local"]
            assert "smart-wardrobe-remediation-2026-10-11" in sql
            return {"id": mother, "household_id": household,
                    "display_name": "Approved demo mother", "role": "OWNER"}

    monkeypatch.setattr(integration, "Sprint1Repository", Repository)
    result = asyncio.run(integration.demo_login(
        request(public), integration.DemoLogin(profile="mother")
    ))
    actor = decode_token(public, result["access_token"], "test")
    assert actor.member_id == mother and actor.station_id is None
    assert result["member"]["role"] == "MEMBER"
    assert len(calls) == 1
