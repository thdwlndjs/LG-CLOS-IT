import asyncio
import inspect
from datetime import timedelta
from uuid import UUID, uuid4

from fastapi.encoders import jsonable_encoder

from app.application.common.authorization import ActorContext
from app.application.common.idempotency import canonical
from app.application.sprint6 import load_storage, wear_counts
from app.application.vton_worker import worker_event
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.domain.storage import placement_errors, plan, target_errors, units
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint6 import StorageOptimizeRequest, StoragePlanResult


async def process_storage(settings, resources, planner=plan):
    async with resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        expired = await repo.all(
            "UPDATE wardrobe.job SET "
            "status='TIMED_OUT',error_code='WORKER_LEASE_EXPIRED',error_message_safe='Storage"
            " worker lease "
            "expired',lease_owner=NULL,leased_until=NULL,finished_at=now(),updated_at=now()"
            " WHERE kind='STORAGE_OPTIMIZE' AND status='RUNNING' AND "
            "leased_until<=now() RETURNING *"
        )
        for row in expired:
            await worker_event(
                repo, row, "StorageOptimizationFailed", dict(code="WORKER_LEASE_EXPIRED")
            )
        row = await repo.one(
            "SELECT * FROM wardrobe.job WHERE kind='STORAGE_OPTIMIZE' AND "
            "status='QUEUED' AND next_attempt_at<=now() ORDER BY created_at,id"
            " LIMIT 1 FOR UPDATE SKIP LOCKED"
        )
        if row is None:
            return 0
        row = dict(row)
        row["lease_owner"] = uuid4().hex
        row["attempt_count"] += 1
        await repo.execute(
            (
                "UPDATE wardrobe.job SET "
                "status='RUNNING',attempt_count=attempt_count+1,progress_pct=10,lease_owner=:l,leased_until=:expiry,started_at=coalesce(started_at,now()),updated_at=now(),error_code=NULL,error_message_safe=NULL"
                " WHERE id=:id"
            ),
            id=row["id"],
            l=row["lease_owner"],
            expiry=utc_now() + timedelta(seconds=30),
        )
        await worker_event(
            repo, row, "StorageOptimizationStarted", dict(attempt=row["attempt_count"])
        )
    try:
        await asyncio.wait_for(execute_storage(resources, row, planner), timeout=10)
    except Exception as error:
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            current = await repo.one(
                "SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"]
            )
            if current["status"] != "RUNNING" or current["lease_owner"] != row["lease_owner"]:
                return 1
            timeout = isinstance(error, TimeoutError)
            retry = (
                not isinstance(error, ApiError)
                and not timeout
                and row["attempt_count"] < row["max_attempts"]
            )
            status = "QUEUED" if retry else "TIMED_OUT" if timeout else "FAILED"
            code = (
                error.code
                if isinstance(error, ApiError)
                else "STORAGE_TIMEOUT"
                if timeout
                else "STORAGE_ANALYSIS_FAILED"
            )
            await repo.execute(
                (
                    "UPDATE wardrobe.job SET status=CAST(:s AS "
                    "wardrobe.job_status),error_code=:code,error_message_safe='Storage"
                    " analysis "
                    "failed',lease_owner=NULL,leased_until=NULL,next_attempt_at=:next,finished_at=:done,updated_at=now()"
                    " WHERE id=:id"
                ),
                id=row["id"],
                s=status,
                code=code,
                next=utc_now() + timedelta(seconds=2 ** row["attempt_count"]),
                done=None if retry else utc_now(),
            )
            await worker_event(
                repo,
                row,
                "StorageOptimizationRetrying" if retry else "StorageOptimizationFailed",
                dict(code=code),
            )
    return 1


async def execute_storage(resources, row, planner):
    body = StorageOptimizeRequest(**row["request_payload"]["input"])
    now = utc_now()
    actor = ActorContext(
        row["household_id"], row["member_id"], "MEMBER", uuid4(), row["correlation_id"],
        personal_account=row["request_payload"].get("personal_account", False),
    )
    async with resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        await repo.lock("storage-household:" + str(actor.household_id))
        member = await repo.one(
            "SELECT id FROM wardrobe.member WHERE id=:id AND household_id=:h",
            id=actor.member_id,
            h=actor.household_id,
        )
        if not member:
            raise ApiError(403, "FORBIDDEN", "Analysis member unavailable")
        garments, locations, occupancy, environments = await load_storage(
            repo, actor, body.garment_ids, now,
            read_device=body.dry_run and actor.personal_account,
        )
        wear = await wear_counts(repo, actor, now, body.analysis_window_days)
    output = planner(garments, locations, occupancy, environments, wear, body, now)
    if inspect.isawaitable(output):
        output = await output
    result, snapshots = output
    StoragePlanResult(**result)
    async with resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        await repo.lock("storage-household:" + str(actor.household_id))
        job = await repo.one("SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"])
        if (
            job["status"] != "RUNNING"
            or job["lease_owner"] != row["lease_owner"]
            or job["leased_until"] <= utc_now()
        ):
            return
        if result["proposed_items"]:
            current, spaces, usage, env = await load_storage(
                repo, actor, [UUID(m["garment_id"]) for m in result["proposed_items"]], utc_now(),
                read_device=body.dry_run and actor.personal_account,
            )
            current = {str(g["id"]): g for g in current}
            spaces = {str(location["id"]): location for location in spaces}
            for move in result["proposed_items"]:
                g = current[move["garment_id"]]
                saved = snapshots[move["garment_id"]]
                if target_errors(g, utc_now()) or units(g) != saved["storage_units"]:
                    raise ApiError(409, "INPUT_CHANGED", "Storage planning input changed")
                if (
                    g["version"],
                    g["state_version"],
                    g["profile_version"],
                    str(g["location_id"]),
                ) != (
                    saved["garment_version"],
                    saved["state_version"],
                    saved["profile_version"],
                    saved["source_location_id"],
                ):
                    raise ApiError(409, "INPUT_CHANGED", "Storage planning input changed")
                target = spaces.get(move["destination_location_id"])
                if not target:
                    raise ApiError(409, "INPUT_CHANGED", "Storage destination disappeared")
                if usage[target["id"]] is not None:
                    usage[target["id"]] += saved["storage_units"]
                if placement_errors(
                    g, target, usage[target["id"]], env.get(target["id"]), utc_now(), body.mode
                ):
                    raise ApiError(
                        409, "STORAGE_CONSTRAINT_CHANGED", "Storage capacity or environment changed"
                    )
        if result["proposed_items"] and not body.dry_run:
            identity = uuid4()
            metadata = dict(
                rules_version=result["rules_version"],
                mode=body.mode,
                items=snapshots,
                reasons=result["diagnostics"],
                snapshot_at=now.isoformat(),
                job_id=str(row["id"]),
                request=body.model_dump(mode="json"),
                planning_inputs=jsonable_encoder(
                    dict(
                        garments=garments,
                        locations=locations,
                        environments=list(environments.values()),
                        wear={str(k): v for k, v in wear.items()},
                        occupancy={str(k): v for k, v in occupancy.items()},
                    )
                ),
            )
            await repo.execute(
                (
                    "INSERT INTO "
                    "wardrobe.storage_action(id,household_id,requested_by,action_type,reasoning,expires_at)"
                    " VALUES (:id,:h,:m,:type,CAST(:p AS jsonb),:expiry)"
                ),
                id=identity,
                h=actor.household_id,
                m=actor.member_id,
                type=body.mode,
                p=canonical([metadata]),
                expiry=now + timedelta(hours=24),
            )
            for move in result["proposed_items"]:
                await repo.execute(
                    (
                        "INSERT INTO "
                        "wardrobe.storage_action_item(action_id,garment_id,source_location_id,destination_location_id)"
                        " VALUES (:a,CAST(:g AS uuid),CAST(:s AS uuid),CAST(:d AS uuid))"
                    ),
                    a=identity,
                    g=move["garment_id"],
                    s=move["source_location_id"],
                    d=move["destination_location_id"],
                )
            await repo.execute(
                (
                    "INSERT INTO "
                    "wardrobe.domain_event_outbox(aggregate_type,aggregate_id,event_type,household_id,correlation_id,payload)"
                    " VALUES "
                    "('storage_action',:id,'StorageActionProposed',:h,:c,CAST(:p AS "
                    "jsonb))"
                ),
                id=identity,
                h=actor.household_id,
                c=actor.correlation_id,
                p=canonical(dict(job_id=str(row["id"]), rules_version=result["rules_version"])),
            )
            result["action_ids"] = [str(identity)]
        await repo.execute(
            (
                "UPDATE wardrobe.job SET "
                "status='SUCCEEDED',progress_pct=100,request_payload=CAST(:p AS "
                "jsonb),result_ref=:ref,lease_owner=NULL,leased_until=NULL,finished_at=now(),updated_at=now()"
                " WHERE id=:id"
            ),
            id=row["id"],
            p=canonical(dict(input=body.model_dump(mode="json"), result=result,
                             personal_account=actor.personal_account)),
            ref=result["action_ids"][0] if result["action_ids"] else None,
        )
        await worker_event(
            repo,
            row,
            "StorageOptimizationCompleted",
            dict(status=result["status"], action_ids=result["action_ids"]),
        )
