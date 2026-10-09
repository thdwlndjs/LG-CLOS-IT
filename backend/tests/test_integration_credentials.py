from uuid import uuid4

from app.core.passwords import hash_password, verify_password
from app.core.security import decode_token, issue_token


def test_password_hashes_are_salted_and_verify():
    password = "unit-only-long-password"
    first, second = hash_password(password), hash_password(password)
    assert first != second and password not in first
    assert verify_password(password, first)
    assert not verify_password("incorrect-long-password", first)
    assert not verify_password(password, "malformed")


def test_station_is_signed_into_session(settings):
    member, household, station = uuid4(), uuid4(), uuid4()
    _, token, _ = issue_token(settings, member, household, "MEMBER", station_id=station)
    actor = decode_token(settings, token, "test")
    assert actor.station_id == station and actor.member_id == member
    _, legacy, _ = issue_token(settings, member, household, "MEMBER")
    assert decode_token(settings, legacy, "test").station_id is None
