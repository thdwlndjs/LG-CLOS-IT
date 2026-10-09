from uuid import uuid4

import pytest

from app.application.common.authorization import ActorContext, require_household, require_self
from app.core.errors import ApiError
from app.core.security import claims_to_actor, decode_token, issue_token


def test_actor_scope_is_not_taken_from_request_parameters():
    actor = ActorContext(uuid4(), uuid4(), "MEMBER", uuid4(), "unit")
    require_household(actor, actor.household_id)
    require_self(actor, actor.member_id)
    with pytest.raises(ApiError) as exc:
        require_household(actor, uuid4())
    assert exc.value.status == 404
    with pytest.raises(ApiError) as exc:
        require_self(actor, uuid4())
    assert exc.value.status == 403


@pytest.mark.parametrize("claims", [
    {}, {"role": "ADMIN"}, {"role": "DEMO"},
    {"role": "MEMBER", "sub": "invalid", "household_id": str(uuid4()), "sid": str(uuid4())},
])
def test_malformed_principal_claims_are_rejected(claims):
    with pytest.raises(ApiError) as exc:
        claims_to_actor(claims, "unit")
    assert exc.value.status == 401


def test_jwt_roundtrip_and_tampering(settings):
    pytest.importorskip("jwt", reason="PyJWT not installed; signature test requires pinned deps")
    member_id, household_id = uuid4(), uuid4()
    session_id, token, _expires = issue_token(settings, member_id, household_id, "OWNER")
    actor = decode_token(settings, token, "unit")
    assert (actor.member_id, actor.household_id, actor.session_id) == (
        member_id, household_id, session_id
    )
    with pytest.raises(ApiError):
        decode_token(settings, token + "corrupt", "unit")


@pytest.mark.parametrize("override", [
    {"exp": 0}, {"iss": "untrusted"}, {"aud": "untrusted"}, {"sub": "invalid"},
    {"role": "ADMIN"}, {"nbf": 9999999999},
])
def test_expired_or_wrong_jwt_claims_are_rejected(settings, override):
    jwt = pytest.importorskip("jwt", reason="PyJWT not installed; cryptographic tests pending")
    from app.core.clock import utc_now

    now = int(utc_now().timestamp())
    claims = dict(sub=str(uuid4()), household_id=str(uuid4()), sid=str(uuid4()), role="MEMBER",
                  exp=now+3600, iat=now, nbf=now, iss=settings.jwt_issuer,
                  aud=settings.jwt_audience)
    claims.update(override)
    token = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")
    with pytest.raises(ApiError):
        decode_token(settings, token, "unit")
