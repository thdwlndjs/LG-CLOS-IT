from uuid import uuid4

from app.application.common.authorization import require_self
from app.application.common.idempotency import canonical, idempotent
from app.application.sprint4 import Sprint4
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.domain.care import date_window, label_constraints, next_recurrence, timezone_for
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint1 import Page
from app.schemas.sprint5 import (
    CareConstraints,
    CareGuide,
    CareSchedule,
    CareScheduleList,
    HistoryItem,
    HistoryItemList,
    WearRecord,
)


def not_future(at):
    if at > utc_now():
        raise ApiError(422, "VALIDATION_ERROR", "Future performed time is not allowed")


def check_version(row, expected):
    if row["version"] != expected:
        raise ApiError(409, "CONFLICT", "Record version changed")


class Sprint5(Sprint4):
    def wear_dto(self, row):
        return WearRecord(
            **{
                k: row[k]
                for k in (
                    "id",
                    "member_id",
                    "outfit_id",
                    "worn_at",
                    "confirmation_method",
                    "session_id",
                    "context_snapshot_id",
                    "confirmed_at",
                    "cancelled_at",
                    "version",
                    "items_snapshot",
                )
            },
            snapshot_status="FROZEN" if row["items_snapshot"] is not None else "LEGACY_UNAVAILABLE",
        )

    async def wear_confirm(self, actor, body, key):
        require_self(actor, body.member_id)
        if body.confirmation_method != "USER":
            raise ApiError(
                503, "SENSOR_VERIFICATION_UNAVAILABLE", "Verified sensor ingress unavailable"
            )
        not_future(body.worn_at)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                selected = None
                if body.session_id:
                    selected = await self.require_session(repo, actor, body.session_id, True)
                    if (
                        selected["status"] != "ENDED"
                        or selected["final_outfit_id"] != body.outfit_id
                    ):
                        raise ApiError(
                            409, "SESSION_NOT_FINAL", "Ended session final outfit required"
                        )
                    prior = await repo.one(
                        "SELECT id FROM wardrobe.wear_event WHERE session_id=:s", s=body.session_id
                    )
                    if prior:
                        raise ApiError(409, "CONFLICT", "Session wear already recorded")
                outfit = await self.outfit_dto(
                    repo, actor, await self.require_outfit(repo, actor, body.outfit_id, True)
                )
                if not body.session_id:
                    prior = await repo.one(
                        "SELECT id FROM wardrobe.wear_event WHERE member_id=:m "
                        "AND outfit_id=:o AND worn_at=:at AND cancelled_at IS NULL",
                        m=actor.member_id,
                        o=body.outfit_id,
                        at=body.worn_at,
                    )
                    if prior:
                        raise ApiError(409, "CONFLICT", "Wear already recorded at this time")
                if outfit.status == "ARCHIVED":
                    raise ApiError(409, "OUTFIT_UNAVAILABLE", "Outfit archived")
                await self.validate_items(repo, actor, outfit.items, "SAVED")
                items = (
                    selected["final_items_snapshot"]
                    if selected
                    else [i.model_dump(mode="json") for i in outfit.items]
                )
                if selected and items != [i.model_dump(mode="json") for i in outfit.items]:
                    raise ApiError(409, "INPUT_CHANGED", "Final outfit snapshot changed")
                context_id = body.context_snapshot_id or (
                    selected["context_snapshot_id"] if selected else None
                )
                if (
                    selected
                    and body.context_snapshot_id
                    and selected["context_snapshot_id"]
                    and context_id != selected["context_snapshot_id"]
                ):
                    raise ApiError(409, "CONTEXT_CONFLICT", "Session Context differs")
                if context_id:
                    context = await self.require_context(repo, actor, context_id)
                    if context["captured_at"] > body.worn_at:
                        raise ApiError(422, "TIME_MISMATCH", "Context is later than wear")
                identity = uuid4()
                await repo.execute(
                    (
                        "INSERT INTO "
                        "wardrobe.wear_event(id,member_id,outfit_id,session_id,context_snapshot_id,worn_at,confirmation_method,confirmation_ref,items_snapshot)"
                        " VALUES (:id,:m,:o,:s,:ctx,:at,'USER',:ref,CAST(:items AS jsonb))"
                    ),
                    id=identity,
                    m=actor.member_id,
                    o=body.outfit_id,
                    s=body.session_id,
                    ctx=context_id,
                    at=body.worn_at,
                    ref=str(key),
                    items=canonical(items),
                )
                await self.event(
                    repo,
                    actor,
                    "OutfitWearConfirmed",
                    "wear_event",
                    identity,
                    dict(
                        outfit_id=str(body.outfit_id),
                        items_snapshot=items,
                        context_snapshot_id=str(context_id) if context_id else None,
                    ),
                )
                return self.wear_dto(
                    await repo.one("SELECT * FROM wardrobe.wear_event WHERE id=:id", id=identity)
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "wear_confirm",
                key,
                body.model_dump(mode="json"),
                201,
                create,
            )

    async def wear_cancel(self, actor, identity, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def cancel():
                row = await repo.one(
                    ("SELECT * FROM wardrobe.wear_event WHERE id=:id AND member_id=:m FOR UPDATE"),
                    id=identity,
                    m=actor.member_id,
                )
                if row is None:
                    raise ApiError(404, "NOT_FOUND", "Wear record not found")
                check_version(row, body.expected_version)
                if row["cancelled_at"]:
                    raise ApiError(409, "CONFLICT", "Wear already cancelled")
                if not body.reason.strip():
                    raise ApiError(422, "VALIDATION_ERROR", "Reason required")
                await repo.execute(
                    (
                        "UPDATE wardrobe.wear_event SET "
                        "cancelled_at=now(),version=version+1 WHERE id=:id"
                    ),
                    id=identity,
                )
                await self.event(
                    repo,
                    actor,
                    "OutfitWearCancelled",
                    "wear_event",
                    identity,
                    dict(reason=body.reason),
                )
                return self.wear_dto(
                    await repo.one("SELECT * FROM wardrobe.wear_event WHERE id=:id", id=identity)
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "wear_cancel",
                key,
                dict(id=str(identity), **body.model_dump(mode="json")),
                201,
                cancel,
            )

    async def care_guide_dto(self, repo, actor, garment_id):
        garment = await self.require_garment(repo, actor, garment_id)
        profile = await repo.one(
            "SELECT * FROM wardrobe.care_profile WHERE garment_id=:g", g=garment_id
        )
        label = garment["care_label"] if isinstance(garment["care_label"], str) else None
        raw = profile["care_constraints"] if profile else {}
        constraints = raw.get("constraints", {})
        constraints = {k: v for k, v in constraints.items() if k in CareConstraints.model_fields}
        warnings = ["Verify the physical care label before treatment."]
        prohibited = label_constraints(label)
        if any(constraints.get(k) is True for k in prohibited):
            warnings.append("Label/profile conflict: the label prohibition takes precedence.")
        if label:
            if any(
                value is not None and name not in prohibited for name, value in constraints.items()
            ):
                warnings.append("Profile settings are unverified against the label; verify them.")
            # Unparsed label instructions must not be overridden by user temperatures/settings.
            constraints = {}
        constraints.update(prohibited)
        if not label:
            warnings.append("Care label unavailable; material alone does not confirm treatment.")
        instructions = (
            [label]
            if label
            else raw.get("instructions")
            or [
                "Check the manufacturer label; do not choose washing or drying settings "
                "from material alone."
            ]
        )
        return CareGuide(
            garment_id=garment_id,
            care_group=profile["care_group"] or "UNCLASSIFIED" if profile else "UNCLASSIFIED",
            special_care=profile["special_care"] if profile else False,
            instructions=instructions,
            constraints=CareConstraints(**constraints),
            source="LABEL" if label else "USER_PROFILE" if profile else "GENERAL",
            warnings=warnings,
            confidence="REVIEW_REQUIRED" if not label or len(warnings) > 1 else "LABEL_PROVIDED",
            profile_version=profile["version"] if profile else 0,
        )

    async def care_guide(self, actor, identity):
        async with self.sessions.begin() as session:
            return await self.care_guide_dto(Sprint1Repository(session), actor, identity)

    async def care_profile_update(self, actor, identity, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def update():
                await self.require_garment(repo, actor, identity, True)
                prior = await repo.one(
                    "SELECT * FROM wardrobe.care_profile WHERE garment_id=:g FOR UPDATE", g=identity
                )
                if (prior["version"] if prior else 0) != body.expected_version:
                    raise ApiError(409, "CONFLICT", "Care profile version changed")
                if not body.care_group.strip():
                    raise ApiError(422, "VALIDATION_ERROR", "Care group required")
                payload = canonical(
                    dict(
                        instructions=body.instructions,
                        constraints=body.constraints.model_dump(mode="json"),
                    )
                )
                await repo.execute(
                    (
                        "INSERT INTO "
                        "wardrobe.care_profile(garment_id,special_care,care_group,care_constraints)"
                        " VALUES (:g,:s,:group,CAST(:p AS jsonb)) ON CONFLICT(garment_id) "
                        "DO UPDATE SET "
                        "special_care=EXCLUDED.special_care,care_group=EXCLUDED.care_group,care_constraints=EXCLUDED.care_constraints,updated_at=now(),version=care_profile.version+1"
                    ),
                    g=identity,
                    s=body.special_care,
                    group=body.care_group,
                    p=payload,
                )
                await self.event(
                    repo,
                    actor,
                    "CareProfileUpdated",
                    "garment",
                    identity,
                    dict(version=body.expected_version + 1),
                )
                return (await self.care_guide_dto(repo, actor, identity)).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "care_profile",
                key,
                dict(id=str(identity), **body.model_dump(mode="json")),
                200,
                update,
            )

    async def require_schedule(self, repo, actor, identity, lock=False):
        # Read ID first, then garment before schedule lock to match all schedule commands.
        row = await repo.one(
            (
                "SELECT c.* FROM wardrobe.care_schedule c JOIN wardrobe.garment g "
                "ON g.id=c.garment_id WHERE c.id=:id AND g.owner_id=:m AND "
                "g.household_id=:h AND g.retired_at IS NULL"
            ),
            id=identity,
            m=actor.member_id,
            h=actor.household_id,
        )
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Care schedule not found")
        await self.require_garment(repo, actor, row["garment_id"], lock)
        if lock:
            row = await repo.one(
                "SELECT * FROM wardrobe.care_schedule WHERE id=:id FOR UPDATE", id=identity
            )
        return row

    async def schedule_dto(self, repo, row, event_id=None):
        status = row["status"]
        if status == "SCHEDULED" and row["scheduled_at"] < utc_now():
            status = "OVERDUE"
        next_due = None
        if row["next_schedule_id"]:
            next_row = await repo.one(
                "SELECT scheduled_at,status FROM wardrobe.care_schedule WHERE id=:id",
                id=row["next_schedule_id"],
            )
            if next_row and next_row["status"] != "CANCELLED":
                next_due = next_row["scheduled_at"]
        if event_id is None:
            event = await repo.one(
                (
                    "SELECT id FROM wardrobe.care_event WHERE schedule_id=:s AND "
                    "outcome='SUCCESS' AND cancelled_at IS NULL"
                ),
                s=row["id"],
            )
            event_id = event["id"] if event else None
        return CareSchedule(
            **{
                k: row[k]
                for k in (
                    "id",
                    "garment_id",
                    "scheduled_at",
                    "care_type",
                    "notes",
                    "version",
                    "recurrence_days",
                    "completed_at",
                    "next_schedule_id",
                )
            },
            status=status,
            timezone=row["recurrence_timezone"],
            care_event_id=event_id,
            next_due_at=next_due,
        )

    async def schedule_create(self, actor, body, key):
        timezone_for(body.timezone)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                await self.require_garment(repo, actor, body.garment_id, True)
                await self.schedule_slot(repo, body.garment_id, body.care_type, body.scheduled_at)
                identity = uuid4()
                await self.insert_schedule(
                    repo,
                    actor,
                    identity,
                    body.garment_id,
                    body.scheduled_at,
                    body.care_type,
                    body.notes,
                    body.recurrence_days,
                    body.timezone,
                )
                await self.event(
                    repo,
                    actor,
                    "CareScheduled",
                    "care_schedule",
                    identity,
                    body.model_dump(mode="json"),
                )
                return (
                    await self.schedule_dto(
                        repo, await self.require_schedule(repo, actor, identity)
                    )
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "care_schedule_create",
                key,
                body.model_dump(mode="json"),
                201,
                create,
            )

    async def schedule_slot(self, repo, garment, care_type, at, exclude=None):
        duplicate = await repo.one(
            (
                "SELECT id FROM wardrobe.care_schedule WHERE garment_id=:g AND "
                "care_type=:t AND scheduled_at=:at AND status='SCHEDULED' AND "
                "(CAST(:exclude AS uuid) IS NULL OR id<>CAST(:exclude AS uuid))"
            ),
            g=garment,
            t=care_type,
            at=at,
            exclude=str(exclude) if exclude else None,
        )
        if duplicate:
            raise ApiError(409, "CONFLICT", "Duplicate active care schedule")

    async def insert_schedule(
        self, repo, actor, identity, garment, at, care_type, notes, days, timezone
    ):
        await repo.execute(
            (
                "INSERT INTO "
                "wardrobe.care_schedule(id,garment_id,scheduled_at,care_type,notes,created_by,recurrence_days,recurrence_timezone)"
                " VALUES (:id,:g,:at,:t,:n,:m,:days,:tz)"
            ),
            id=identity,
            g=garment,
            at=at,
            t=care_type,
            n=notes,
            m=actor.member_id,
            days=days,
            tz=timezone,
        )

    async def schedule_update(self, actor, identity, body, key):
        timezone_for(body.timezone)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def update():
                row = await self.require_schedule(repo, actor, identity, True)
                check_version(row, body.expected_version)
                if row["status"] != "SCHEDULED":
                    raise ApiError(409, "CONFLICT", "Only scheduled care can be edited")
                if body.status == "SCHEDULED":
                    await self.schedule_slot(
                        repo, row["garment_id"], body.care_type, body.scheduled_at, identity
                    )
                await repo.execute(
                    (
                        "UPDATE wardrobe.care_schedule SET "
                        "scheduled_at=:at,care_type=:t,status=CAST(:s AS "
                        "wardrobe.care_schedule_status),notes=:n,recurrence_days=:d,recurrence_timezone=:tz,version=version+1,updated_at=now()"
                        " WHERE id=:id"
                    ),
                    id=identity,
                    at=body.scheduled_at,
                    t=body.care_type,
                    s=body.status,
                    n=body.notes,
                    d=body.recurrence_days,
                    tz=body.timezone,
                )
                await self.event(
                    repo,
                    actor,
                    "CareScheduleUpdated",
                    "care_schedule",
                    identity,
                    body.model_dump(mode="json"),
                )
                return (
                    await self.schedule_dto(
                        repo, await self.require_schedule(repo, actor, identity)
                    )
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "care_schedule_update",
                key,
                dict(id=str(identity), **body.model_dump(mode="json")),
                200,
                update,
            )

    async def schedule_complete(self, actor, identity, body, key):
        not_future(body.completed_at)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def complete():
                row = await self.require_schedule(repo, actor, identity, True)
                check_version(row, body.expected_version)
                if row["status"] != "SCHEDULED":
                    raise ApiError(409, "CONFLICT", "Care is not scheduled")
                if body.completed_at < row["created_at"]:
                    raise ApiError(422, "TIME_MISMATCH", "Completion precedes schedule creation")
                event_id = uuid4()
                next_id = None
                await repo.execute(
                    (
                        "INSERT INTO "
                        "wardrobe.care_event(id,garment_id,schedule_id,performed_by,care_type,performed_at,outcome,details)"
                        " VALUES (:id,:g,:s,:m,:t,:at,:outcome,CAST(:p AS jsonb))"
                    ),
                    id=event_id,
                    g=row["garment_id"],
                    s=identity,
                    m=actor.member_id,
                    t=row["care_type"],
                    at=body.completed_at,
                    outcome=body.outcome,
                    p=canonical(dict(notes=body.notes)),
                )
                if body.outcome == "SUCCESS" and row["recurrence_days"]:
                    due = next_recurrence(
                        row["scheduled_at"],
                        body.completed_at,
                        row["recurrence_days"],
                        row["recurrence_timezone"],
                    )
                    await self.schedule_slot(repo, row["garment_id"], row["care_type"], due)
                    next_id = uuid4()
                    await self.insert_schedule(
                        repo,
                        actor,
                        next_id,
                        row["garment_id"],
                        due,
                        row["care_type"],
                        row["notes"],
                        row["recurrence_days"],
                        row["recurrence_timezone"],
                    )
                    await self.event(
                        repo,
                        actor,
                        "CareScheduled",
                        "care_schedule",
                        next_id,
                        dict(previous_schedule_id=str(identity)),
                    )
                await repo.execute(
                    (
                        "UPDATE wardrobe.care_schedule SET status=CAST(:s AS "
                        "wardrobe.care_schedule_status),completed_at=:at,next_schedule_id=:next,version=version+1,updated_at=now()"
                        " WHERE id=:id"
                    ),
                    id=identity,
                    s="COMPLETED" if body.outcome == "SUCCESS" else "SCHEDULED",
                    at=body.completed_at if body.outcome == "SUCCESS" else None,
                    next=next_id,
                )
                await self.event(
                    repo,
                    actor,
                    "CareCompleted" if body.outcome == "SUCCESS" else "CareNotDone",
                    "care_schedule",
                    identity,
                    dict(care_event_id=str(event_id), outcome=body.outcome),
                )
                return (
                    await self.schedule_dto(
                        repo, await self.require_schedule(repo, actor, identity), event_id
                    )
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "care_complete",
                key,
                dict(id=str(identity), **body.model_dump(mode="json")),
                201,
                complete,
            )

    async def completion_cancel(self, actor, identity, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def cancel():
                row = await self.require_schedule(repo, actor, identity, True)
                check_version(row, body.expected_version)
                if row["status"] != "COMPLETED":
                    raise ApiError(409, "CONFLICT", "Completed care required")
                if not body.reason.strip():
                    raise ApiError(422, "VALIDATION_ERROR", "Reason required")
                if row["next_schedule_id"]:
                    next_row = await self.require_schedule(
                        repo, actor, row["next_schedule_id"], True
                    )
                    if next_row["status"] == "COMPLETED":
                        raise ApiError(409, "CONFLICT", "Next care occurrence already completed")
                    await repo.execute(
                        (
                            "UPDATE wardrobe.care_schedule SET "
                            "status='CANCELLED',version=version+1,updated_at=now() WHERE "
                            "id=:id"
                        ),
                        id=next_row["id"],
                    )
                    await self.event(
                        repo,
                        actor,
                        "CareScheduleCancelled",
                        "care_schedule",
                        next_row["id"],
                        dict(reason="Previous completion cancelled"),
                    )
                await repo.execute(
                    (
                        "UPDATE wardrobe.care_event SET cancelled_at=now(),details=details"
                        " || CAST(:p AS jsonb) WHERE schedule_id=:id AND outcome='SUCCESS'"
                        " AND cancelled_at IS NULL"
                    ),
                    id=identity,
                    p=canonical(dict(cancellation_reason=body.reason)),
                )
                await repo.execute(
                    (
                        "UPDATE wardrobe.care_schedule SET "
                        "status='CANCELLED',version=version+1,updated_at=now() WHERE "
                        "id=:id"
                    ),
                    id=identity,
                )
                await self.event(
                    repo,
                    actor,
                    "CareCompletionCancelled",
                    "care_schedule",
                    identity,
                    dict(reason=body.reason),
                )
                return (
                    await self.schedule_dto(
                        repo, await self.require_schedule(repo, actor, identity)
                    )
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "care_completion_cancel",
                key,
                dict(id=str(identity), **body.model_dump(mode="json")),
                201,
                cancel,
            )

    async def schedule_list(self, actor, member, start, end, timezone, limit, offset):
        require_self(actor, member or actor.member_id)
        since, until, _ = date_window(start, end, timezone, utc_now())
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            where = (
                " FROM wardrobe.care_schedule c JOIN wardrobe.garment g ON "
                "g.id=c.garment_id WHERE g.owner_id=:m AND g.household_id=:h AND "
                "g.retired_at IS NULL AND c.scheduled_at>=:since AND "
                "c.scheduled_at<:until"
            )
            params = dict(m=actor.member_id, h=actor.household_id, since=since, until=until)
            await repo.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            total = await repo.one("SELECT count(*) AS n" + where, **params)
            rows = await repo.all(
                "SELECT c.*" + where + " ORDER BY c.scheduled_at,c.id LIMIT :l OFFSET :o",
                **params,
                l=limit,
                o=offset,
            )
            return CareScheduleList(
                items=[await self.schedule_dto(repo, row) for row in rows],
                page=Page(limit=limit, offset=offset, total=total["n"]),
            )

    async def history(self, actor, member, start, end, timezone, kind, limit, offset):
        require_self(actor, member or actor.member_id)
        since, until, zone = date_window(start, end, timezone, utc_now())
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await repo.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            sql = (
                "WITH records AS (\n SELECT id,'WEAR' AS kind,worn_at AS "
                "occurred_at,outfit_id,NULL::uuid AS "
                "garment_id,session_id,context_snapshot_id,items_snapshot,\n CASE "
                "WHEN cancelled_at IS NULL THEN 'CONFIRMED' ELSE 'CANCELLED' END "
                "AS status,'Explicit wear confirmation' AS description\n FROM "
                "wardrobe.wear_event WHERE member_id=:m\n UNION ALL\n SELECT "
                "e.id,'CARE',e.performed_at,NULL,e.garment_id,NULL,NULL,NULL,\n "
                "CASE WHEN e.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN "
                "e.outcome='NOT_DONE' THEN 'NOT_DONE' ELSE 'COMPLETED' END,'User "
                "recorded care'\n FROM wardrobe.care_event e JOIN wardrobe.garment "
                "g ON g.id=e.garment_id WHERE g.owner_id=:m AND g.household_id=:h "
                "AND e.performed_by=:m\n UNION ALL\n SELECT "
                "id,'OUTFIT_SELECTION',ended_at,final_outfit_id,NULL,id,context_snapshot_id,final_items_snapshot,'SELECTED','Final"
                " outfit selection; wear unconfirmed'\n FROM "
                "wardrobe.outfit_session WHERE member_id=:m AND status='ENDED'\n ) "
                "SELECT * FROM records WHERE occurred_at>=:since AND "
                "occurred_at<:until AND (CAST(:kind AS text) IS NULL OR "
                "kind=:kind)"
            )
            params = dict(
                m=actor.member_id, h=actor.household_id, since=since, until=until, kind=kind
            )
            total = await repo.one("SELECT count(*) AS n FROM (" + sql + ") AS filtered", **params)
            rows = await repo.all(
                sql + " ORDER BY occurred_at DESC,id DESC LIMIT :l OFFSET :o",
                **params,
                l=limit,
                o=offset,
            )
            return HistoryItemList(
                items=[
                    HistoryItem(**row, local_date=row["occurred_at"].astimezone(zone).date())
                    for row in rows
                ],
                page=Page(limit=limit, offset=offset, total=total["n"]),
                timezone=timezone,
            )
