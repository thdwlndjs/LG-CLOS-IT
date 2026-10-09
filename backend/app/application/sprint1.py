from datetime import UTC, timedelta
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.application.common.authorization import require_self
from app.application.common.idempotency import canonical, idempotent
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.core.security import issue_token
from app.domain.observations import projection_decision
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint1 import Garment, GarmentList, LocatedGarment, LocatedGarmentList, Page
from app.schemas.sprint1 import Settings as SettingsDTO

DEMO_HOUSEHOLD = UUID("10000000-0000-4000-8000-000000000001")
DEMO_MEMBERS = frozenset(UUID(f"20000000-0000-4000-8000-{i:012d}") for i in (1, 2))
COMMON_STATUSES = frozenset(
    {"AVAILABLE", "IN_USE", "LAUNDRY", "CARE", "STORED", "UNKNOWN", "RETIRED"}
)


def design_conflict(message):
    raise ApiError(409, "DESIGN_CONFLICT", message)


def nonblank(value):
    if not value.strip():
        raise ApiError(422, "VALIDATION_ERROR", "Blank values are not allowed")


class Sprint1:
    def __init__(self, request):
        self.settings = request.app.state.settings
        self.sessions = request.app.state.resources.database.sessions
        self.resources = request.app.state.resources

    async def session_start(self, body, key):
        settings = self.settings
        if not (
            settings.demo_auth_enabled
            and settings.auth_mode == "DEMO"
            and settings.app_env in {"local", "test"}
            and not settings.public_deployment
            and body.demo_mode
        ):
            raise ApiError(403, "FORBIDDEN", "Explicit private demo authentication required")
        if body.household_id != DEMO_HOUSEHOLD or body.member_id not in DEMO_MEMBERS:
            raise ApiError(403, "FORBIDDEN", "Profile is not an allowlisted demo profile")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            member = await repo.one(
                "SELECT id,household_id,display_name,role FROM wardrobe.member "
                "WHERE id=:id AND household_id=:household",
                id=body.member_id,
                household=body.household_id,
            )
            if member is None:
                raise ApiError(404, "NOT_FOUND", "Demo profile not found")

            async def issue():
                sid, token, expires = issue_token(
                    settings, member["id"], member["household_id"], member["role"]
                )
                from app.schemas.sprint1 import SessionStartResponse

                response = SessionStartResponse(
                    session_id=sid,
                    access_token=token,
                    token_type="Bearer",
                    expires_at=expires,
                    member=dict(member),
                    capabilities=[
                        "garments:read",
                        "garments:write",
                        "observations:write",
                        "storage:locate",
                        "settings:read",
                        "settings:write",
                    ],
                ).model_dump(mode="json")
                await self.audit(
                    repo,
                    member["id"],
                    member["household_id"],
                    "SessionStarted",
                    "member",
                    member["id"],
                    {},
                )
                return response

            return await idempotent(
                repo,
                member["id"],
                "session_start",
                key,
                body.model_dump(mode="json"),
                201,
                issue,
                ttl=settings.jwt_ttl_seconds,
            )

    async def dto(self, row):
        if row["status"] not in COMMON_STATUSES:
            design_conflict("Garment status has no approved API mapping (D-005)")
        image = None
        if row["asset_id"] is not None:
            from app.application.assets import signed_asset

            image = signed_asset(self.settings, row)
        return Garment(
            id=row["id"],
            owner_id=row["owner_id"],
            device_id=row["device_id"],
            name=row["name"],
            category=row["category"],
            color=row["color"],
            material=row["material"],
            season_tags=row["season_tags"],
            image=image,
            status=row["status"],
            location_id=row["location_id"],
            location_confidence=row["location_confidence"],
            last_seen_at=row["last_seen_at"],
            version=row["version"],
            care_label=(row["care_label"] if isinstance(row["care_label"], str) else None),
            location_label=row["location_label"],
            stale=self.stale(row),
            shared_with_member_ids=row["shared_with_member_ids"] or [],
            care_guide_available=True,
            care_guide_url=f"/api/v1/garments/{row['id']}/care-guide",
        )

    @staticmethod
    def stale(row):
        return row["last_seen_at"] is None or row["last_seen_at"] < utc_now() - timedelta(hours=24)

    async def detail(self, actor, garment_id):
        async with self.sessions.begin() as session:
            row = await self.require_garment(Sprint1Repository(session), actor, garment_id)
            return await self.dto(row)

    async def require_garment(self, repo, actor, garment_id, lock=False):
        row = await repo.garment(actor, garment_id, lock=lock)
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Garment not found")
        return row

    async def validate_owner_filter(self, repo, actor, owner_id):
        if owner_id is None or owner_id == actor.member_id:
            return
        member = await repo.one(
            "SELECT id FROM wardrobe.member WHERE id=:id AND household_id=:household",
            id=owner_id,
            household=actor.household_id,
        )
        if member is None:
            raise ApiError(404, "NOT_FOUND", "Owner not found")

    async def listing(self, actor, filters, member_id, limit, offset, locate=False):
        if member_id is not None:
            require_self(actor, member_id)
        status = filters.get("status")
        if status is not None:
            if status not in COMMON_STATUSES:
                raise ApiError(422, "VALIDATION_ERROR", "Unsupported status filter")
        async with self.sessions.begin() as session:
            # Count and page see one consistent DB snapshot, including concurrent writers.
            repo = Sprint1Repository(session)
            await repo.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            await self.validate_owner_filter(repo, actor, filters.get("owner_id"))
            rows, total = await repo.garments(actor, filters, limit, offset)
            page = Page(limit=limit if limit is not None else total, offset=offset, total=total)
            if locate:
                return LocatedGarmentList(
                    items=[
                        LocatedGarment(
                            garment_id=r["id"],
                            location_id=r["location_id"],
                            location_label=r["location_label"],
                            confidence=r["location_confidence"],
                            last_seen_at=r["last_seen_at"],
                            status=(
                                "UNKNOWN"
                                if r["location_id"] is None
                                else "STALE"
                                if self.stale(r)
                                else "FOUND"
                            ),
                            fallback=(
                                "Register a location or a new observation"
                                if r["location_id"] is None or self.stale(r)
                                else None
                            ),
                        )
                        for r in rows
                    ],
                    page=page,
                )
            return GarmentList(items=[await self.dto(row) for row in rows], page=page)

    async def upsert(self, actor, body, key=None, garment_id=None, version=None):
        require_self(actor, body.owner_id)
        if actor.personal_account and body.device_id is None and (
            garment_id is None or "device_id" in body.model_fields_set
        ):
            raise ApiError(422, "VALIDATION_ERROR", "Select an accessible storage device")
        nonblank(body.category)
        nonblank(body.color)
        for season in body.season_tags:
            nonblank(season)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def mutate():
                await repo.lock('storage-household:' + str(actor.household_id))
                if body.device_id is not None:
                    device = await repo.one(
                        "SELECT device_id FROM wardrobe.device_member WHERE device_id=:device "
                        "AND member_id=:member AND household_id=:household",
                        device=body.device_id, member=actor.member_id, household=actor.household_id,
                    )
                    if device is None:
                        raise ApiError(404, "NOT_FOUND", "Device not found")
                if garment_id is not None:
                    row = await self.require_garment(repo, actor, garment_id, lock=True)
                    await self.dto(row)  # Unmapped states must not be silently overwritten.
                    if row["version"] != version:
                        raise ApiError(409, "CONFLICT", "Garment version changed")
                if body.location_id is not None:
                    location = await repo.one(
                        "SELECT id FROM wardrobe.storage_location WHERE id=:id AND household_id=:h",
                        id=body.location_id,
                        h=actor.household_id,
                    )
                    if location is None:
                        raise ApiError(404, "NOT_FOUND", "Location not found")
                recipients = set(body.shared_with_member_ids)
                for recipient in recipients:
                    member = await repo.one(
                        "SELECT id FROM wardrobe.member WHERE id=:id AND household_id=:h",
                        id=recipient,
                        h=actor.household_id,
                    )
                    if member is None:
                        raise ApiError(404, "NOT_FOUND", "Share recipient not found")
                    if recipient == actor.member_id:
                        raise ApiError(422, "VALIDATION_ERROR", "Cannot share with self")
                if body.image_asset_id is not None:
                    asset = await repo.one(
                        "SELECT id FROM wardrobe.asset WHERE id=:id AND household_id=:household "
                        "AND owner_id=:owner AND status='READY' AND kind='GARMENT' "
                        "AND retention_expires_at > now() AND EXISTS (SELECT 1 FROM "
                        "wardrobe.member_settings WHERE member_id=:owner AND image_upload_consent)",
                        id=body.image_asset_id,
                        household=actor.household_id,
                        owner=actor.member_id,
                    )
                    if asset is None:
                        raise ApiError(404, "NOT_FOUND", "Ready garment asset not found")
                payload = body.model_dump(mode="json", exclude_unset=True)
                if garment_id is None:
                    target = uuid4()
                    await repo.execute(
                        "INSERT INTO wardrobe.garment "
                        "(id,household_id,owner_id,device_id,name,category,color,material,"
                        "season_tags,image_asset_id,care_label) "
                        "VALUES (:id,:household,:owner,:device,:name,:category,:color,:material,"
                        ":seasons,:image,"
                        "CAST(:care AS jsonb))",
                        id=target,
                        household=actor.household_id,
                        owner=actor.member_id,
                        device=body.device_id,
                        name=body.name,
                        category=body.category,
                        color=body.color,
                        material=body.material,
                        seasons=body.season_tags,
                        image=body.image_asset_id,
                        care=canonical(
                            body.care_label if "care_label" in body.model_fields_set else {}
                        ),
                    )
                    await repo.execute(
                        "INSERT INTO wardrobe.garment_state(garment_id) VALUES (:id)", id=target
                    )
                    event = "GarmentRegistered"
                else:
                    target = garment_id
                    sets = [
                        "category=:category",
                        "color=:color",
                        "version=version+1",
                        "updated_at=now()",
                    ]
                    params = {"id": target, "category": body.category, "color": body.color}
                    for field, column in (
                        ("material", "material"),
                        ("name", "name"),
                        ("device_id", "device_id"),
                        ("season_tags", "season_tags"),
                        ("image_asset_id", "image_asset_id"),
                    ):
                        if field in body.model_fields_set:
                            sets.append(f"{column}=:{field}")
                            params[field] = getattr(body, field)
                    if "care_label" in body.model_fields_set:
                        sets.append("care_label=CAST(:care AS jsonb)")
                        params["care"] = canonical(body.care_label)
                    await repo.execute(
                        "UPDATE wardrobe.garment SET " + ",".join(sets) + " WHERE id=:id", **params
                    )
                    event = "GarmentUpdated"
                if "location_id" in body.model_fields_set:
                    await repo.execute(
                        "UPDATE wardrobe.garment_state SET location_id=:loc,"
                        "location_confidence=:conf,"
                        "last_seen_at=:seen,"
                        "updated_at=now(),"
                        "version=version+1 WHERE garment_id=:id",
                        id=target,
                        loc=body.location_id,
                        conf=1.0 if body.location_id else None,
                        seen=utc_now() if body.location_id else None,
                    )
                if "shared_with_member_ids" in body.model_fields_set:
                    await repo.execute(
                        "DELETE FROM wardrobe.garment_share WHERE garment_id=:id", id=target
                    )
                    for recipient in recipients:
                        await repo.execute(
                            "INSERT INTO wardrobe.garment_share(garment_id,member_id,household_id) "
                            "VALUES (:id,:member,:h)",
                            id=target,
                            member=recipient,
                            h=actor.household_id,
                        )
                if "tag_value" in body.model_fields_set:
                    await repo.execute(
                        "DELETE FROM wardrobe.garment_tag WHERE garment_id=:id", id=target
                    )
                    if body.tag_value is not None:
                        nonblank(body.tag_value)
                        await repo.lock("tag:" + body.tag_value)
                        if await repo.one(
                            "SELECT id FROM wardrobe.garment_tag WHERE tag_value=:v",
                            v=body.tag_value,
                        ):
                            raise ApiError(409, "CONFLICT", "Tag already registered")
                        await repo.execute(
                            "INSERT INTO wardrobe.garment_tag(garment_id,tag_value) VALUES "
                            "(:id,:v)",
                            id=target,
                            v=body.tag_value,
                        )
                await self.event(repo, actor, event, "garment", target, payload)
                return (await self.dto(await repo.garment(actor, target))).model_dump(mode="json")

            if garment_id is not None:
                return await mutate()
            return await idempotent(
                repo,
                actor.member_id,
                "garment_create",
                key,
                body.model_dump(mode="json", exclude_unset=True),
                201,
                mutate,
            )

    async def observation(self, actor, body, key):
        if (body.garment_id is None) == (body.tag_value is None):
            raise ApiError(422, "VALIDATION_ERROR", "Specify exactly one garment_id or tag_value")
        if body.tag_value is not None:
            nonblank(body.tag_value)
            async with self.sessions.begin() as session:
                tag = await Sprint1Repository(session).one(
                    "SELECT t.garment_id FROM wardrobe.garment_tag t JOIN wardrobe.garment g "
                    "ON g.id=t.garment_id WHERE t.tag_value=:v AND g.household_id=:h "
                    "AND g.owner_id=:owner AND g.retired_at IS NULL",
                    v=body.tag_value,
                    h=actor.household_id,
                    owner=actor.member_id,
                )
                if tag is None:
                    raise ApiError(404, "NOT_FOUND", "Tag not found")
                body = body.model_copy(update={"garment_id": tag["garment_id"]})
        if not 0 <= body.confidence <= 1 or body.observed_at > utc_now():
            raise ApiError(422, "VALIDATION_ERROR", "Invalid confidence or future timestamp")
        nonblank(body.source_id)
        if body.sensor_type not in {"MANUAL", "MOCK"}:
            raise ApiError(503, "SENSOR_UNAVAILABLE", "Verified hardware ingress is not configured")
        if body.sensor_type == "MOCK" and (
            self.settings.app_env not in {"local", "test"} or self.settings.public_deployment
        ):
            raise ApiError(403, "FORBIDDEN", "Mock observations require private development mode")
        normalized = body.model_dump(mode="json")
        # Preserve pre-1.1 observation hashes for clients using the source/time identity.
        for optional in ("observation_id", "tag_value"):
            if normalized[optional] is None:
                normalized.pop(optional)
        normalized["observed_at"] = body.observed_at.astimezone(UTC).isoformat()
        identity = (
            f"{body.garment_id}:{body.sensor_type}:{body.source_id}:" + normalized["observed_at"]
        )
        observation_id = body.observation_id or uuid5(
            NAMESPACE_URL, "smart-wardrobe:observation:" + identity
        )
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def observe():
                await repo.lock("observation:" + str(observation_id))
                row = await self.require_garment(repo, actor, body.garment_id, lock=True)
                await self.dto(row)
                if body.location_id is not None:
                    location = await repo.one(
                        "SELECT id FROM wardrobe.storage_location WHERE id=:id "
                        "AND household_id=:household",
                        id=body.location_id,
                        household=actor.household_id,
                    )
                    if location is None:
                        raise ApiError(404, "NOT_FOUND", "Location not found")
                prior = await repo.one(
                    "SELECT raw_payload FROM wardrobe.garment_observation WHERE id=:id",
                    id=observation_id,
                )
                if prior:
                    if prior["raw_payload"]["request"] != normalized:
                        raise ApiError(409, "CONFLICT", "Observation identity has different data")
                    return prior["raw_payload"]["response"]
                decision = projection_decision(
                    row["last_seen_at"], row["location_confidence"], row["location_id"], body
                )
                changed = decision != "retain"
                if changed:
                    unknown = body.location_id is None or decision == "conflict"
                    location_id = None if unknown else body.location_id
                    confidence = None if unknown else body.confidence
                    status = "UNKNOWN" if unknown else row["status"]
                    await repo.execute(
                        "INSERT INTO wardrobe.garment_state "
                        "(garment_id,location_id,status,location_confidence,last_seen_at,version) "
                        "VALUES (:id,:location,CAST(:status AS wardrobe.garment_status),"
                        ":confidence,"
                        ":seen,1) ON CONFLICT(garment_id) DO UPDATE SET "
                        "location_id=excluded.location_id,status=excluded.status,"
                        "location_confidence=excluded.location_confidence,"
                        "last_seen_at=excluded.last_seen_at,version=garment_state.version+1,"
                        "updated_at=now()",
                        id=body.garment_id,
                        location=location_id,
                        status=status,
                        confidence=confidence,
                        seen=body.observed_at,
                    )
                    await repo.execute(
                        "UPDATE wardrobe.garment SET version=version+1,"
                        "updated_at=now() WHERE id=:id",
                        id=body.garment_id,
                    )
                response = {
                    "observation_id": str(observation_id),
                    "state_updated": changed,
                    "garment": (
                        await self.dto(await repo.garment(actor, body.garment_id))
                    ).model_dump(mode="json"),
                }
                await repo.execute(
                    "INSERT INTO wardrobe.garment_observation "
                    "(id,garment_id,location_id,sensor_type,confidence,observed_at,sensor_id,raw_payload)"
                    " VALUES (:id,:garment,:location,CAST(:sensor AS wardrobe.observation_source),"
                    ":confidence,:seen,:source,CAST(:payload AS jsonb))",
                    id=observation_id,
                    garment=body.garment_id,
                    location=body.location_id,
                    sensor=body.sensor_type,
                    confidence=body.confidence,
                    seen=body.observed_at,
                    source=body.source_id,
                    payload=canonical({"request": normalized, "response": response}),
                )
                await self.event(
                    repo,
                    actor,
                    "GarmentObserved",
                    "garment",
                    body.garment_id,
                    {"observation_id": str(observation_id)},
                )
                if changed:
                    await self.event(
                        repo,
                        actor,
                        "GarmentStateChanged",
                        "garment",
                        body.garment_id,
                        {"observation_id": str(observation_id)},
                    )
                return response

            return await idempotent(
                repo, actor.member_id, "observation_create", key, normalized, 201, observe
            )

    async def settings_get(self, actor, member_id):
        require_self(actor, member_id or actor.member_id)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT member_id,timezone,units,weather_mode,calendar_enabled,vton_provider,"
                "notifications_enabled,image_upload_consent FROM "
                "wardrobe.member_settings WHERE member_id=:id",
                id=actor.member_id,
            )
            if row is None:
                # Exact DDL defaults, without a write on GET.
                row = dict(
                    member_id=actor.member_id,
                    timezone="Asia/Seoul",
                    units="METRIC",
                    weather_mode="MOCK",
                    calendar_enabled=False,
                    vton_provider="MOCK",
                    notifications_enabled=True,
                )
            return SettingsDTO(**row)

    async def settings_put(self, actor, body):
        require_self(actor, body.member_id)
        try:
            ZoneInfo(body.timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid timezone") from exc
        if body.vton_provider != self.settings.vton_provider:
            raise ApiError(403, "FORBIDDEN", "Provider is controlled by server policy")
        if body.weather_mode != "MOCK" or body.calendar_enabled:
            raise ApiError(503, "PROVIDER_UNAVAILABLE", "Live weather/calendar are not configured")
        payload = body.model_dump(mode="json")
        payload.pop("provider_connection_status")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await repo.lock("consent:" + str(actor.member_id))
            prior = await repo.one(
                "SELECT image_upload_consent FROM wardrobe.member_settings WHERE member_id=:id",
                id=actor.member_id,
            )
            await repo.execute(
                "INSERT INTO wardrobe.member_settings "
                "(member_id,timezone,units,weather_mode,calendar_enabled,vton_provider,"
                "notifications_enabled,image_upload_consent) VALUES "
                "(:member_id,:timezone,:units,:weather_mode,"
                ":calendar_enabled,:vton_provider,:notifications_enabled,:image_upload_consent) "
                "ON CONFLICT(member_id) DO UPDATE SET timezone=excluded.timezone,"
                "units=excluded.units,weather_mode=excluded.weather_mode,"
                "calendar_enabled=excluded.calendar_enabled,vton_provider=excluded.vton_provider,"
                "notifications_enabled=excluded.notifications_enabled,"
                "image_upload_consent=excluded.image_upload_consent,updated_at=now()",
                **payload,
            )
            if (prior["image_upload_consent"] if prior else False) != body.image_upload_consent:
                await repo.execute(
                    "INSERT INTO wardrobe.consent_history(member_id,granted) VALUES (:id,:granted)",
                    id=actor.member_id,
                    granted=body.image_upload_consent,
                )
            if not body.image_upload_consent:
                await repo.execute(
                    "UPDATE wardrobe.asset SET status='DELETED' WHERE owner_id=:id "
                    "AND status <> 'DELETED'",
                    id=actor.member_id,
                )
            await self.event(repo, actor, "SettingsUpdated", "member", actor.member_id, payload)
        if not body.image_upload_consent:
            from app.application.assets import cleanup_assets

            await cleanup_assets(
                self.settings, self.sessions, self.resources.storage, actor.member_id
            )
        return body

    async def consent_history(self, actor):
        async with self.sessions.begin() as session:
            rows = await Sprint1Repository(session).all(
                "SELECT id,granted,policy_version,changed_at FROM wardrobe.consent_history "
                "WHERE member_id=:id ORDER BY changed_at,id",
                id=actor.member_id,
            )
            return {"items": [dict(row) for row in rows]}

    async def delete(self, actor, garment_id, version):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await self.require_garment(repo, actor, garment_id, lock=True)
            if row["version"] != version:
                raise ApiError(409, "CONFLICT", "Garment version changed")
            await repo.execute(
                "UPDATE wardrobe.garment SET "
                "retired_at=now(),version=version+1,updated_at=now() WHERE id=:id",
                id=garment_id,
            )
            await repo.execute(
                "UPDATE wardrobe.garment_state SET "
                "status='RETIRED',version=version+1,updated_at=now() WHERE garment_id=:id",
                id=garment_id,
            )
            await repo.execute(
                "DELETE FROM wardrobe.garment_share WHERE garment_id=:id", id=garment_id
            )
            await self.event(repo, actor, "GarmentRetired", "garment", garment_id, {})
        return {"garment_id": str(garment_id), "deleted": True}

    async def event(self, repo, actor, event, aggregate, target, payload):
        await repo.execute(
            "INSERT INTO wardrobe.domain_event_outbox "
            "(aggregate_type,aggregate_id,event_type,household_id,correlation_id,payload) "
            "VALUES (:aggregate,:target,:event,:household,:correlation,CAST(:payload AS jsonb))",
            aggregate=aggregate,
            target=target,
            event=event,
            household=actor.household_id,
            correlation=actor.correlation_id,
            payload=canonical(payload),
        )
        await self.audit(
            repo,
            actor.member_id,
            actor.household_id,
            event,
            aggregate,
            target,
            payload,
            actor.correlation_id,
        )

    async def audit(
        self, repo, member, household, action, target_type, target, details, correlation=None
    ):
        await repo.execute(
            "INSERT INTO wardrobe.audit_log "
            "(actor_member_id,household_id,action,target_type,target_id,correlation_id,details) "
            "VALUES (:member,:household,:action,:type,:target,:correlation,"
            "CAST(:details AS jsonb))",
            member=member,
            household=household,
            action=action,
            type=target_type,
            target=target,
            correlation=correlation,
            details=canonical(details),
        )
