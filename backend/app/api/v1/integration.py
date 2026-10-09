"""Additive integration contracts. Legacy Sprint APIs remain available."""

import asyncio
import hashlib
from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.application.common.authorization import ActorContext
from app.application.common.idempotency import canonical
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.core.passwords import verify_password
from app.core.rate_limit import rate_guard
from app.core.security import current_actor, issue_token
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.errors import ErrorEnvelope

router = APIRouter(prefix="/api/v1/integration", dependencies=[Depends(rate_guard)],
                   tags=["Integration"], responses={422: {"model": ErrorEnvelope}})
Actor = Annotated[ActorContext, Depends(current_actor)]
Key = Annotated[UUID, Header(alias="Idempotency-Key")]


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    login: str = Field(min_length=1, max_length=200)
    password: SecretStr
    station_id: UUID | None = None
    station_credential: SecretStr | None = None


class Illuminate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: UUID
    garment_ids: list[UUID] = Field(min_length=1, max_length=20)


@router.post("/login")
async def login(request: Request, body: Login):
    runtime = request.app.state.resources
    async with runtime.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        member = await repo.one(
            "SELECT m.*,c.password_hash FROM wardrobe.account_credential c "
            "JOIN wardrobe.member m ON m.id=c.member_id WHERE c.login=:login AND c.enabled",
            login=body.login.strip().casefold(),
        )
        # Dummy hash follows the same expensive path for unknown accounts.
        dummy = "pbkdf2_sha256$600000$" + "00" * 16 + "$" + "00" * 32
        valid = await asyncio.to_thread(
            verify_password, body.password.get_secret_value(),
            member["password_hash"] if member else dummy,
        )
        if not valid or member is None:
            raise ApiError(401, "UNAUTHENTICATED", "Invalid account credentials")
        if body.station_id is not None:
            station = await repo.one(
                "SELECT credential_hash FROM wardrobe.access_station WHERE id=:id AND enabled",
                id=body.station_id,
            )
            if not station or not body.station_credential or not await asyncio.to_thread(
                verify_password, body.station_credential.get_secret_value(),
                station["credential_hash"],
            ):
                raise ApiError(401, "UNAUTHENTICATED", "Invalid station credentials")
        elif body.station_credential is not None:
            raise ApiError(422, "VALIDATION_ERROR", "Station identifier required")
        sid, token, expires = issue_token(
            request.app.state.settings, member["id"], member["household_id"],
            member["role"], station_id=body.station_id,
            personal_account=True,
        )
        return dict(session_id=sid, access_token=token, token_type="Bearer", expires_at=expires,
                    member={k: member[k] for k in ("id", "household_id", "display_name", "role")})


@router.post("/demo-login")
async def demo_login(request: Request):
    settings = request.app.state.settings
    if (settings.app_env not in {"local", "test"} or settings.public_deployment
            or not settings.demo_auth_enabled or settings.auth_mode != "DEMO"):
        raise ApiError(403, "FORBIDDEN", "Demo login is disabled")
    async with request.app.state.resources.database.sessions.begin() as session:
        member = await Sprint1Repository(session).one(
            "SELECT m.* FROM wardrobe.member m JOIN wardrobe.account_credential c "
            "ON c.member_id=m.id WHERE m.id=:member AND c.login='demo' AND c.enabled",
            member=UUID("20000000-0000-4000-8000-000000000001"),
        )
        if member is None:
            raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "Demo account is not provisioned")
        sid, token, expires = issue_token(
            settings, member["id"], member["household_id"], member["role"],
            personal_account=True,
        )
        return dict(session_id=sid, access_token=token, token_type="Bearer", expires_at=expires,
                    member={k: member[k] for k in ("id", "household_id", "display_name", "role")})


@router.post("/logout")
async def logout(request: Request, actor: Actor):
    if not actor.personal_account:
        raise ApiError(403, "FORBIDDEN", "Personal account session required")
    await request.app.state.resources.redis.setex(
        f"wardrobe:revoked:{actor.session_id}", 86400, "1")
    return dict(authenticated=False, revocation="confirmed")


@router.get("/devices")
async def devices(request: Request, actor: Actor):
    async with request.app.state.resources.database.sessions.begin() as session:
        return {"items": await Sprint1Repository(session).all(
            "SELECT d.id,d.name FROM wardrobe.device d JOIN wardrobe.device_member dm "
            "ON dm.device_id=d.id WHERE dm.member_id=:member AND dm.household_id=:household "
            "ORDER BY d.id", member=actor.member_id, household=actor.household_id,
        ), "access_station_id": actor.station_id}


async def accessible(repo, actor, device_id):
    row = await repo.one(
        "SELECT device_id FROM wardrobe.device_member "
        "WHERE device_id=:device AND member_id=:member AND household_id=:household",
        device=device_id, member=actor.member_id, household=actor.household_id,
    )
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Device not found")


@router.get("/devices/{device_id}/locations")
async def locations(request: Request, actor: Actor, device_id: UUID):
    async with request.app.state.resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        await accessible(repo, actor, device_id)
        rows = await repo.all(
            "SELECT l.id,l.name,l.location_type,z.anchor_id FROM wardrobe.storage_location l "
            "JOIN wardrobe.device d ON d.household_id=l.household_id "
            "LEFT JOIN wardrobe.lighting_zone z ON z.location_id=l.id AND z.device_id=d.id "
            "WHERE d.id=:device ORDER BY l.id", device=device_id,
        )
        return dict(items=[dict(row) for row in rows])


@router.post("/led-commands", status_code=201)
async def illuminate(request: Request, actor: Actor, body: Illuminate, key: Key):
    settings = request.app.state.settings
    if settings.led_off_seconds is None:
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "LED_OFF_SECONDS must be configured")
    async with request.app.state.resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        await accessible(repo, actor, body.device_id)
        station = await repo.one(
            "SELECT id FROM wardrobe.access_station WHERE id=:station AND enabled "
            "AND kind='HOME' AND device_id=:device",
            station=actor.station_id, device=body.device_id,
        )
        if station is None:
            raise ApiError(403, "FORBIDDEN", "Local home station required for wardrobe LEDs")
        fingerprint = hashlib.sha256(canonical(body.model_dump(mode="json")).encode()).hexdigest()
        await repo.lock(f"led:{actor.member_id}:{key}")
        old = await repo.one(
            "SELECT * FROM wardrobe.led_command WHERE member_id=:member AND idempotency_key=:key",
            member=actor.member_id, key=key,
        )
        if old:
            if old["fingerprint"] != fingerprint:
                raise ApiError(409, "CONFLICT", "Idempotency key reused with another command")
            return command_dto(old)
        anchors, unresolved = [], []
        for garment_id in dict.fromkeys(body.garment_ids):
            row = await repo.one(
                "SELECT g.id,s.status,s.location_confidence,s.last_seen_at,z.anchor_id "
                "FROM wardrobe.garment g LEFT JOIN wardrobe.garment_state s ON s.garment_id=g.id "
                "LEFT JOIN wardrobe.storage_location l ON l.id=s.location_id "
                "AND l.household_id=g.household_id LEFT JOIN wardrobe.lighting_zone z "
                "ON z.location_id=l.id AND z.device_id=g.device_id "
                "WHERE g.id=:id AND g.device_id=:device AND g.household_id=:household "
                "AND g.retired_at IS NULL", id=garment_id, device=body.device_id,
                household=actor.household_id,
            )
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Garment not found in device")
            if (row["anchor_id"] is None
                    or row["location_confidence"] is None or row["location_confidence"] < 0.9
                    or row["last_seen_at"] is None
                    or row["last_seen_at"] < utc_now() - timedelta(hours=24)):
                unresolved.append(str(garment_id))
            else:
                anchors.append(row["anchor_id"])
        if unresolved:
            # Fail closed: a partial command does not silently claim all items located.
            raise ApiError(409, "CONFLICT", "Reliable mapped locations required for every garment")
        row = await repo.one(
            "INSERT INTO wardrobe.led_command(member_id,station_id,device_id,idempotency_key,"
            "fingerprint,anchor_ids,expires_at) VALUES(:member,:station,:device,:key,:fingerprint,"
            ":anchors,:expires) RETURNING *", member=actor.member_id, station=actor.station_id,
            device=body.device_id, key=key, fingerprint=fingerprint, anchors=sorted(set(anchors)),
            expires=utc_now() + timedelta(seconds=settings.led_off_seconds),
        )
        return command_dto(row)


def command_dto(row):
    active = row["expires_at"] > utc_now()
    return dict(id=row["id"], device_id=row["device_id"], controller="MOCK",
                status="ON" if active else "OFF", anchor_ids=row["anchor_ids"] if active else [],
                expires_at=row["expires_at"])


@router.get("/devices/{device_id}/led-state")
async def led_state(request: Request, actor: Actor, device_id: UUID):
    async with request.app.state.resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        await accessible(repo, actor, device_id)
        rows = await repo.all(
            "SELECT * FROM wardrobe.led_command WHERE device_id=:device AND expires_at>now()",
            device=device_id,
        )
        return dict(controller="MOCK",
                    anchor_ids=sorted({a for r in rows for a in r["anchor_ids"]}),
                    commands=[command_dto(row) for row in rows])
