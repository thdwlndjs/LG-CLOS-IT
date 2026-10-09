from datetime import timedelta
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.application.common.authorization import ActorContext
from app.core.clock import utc_now
from app.core.config import Settings
from app.core.errors import ApiError

bearer = HTTPBearer(auto_error=False, scheme_name="BearerAuth", bearerFormat="JWT")


def claims_to_actor(claims: dict, correlation_id: str) -> ActorContext:
    try:
        role = claims["role"]
        if role not in {"OWNER", "MEMBER", "CHILD"}:
            raise ValueError("Unsupported DB role")
        return ActorContext(
            household_id=UUID(claims["household_id"]), member_id=UUID(claims["sub"]),
            session_id=UUID(claims["sid"]), role=role, correlation_id=correlation_id,
        )
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise ApiError(401, "UNAUTHENTICATED", "Invalid session token") from exc


def issue_token(settings: Settings, member_id: UUID, household_id: UUID, role: str):
    import jwt

    now = utc_now()
    expires = now + timedelta(seconds=settings.jwt_ttl_seconds)
    session_id = uuid4()
    claims = {
        "sub": str(member_id), "household_id": str(household_id), "role": role,
        "sid": str(session_id), "iat": now, "nbf": now, "exp": expires,
        "iss": settings.jwt_issuer, "aud": settings.jwt_audience,
    }
    # Reject unsupported roles before signing, including the unresolved API-only DEMO role.
    claims_to_actor(claims, "issuance")
    token = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")
    return session_id, token, expires


def decode_token(settings: Settings, token: str, correlation_id: str) -> ActorContext:
    import jwt

    try:
        claims = jwt.decode(
            token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"],
            issuer=settings.jwt_issuer, audience=settings.jwt_audience,
            options={"require": ["exp", "iat", "nbf", "sub", "sid", "household_id", "role"]},
        )
    except jwt.InvalidTokenError as exc:
        raise ApiError(401, "UNAUTHENTICATED", "Invalid or expired session token") from exc
    return claims_to_actor(claims, correlation_id)


async def current_actor(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer)],
) -> ActorContext:
    if credentials is None:
        raise ApiError(401, "UNAUTHENTICATED", "Bearer session token required")
    actor = decode_token(request.app.state.settings, credentials.credentials,
                         request.state.correlation_id)
    database = request.app.state.resources.database
    async with database.sessions() as session:
        from sqlalchemy import select

        from app.infrastructure.db.models import Member

        member = await session.scalar(select(Member).where(
            Member.id == actor.member_id, Member.household_id == actor.household_id
        ))
        if member is None or member.role != actor.role:
            raise ApiError(401, "UNAUTHENTICATED", "Session principal is no longer valid")
    return actor
