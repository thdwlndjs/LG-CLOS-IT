from datetime import timedelta
from uuid import UUID, uuid4

from app.application.common.authorization import require_self
from app.application.common.idempotency import canonical, idempotent
from app.application.sprint5 import Sprint5, check_version
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.domain.storage import placement_errors, target_errors, units
from app.infrastructure.db.sprint1_repository import READ_PERMISSION, Sprint1Repository
from app.schemas.sprint1 import Page
from app.schemas.sprint3 import AcceptedJob, Job
from app.schemas.sprint6 import StorageAction, StorageActionItem, StorageActionList


def action_metadata(row):
    data = row["reasoning"]
    return (
        data[0]
        if isinstance(data, list)
        and data
        and isinstance(data[0], dict)
        and data[0].get("rules_version")
        else None
    )


async def load_storage(repo, actor, ids, now, *, read_device=False):
    locations = [
        dict(r)
        for r in await repo.all(
            ("SELECT * FROM wardrobe.storage_location WHERE household_id=:h ORDER BY id LIMIT 101"),
            h=actor.household_id,
        )
    ]
    if len(locations) > 100:
        raise ApiError(422, "ANALYSIS_LIMIT_EXCEEDED", "Too many locations")
    garments = [
        dict(r)
        for r in await repo.all(
            (
                "SELECT "
                "g.*,s.location_id,s.status::text,s.location_confidence,s.last_seen_at,s.version"
                " AS state_version,coalesce(p.version,0) AS "
                "profile_version,coalesce(p.care_constraints,'{}'::jsonb) AS "
                "care_constraints FROM wardrobe.garment g LEFT JOIN "
                "wardrobe.garment_state s ON s.garment_id=g.id LEFT JOIN "
                "wardrobe.care_profile p ON p.garment_id=g.id WHERE "
                f"g.household_id=:h AND ((NOT :read_device AND g.owner_id=:m) OR "
                f"(:read_device AND {READ_PERMISSION})) AND g.retired_at IS NULL AND "
                "(CAST(:ids AS uuid[]) IS NULL OR g.id=ANY(CAST(:ids AS uuid[]))) "
                "ORDER BY g.id LIMIT 101"
            ),
            h=actor.household_id,
            m=actor.member_id,
            read_device=read_device,
            device_scope=actor.personal_account,
            household=actor.household_id,
            owner=actor.member_id,
            ids=ids or None,
        )
    ]
    if len(garments) > 100:
        raise ApiError(422, "ANALYSIS_LIMIT_EXCEEDED", "Too many target garments")
    if ids and set(ids) != {g["id"] for g in garments}:
        raise ApiError(404, "NOT_FOUND", "Target garment not found")
    occupancy = {r["id"]: 0 for r in locations}
    occupants = await repo.all(
        (
            "SELECT s.location_id,g.attributes,g.household_id FROM "
            "wardrobe.garment_state s JOIN wardrobe.garment g ON "
            "g.id=s.garment_id JOIN wardrobe.storage_location l ON "
            "l.id=s.location_id WHERE l.household_id=:h LIMIT 10001"
        ),
        h=actor.household_id,
    )
    if len(occupants) > 10000:
        raise ApiError(422, "ANALYSIS_LIMIT_EXCEEDED", "Too many stored garments")
    for item in occupants:
        loc = item["location_id"]
        try:
            size = units(item)
            if item["household_id"] != actor.household_id:
                raise ValueError("CROSS_HOUSEHOLD_STATE")
            if occupancy[loc] is not None:
                occupancy[loc] += size
        except ValueError:
            occupancy[loc] = None
    reserved = await repo.all(
        (
            "SELECT i.*,a.reasoning FROM wardrobe.storage_action_item i JOIN "
            "wardrobe.storage_action a ON a.id=i.action_id WHERE "
            "a.household_id=:h AND a.status IN "
            "('APPROVED','IN_PROGRESS','AWAITING_CONFIRMATION') AND "
            "(a.expires_at IS NULL OR a.expires_at>:now) AND i.status IN "
            "('PENDING','IN_PROGRESS','AWAITING_CONFIRMATION')"
        ),
        h=actor.household_id,
        now=now,
    )
    for item in reserved:
        loc = item["destination_location_id"]
        if loc not in occupancy:
            continue
        metadata = action_metadata(item)
        info = metadata.get("items", {}).get(str(item["garment_id"])) if metadata else None
        if info is None:
            occupancy[loc] = None
        elif occupancy[loc] is not None:
            occupancy[loc] += info["storage_units"]
    environments = {}
    for row in await repo.all(
        (
            "SELECT DISTINCT ON(e.location_id) e.* FROM "
            "wardrobe.environment_reading e JOIN wardrobe.storage_location l "
            "ON l.id=e.location_id WHERE l.household_id=:h AND "
            "e.measured_at<=:now ORDER BY e.location_id,e.measured_at "
            "DESC,e.id DESC"
        ),
        h=actor.household_id,
        now=now,
    ):
        environments[row["location_id"]] = {
            **dict(row),
            "temperature_c": float(row["temperature_c"])
            if row["temperature_c"] is not None
            else None,
            "humidity_pct": float(row["humidity_pct"]) if row["humidity_pct"] is not None else None,
        }
    return garments, locations, occupancy, environments


async def wear_counts(repo, actor, now, days):
    rows = await repo.all(
        (
            "SELECT item->>'garment_id' AS garment_id,count(*) AS n FROM "
            "wardrobe.wear_event w CROSS JOIN LATERAL "
            "jsonb_array_elements(w.items_snapshot) item WHERE w.member_id=:m "
            "AND w.cancelled_at IS NULL AND w.worn_at BETWEEN :since AND :now "
            "AND w.confirmed_at<=:now GROUP BY item->>'garment_id'"
        ),
        m=actor.member_id,
        since=now - timedelta(days=days),
        now=now,
    )
    result = {UUID(r["garment_id"]): r["n"] for r in rows}
    legacy = await repo.all(
        (
            "SELECT i.garment_id,count(*) AS n FROM wardrobe.wear_event w JOIN"
            " wardrobe.outfit o ON o.id=w.outfit_id JOIN wardrobe.outfit_item "
            "i ON i.outfit_id=w.outfit_id WHERE w.member_id=:m AND "
            "w.cancelled_at IS NULL AND w.items_snapshot IS NULL AND "
            "w.confirmed_at<=:now AND w.worn_at BETWEEN :since AND :now AND "
            "o.updated_at<=w.worn_at GROUP BY i.garment_id"
        ),
        m=actor.member_id,
        since=now - timedelta(days=days),
        now=now,
    )
    for r in legacy:
        result[r["garment_id"]] = result.get(r["garment_id"], 0) + r["n"]
    return result


class Sprint6(Sprint5):
    async def optimization_create(self, actor, body, key):
        require_self(actor, body.member_id)
        if body.household_id != actor.household_id:
            raise ApiError(403, "FORBIDDEN", "Household mismatch")
        if len(body.garment_ids) != len(set(body.garment_ids)):
            raise ApiError(422, "VALIDATION_ERROR", "Duplicate garment IDs")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                await repo.lock("storage-household:" + str(actor.household_id))
                await load_storage(repo, actor, body.garment_ids, utc_now(),
                                   read_device=body.dry_run and actor.personal_account)
                identity = uuid4()
                await repo.execute(
                    (
                        "INSERT INTO "
                        "wardrobe.job(id,household_id,member_id,kind,request_payload,correlation_id)"
                        " VALUES (:id,:h,:m,'STORAGE_OPTIMIZE',CAST(:p AS jsonb),:c)"
                    ),
                    id=identity,
                    h=actor.household_id,
                    m=actor.member_id,
                    p=canonical(dict(input=body.model_dump(mode="json"),
                                     personal_account=actor.personal_account)),
                    c=actor.correlation_id,
                )
                await self.event(
                    repo,
                    actor,
                    "StorageOptimizationRequested",
                    "job",
                    identity,
                    body.model_dump(mode="json"),
                )
                return AcceptedJob(
                    job_id=identity, status="QUEUED", status_url=f"/api/v1/jobs/{identity}"
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "storage_optimize",
                key,
                body.model_dump(mode="json"),
                202,
                create,
            )

    async def require_action(self, repo, actor, identity, lock=False):
        row = await repo.one(
            (
                "SELECT * FROM wardrobe.storage_action WHERE id=:id AND "
                "household_id=:h AND requested_by=:m"
            )
            + (" FOR UPDATE" if lock else ""),
            id=identity,
            h=actor.household_id,
            m=actor.member_id,
        )
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Storage action not found")
        return row

    async def action_dto(self, repo, row):
        metadata = action_metadata(row)
        status = row["status"]
        if (
            status in ("PROPOSED", "APPROVED", "IN_PROGRESS", "AWAITING_CONFIRMATION")
            and row["expires_at"]
            and row["expires_at"] <= utc_now()
        ):
            status = "EXPIRED"
        items = []
        for item in await repo.all(
            ("SELECT * FROM wardrobe.storage_action_item WHERE action_id=:id ORDER BY garment_id"),
            id=row["id"],
        ):
            info = metadata.get("items", {}).get(str(item["garment_id"]), {}) if metadata else {}
            items.append(
                StorageActionItem(
                    **{
                        name: item[name]
                        for name in (
                            "id",
                            "garment_id",
                            "source_location_id",
                            "destination_location_id",
                            "status",
                            "confirmed_at",
                            "confirmation_method",
                            "failure_reason",
                        )
                    },
                    expected_garment_version=info.get("garment_version"),
                    expected_state_version=info.get("state_version"),
                    score=info.get("score"),
                    reasons=info.get("reasons", []),
                )
            )
        return StorageAction(
            **{
                name: row[name]
                for name in (
                    "id",
                    "household_id",
                    "action_type",
                    "version",
                    "requested_by",
                    "approved_by",
                    "created_at",
                    "approved_at",
                    "completed_at",
                    "expires_at",
                )
            },
            status=status,
            items=items,
            reasoning=metadata.get("reasons", [])
            if metadata
            else [v for v in row["reasoning"] if isinstance(v, str)],
            rules_version=metadata.get("rules_version") if metadata else None,
            executable=bool(metadata)
            and status in ("PROPOSED", "APPROVED", "AWAITING_CONFIRMATION"),
        )

    async def action_get(self, actor, identity):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            return await self.action_dto(repo, await self.require_action(repo, actor, identity))

    async def action_list(self, actor, household, status, limit, offset):
        if household and household != actor.household_id:
            raise ApiError(403, "FORBIDDEN", "Household mismatch")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await repo.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            where = (
                " FROM wardrobe.storage_action WHERE household_id=:h AND "
                "requested_by=:m AND (CAST(:s AS text) IS NULL OR (CASE WHEN "
                "status IN "
                "('PROPOSED','APPROVED','IN_PROGRESS','AWAITING_CONFIRMATION') AND"
                " expires_at<=now() THEN 'EXPIRED' ELSE status::text END)=:s)"
            )
            params = dict(h=actor.household_id, m=actor.member_id, s=status)
            total = await repo.one("SELECT count(*) AS n" + where, **params)
            rows = await repo.all(
                "SELECT *" + where + " ORDER BY created_at DESC,id DESC LIMIT :l OFFSET :o",
                **params,
                l=limit,
                o=offset,
            )
            return StorageActionList(
                items=[await self.action_dto(repo, r) for r in rows],
                page=Page(limit=limit, offset=offset, total=total["n"]),
            )

    def actionable(self, row, expected):
        check_version(row, expected)
        if row["expires_at"] and row["expires_at"] <= utc_now():
            raise ApiError(409, "ACTION_EXPIRED", "Storage action expired")
        if not action_metadata(row):
            raise ApiError(409, "LEGACY_PLAN_UNAVAILABLE", "Storage snapshot unavailable")

    async def validate_plan_items(self, repo, actor, row, items, include_new_capacity=False):
        metadata = action_metadata(row)
        garments, locations, occupancy, environments = await load_storage(
            repo, actor, [i["garment_id"] for i in items], utc_now()
        )
        current = {g["id"]: g for g in garments}
        spaces = {location["id"]: location for location in locations}
        for item in items:
            g = current[item["garment_id"]]
            info = metadata["items"].get(str(g["id"]))
            if (
                not info
                or g["version"] != info["garment_version"]
                or g["state_version"] != info["state_version"]
                or g["profile_version"] != info["profile_version"]
                or str(g["location_id"]) != info["source_location_id"]
                or target_errors(g, utc_now())
            ):
                raise ApiError(409, "INPUT_CHANGED", "Storage input changed; analyze again")
            space = spaces.get(item["destination_location_id"])
            if not space:
                raise ApiError(409, "INPUT_CHANGED", "Destination unavailable")
            if include_new_capacity and occupancy[space["id"]] is not None:
                occupancy[space["id"]] += units(g)
            errors = placement_errors(
                g,
                space,
                occupancy[space["id"]],
                environments.get(space["id"]),
                utc_now(),
                metadata["mode"],
            )
            if errors:
                raise ApiError(
                    409,
                    "STORAGE_CONSTRAINT_CHANGED",
                    "Storage hard constraint changed: " + ",".join(errors),
                )
        return current

    async def action_decision(self, actor, identity, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def decide():
                await repo.lock("storage-household:" + str(actor.household_id))
                row = await self.require_action(repo, actor, identity, True)
                self.actionable(row, body.expected_version)
                items = await repo.all(
                    (
                        "SELECT * FROM wardrobe.storage_action_item WHERE action_id=:id "
                        "ORDER BY garment_id"
                    ),
                    id=identity,
                )
                if body.decision == "CANCEL":
                    if row["status"] not in ("PROPOSED", "APPROVED", "AWAITING_CONFIRMATION"):
                        raise ApiError(409, "CONFLICT", "Action terminal")
                    status = "CANCELLED"
                    item_status = "SKIPPED"
                else:
                    if row["status"] != "PROPOSED":
                        raise ApiError(409, "CONFLICT", "Action already decided")
                    if body.decision == "APPROVE":
                        await self.validate_plan_items(repo, actor, row, items, True)
                    status = "APPROVED" if body.decision == "APPROVE" else "REJECTED"
                    item_status = (
                        "AWAITING_CONFIRMATION" if body.decision == "APPROVE" else "SKIPPED"
                    )
                await repo.execute(
                    (
                        "UPDATE wardrobe.storage_action SET status=CAST(:s AS "
                        "wardrobe.storage_action_status),version=version+1,approved_by=:m,approved_at=:at,updated_at=now()"
                        " WHERE id=:id"
                    ),
                    id=identity,
                    s=status,
                    m=actor.member_id if status == "APPROVED" else row["approved_by"],
                    at=utc_now() if status == "APPROVED" else row["approved_at"],
                )
                await repo.execute(
                    (
                        "UPDATE wardrobe.storage_action_item SET status=CAST(:s AS "
                        "wardrobe.storage_item_status) WHERE action_id=:id AND status IN "
                        "('PENDING','IN_PROGRESS','AWAITING_CONFIRMATION')"
                    ),
                    id=identity,
                    s=item_status,
                )
                await self.event(
                    repo,
                    actor,
                    "StorageAction" + status.title(),
                    "storage_action",
                    identity,
                    dict(decision=body.decision),
                )
                return (
                    await self.action_dto(repo, await self.require_action(repo, actor, identity))
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "storage_decision",
                key,
                dict(id=str(identity), **body.model_dump(mode="json")),
                201,
                decide,
            )

    async def action_confirm(self, actor, identity, body, key):
        if len({i.garment_id for i in body.items}) != len(body.items):
            raise ApiError(422, "VALIDATION_ERROR", "Duplicate confirmation items")
        if any(i.confirmation_method != "USER" for i in body.items):
            raise ApiError(
                503,
                "SENSOR_VERIFICATION_UNAVAILABLE",
                "Verified storage sensor ingress unavailable",
            )
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def confirm():
                await repo.lock("storage-household:" + str(actor.household_id))
                row = await self.require_action(repo, actor, identity, True)
                self.actionable(row, body.expected_version)
                if row["status"] not in ("APPROVED", "AWAITING_CONFIRMATION"):
                    raise ApiError(409, "CONFLICT", "Approved storage action required")
                items = {
                    i["garment_id"]: i
                    for i in await repo.all(
                        "SELECT * FROM wardrobe.storage_action_item WHERE action_id=:id",
                        id=identity,
                    )
                }
                subset = []
                for result in body.items:
                    item = items.get(result.garment_id)
                    if not item or item["status"] not in ("PENDING", "AWAITING_CONFIRMATION"):
                        raise ApiError(409, "CONFLICT", "Item already terminal or not in action")
                    if result.confirmed:
                        if result.observed_location_id != item["destination_location_id"]:
                            raise ApiError(
                                409,
                                "OBSERVATION_MISMATCH",
                                "Observed location differs from destination",
                            )
                        if (
                            result.observed_at is None
                            or result.observed_at > utc_now()
                            or result.observed_at < row["approved_at"]
                        ):
                            raise ApiError(
                                422,
                                "TIME_MISMATCH",
                                "Actual observation after approval and before now required",
                            )
                        subset.append(item)
                    elif not result.failure_reason or not result.failure_reason.strip():
                        raise ApiError(422, "VALIDATION_ERROR", "Failure reason required")
                current = await self.validate_plan_items(repo, actor, row, subset) if subset else {}
                for result in body.items:
                    item = items[result.garment_id]
                    if result.confirmed:
                        g = current[result.garment_id]
                        if g["last_seen_at"] and result.observed_at < g["last_seen_at"]:
                            raise ApiError(
                                409, "INPUT_CHANGED", "Observation is older than current location"
                            )
                        await repo.execute(
                            (
                                "UPDATE wardrobe.garment_state SET "
                                "location_id=:l,location_confidence=1,last_seen_at=:at,version=version+1,updated_at=now()"
                                " WHERE garment_id=:g"
                            ),
                            g=result.garment_id,
                            l=result.observed_location_id,
                            at=result.observed_at,
                        )
                        await repo.execute(
                            (
                                "UPDATE wardrobe.garment SET version=version+1,updated_at=now() "
                                "WHERE id=:g"
                            ),
                            g=result.garment_id,
                        )
                        await repo.execute(
                            (
                                "INSERT INTO "
                                "wardrobe.garment_observation(garment_id,location_id,sensor_type,confidence,observed_at,sensor_id,raw_payload)"
                                " VALUES (:g,:l,'MANUAL',1,:at,:source,CAST(:p AS jsonb))"
                            ),
                            g=result.garment_id,
                            l=result.observed_location_id,
                            at=result.observed_at,
                            source="storage-action:" + str(identity),
                            p=canonical(
                                dict(
                                    action_id=str(identity),
                                    item_id=str(item["id"]),
                                    confirmation_method="USER",
                                )
                            ),
                        )
                        await self.event(
                            repo,
                            actor,
                            "StorageMovementConfirmed",
                            "garment",
                            result.garment_id,
                            dict(
                                action_id=str(identity),
                                location_id=str(result.observed_location_id),
                            ),
                        )
                    await repo.execute(
                        (
                            "UPDATE wardrobe.storage_action_item SET status=CAST(:s AS "
                            "wardrobe.storage_item_status),confirmed_at=:at,confirmation_method=:method,failure_reason=:reason"
                            " WHERE id=:id"
                        ),
                        id=item["id"],
                        s="COMPLETED" if result.confirmed else "FAILED",
                        at=result.observed_at if result.confirmed else None,
                        method="USER",
                        reason=None if result.confirmed else result.failure_reason,
                    )
                states = [
                    i["status"]
                    for i in await repo.all(
                        (
                            "SELECT status::text FROM wardrobe.storage_action_item WHERE "
                            "action_id=:id"
                        ),
                        id=identity,
                    )
                ]
                pending = any(
                    s in ("PENDING", "IN_PROGRESS", "AWAITING_CONFIRMATION") for s in states
                )
                status = (
                    "AWAITING_CONFIRMATION"
                    if pending
                    else "COMPLETED"
                    if all(s == "COMPLETED" for s in states)
                    else "FAILED"
                )
                await repo.execute(
                    (
                        "UPDATE wardrobe.storage_action SET status=CAST(:s AS "
                        "wardrobe.storage_action_status),version=version+1,completed_at=:at,updated_at=now()"
                        " WHERE id=:id"
                    ),
                    id=identity,
                    s=status,
                    at=utc_now() if not pending else None,
                )
                await self.event(
                    repo,
                    actor,
                    "StorageActionConfirmed",
                    "storage_action",
                    identity,
                    dict(status=status),
                )
                return (
                    await self.action_dto(repo, await self.require_action(repo, actor, identity))
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "storage_confirm",
                key,
                dict(id=str(identity), **body.model_dump(mode="json")),
                201,
                confirm,
            )

    def storage_job_dto(self, row):
        return Job(
            id=row["id"],
            kind="STORAGE_OPTIMIZATION",
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            progress_pct=row["progress_pct"],
            attempt_count=row["attempt_count"],
            storage_result=row["request_payload"].get("result")
            if row["status"] == "SUCCEEDED"
            else None,
            error=dict(
                code=row["error_code"],
                message="Storage analysis failed",
                request_id=row["correlation_id"] or str(row["id"]),
                details={},
            )
            if row["error_code"]
            else None,
        )

    async def job_get(self, actor, identity):
        async with self.sessions.begin() as session:
            row = await Sprint1Repository(session).one(
                (
                    "SELECT * FROM wardrobe.job WHERE id=:id AND household_id=:h AND "
                    "member_id=:m AND kind='STORAGE_OPTIMIZE'"
                ),
                id=identity,
                h=actor.household_id,
                m=actor.member_id,
            )
            if row:
                return self.storage_job_dto(row)
        return await super().job_get(actor, identity)

    async def job_cancel(self, actor, identity, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                (
                    "SELECT * FROM wardrobe.job WHERE id=:id AND household_id=:h AND "
                    "member_id=:m AND kind='STORAGE_OPTIMIZE'"
                ),
                id=identity,
                h=actor.household_id,
                m=actor.member_id,
            )
            if row:

                async def cancel():
                    job = await repo.one(
                        "SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=identity
                    )
                    if job["status"] not in ("QUEUED", "RUNNING"):
                        raise ApiError(409, "CONFLICT", "Job terminal")
                    await repo.execute(
                        (
                            "UPDATE wardrobe.job SET "
                            "status='CANCELLED',lease_owner=NULL,leased_until=NULL,finished_at=now(),updated_at=now()"
                            " WHERE id=:id"
                        ),
                        id=identity,
                    )
                    await self.event(
                        repo, actor, "StorageOptimizationCancelled", "job", identity, {}
                    )
                    return self.storage_job_dto(
                        await repo.one("SELECT * FROM wardrobe.job WHERE id=:id", id=identity)
                    ).model_dump(mode="json")

                return await idempotent(
                    repo,
                    actor.member_id,
                    "storage_job_cancel",
                    key,
                    dict(id=str(identity)),
                    201,
                    cancel,
                )
        return await super().job_cancel(actor, identity, key)
