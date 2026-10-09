import asyncio
import hashlib
import logging
from datetime import timedelta
from uuid import UUID, uuid4

from app.application.assets import MAX_BYTES, validate_image
from app.application.common.authorization import ActorContext
from app.application.common.idempotency import canonical
from app.application.sprint3 import input_assets
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.domain.vton import ProviderFailure, ProviderRequest
from app.infrastructure.adapters.vton import provider_for
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint2 import OutfitItem


async def worker_event(repo, row, name, payload):
    logging.getLogger("wardrobe").info(
        "job_event",
        extra={
            "job_id": str(row["id"]),
            "correlation_id": row["correlation_id"],
            "provider_mode": row.get("provider", "INTERNAL"),
            "attempts": row.get("attempt_count", 0),
            "outcome": name,
        },
    )
    await repo.execute(
        "INSERT INTO wardrobe.domain_event_outbox(aggregate_type,aggregate_id,event_type,"
        "household_id,correlation_id,payload) VALUES ('job',:id,:e,:h,:c,CAST(:p AS jsonb))",
        id=row["id"],
        e=name,
        h=row["household_id"],
        c=row["correlation_id"],
        p=canonical(payload),
    )


async def process_jobs(settings, resources, provider_factory=provider_for):
    sessions = resources.database.sessions
    async with sessions.begin() as session:
        repo = Sprint1Repository(session)
        expired = await repo.all(
            "UPDATE wardrobe.job SET status='TIMED_OUT',error_code='WORKER_LEASE_EXPIRED',"
            "error_message_safe='Worker lease expired',finished_at=now(),updated_at=now(),"
            "lease_owner=NULL,leased_until=NULL WHERE kind='VTON' AND status='RUNNING' "
            "AND leased_until<=now() RETURNING *",
        )
        for row in expired:
            await worker_event(repo, row, "VtonJobFailed", dict(code="WORKER_LEASE_EXPIRED"))
        selected = await repo.all(
            "SELECT j.*,v.session_id,v.outfit_revision,v.provider FROM wardrobe.job j "
            "JOIN wardrobe.vton_job v ON v.job_id=j.id WHERE j.status='QUEUED' "
            "AND j.next_attempt_at<=now() ORDER BY j.created_at,j.id "
            "LIMIT 10 FOR UPDATE OF j SKIP LOCKED",
        )
        rows = []
        for selected_row in selected:
            row = dict(selected_row)
            row["lease_owner"] = uuid4().hex
            row["attempt_count"] += 1
            await repo.execute(
                "UPDATE wardrobe.job SET status='RUNNING',progress_pct=10,attempt_count="
                "attempt_count+1,lease_owner=:lease,leased_until=:expiry,started_at=coalesce("
                "started_at,now()),updated_at=now(),error_code=NULL,error_message_safe=NULL "
                "WHERE id=:id",
                id=row["id"],
                lease=row["lease_owner"],
                expiry=utc_now() + timedelta(seconds=settings.decart_timeout_seconds + 30),
            )
            await worker_event(repo, row, "VtonJobStarted", dict(attempt=row["attempt_count"]))
            rows.append(row)
    semaphore = asyncio.Semaphore(settings.decart_max_concurrency)

    async def execute(row):
        async with semaphore:
            await execute_job(settings, resources, row, provider_factory)

    await asyncio.gather(*(execute(row) for row in rows))
    return len(rows)


async def execute_job(settings, resources, row, provider_factory):
    actor = ActorContext(
        row["household_id"],
        row["member_id"],
        "MEMBER",
        UUID(int=0),
        row["correlation_id"] or str(row["id"]),
    )
    payload = row["request_payload"]
    items = [OutfitItem(**i) for i in payload["items"]]
    asset_id = None
    provider = None
    reference = None
    code, retryable = None, False

    async def perform():
        nonlocal asset_id, provider, reference
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            person, garments = await input_assets(repo, actor, payload["person_asset_id"], items)
            if [str(a["id"]) for a in garments] != payload["garment_asset_ids"]:
                raise ProviderFailure("INPUT_CHANGED")
            asset_id = uuid4()
            key = f"assets/{actor.household_id}/{actor.member_id}/{asset_id}/result.png"
            await repo.execute(
                "INSERT INTO wardrobe.asset(id,household_id,owner_id,kind,asset_key,content_type,"
                "metadata,upload_expires_at) VALUES (:id,:h,:m,'VTON_RESULT',:key,'image/png',"
                "CAST(:p AS jsonb),:expiry)",
                id=asset_id,
                h=actor.household_id,
                m=actor.member_id,
                key=key,
                p=canonical(dict(job_id=str(row["id"]), is_mock=row["provider"] == "MOCK")),
                expiry=utc_now() + timedelta(minutes=15),
            )

        async def read(asset):
            obj = await asyncio.to_thread(
                resources.storage.get_object, Bucket=settings.storage_bucket, Key=asset["asset_key"]
            )
            try:
                data = await asyncio.to_thread(obj["Body"].read, MAX_BYTES + 1)
            finally:
                obj["Body"].close()
            if (
                len(data) > MAX_BYTES
                or len(data) != asset["byte_size"]
                or obj.get("ContentType") != asset["content_type"]
                or hashlib.sha256(data).hexdigest() != asset["metadata"].get("checksum_sha256")
            ):
                raise ProviderFailure("INPUT_CHANGED")
            await asyncio.to_thread(validate_image, data, asset["content_type"])
            return data

        person_data = await read(person)
        garment_data = tuple([await read(a) for a in garments])
        provider = provider_factory(row["provider"])
        reference = await provider.submit(
            ProviderRequest(str(row["id"]), person_data, garment_data)
        )
        result = await provider.get_status(reference)
        while result.status in {"PENDING", "RUNNING"}:
            await asyncio.sleep(0.1)
            result = await provider.get_status(reference)
        if result.status != "SUCCEEDED" or not result.image:
            raise ProviderFailure("PROVIDER_FAILED")
        if (row["provider"] == "MOCK") != result.is_mock or len(result.image) > MAX_BYTES:
            raise ProviderFailure("PROVIDER_INVALID_RESULT")
        try:
            await asyncio.to_thread(validate_image, result.image, "image/png")
        except ApiError as error:
            raise ProviderFailure("PROVIDER_INVALID_RESULT") from error
        await asyncio.to_thread(
            resources.storage.put_object,
            Bucket=settings.storage_bucket,
            Key=key,
            Body=result.image,
            ContentType="image/png",
        )
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            # Consent lock prevents READY commit racing owner revocation.
            for member in sorted({actor.member_id, *(g["owner_id"] for g in garments)}, key=str):
                await repo.lock("consent:" + str(member))
            await input_assets(repo, actor, payload["person_asset_id"], items)
            status = await repo.one(
                "SELECT status,lease_owner FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"]
            )
            asset = await repo.one(
                "SELECT status FROM wardrobe.asset WHERE id=:id FOR UPDATE", id=asset_id
            )
            if (
                status["status"] != "RUNNING"
                or status["lease_owner"] != row["lease_owner"]
                or asset["status"] != "PENDING_UPLOAD"
            ):
                await repo.execute(
                    "UPDATE wardrobe.asset SET status='DELETED' WHERE id=:id", id=asset_id
                )
                return
            await repo.execute(
                "UPDATE wardrobe.asset SET status='READY',byte_size=:size,finalized_at=now(),"
                "retention_expires_at=:expiry,metadata=metadata || CAST(:p AS jsonb) WHERE id=:id",
                id=asset_id,
                size=len(result.image),
                expiry=utc_now() + timedelta(days=30),
                p=canonical(dict(checksum_sha256=hashlib.sha256(result.image).hexdigest())),
            )
            await repo.execute(
                "UPDATE wardrobe.vton_job SET result_asset_id=:a,provider_job_id=:p,"
                "provider_metadata=CAST(:meta AS jsonb) WHERE job_id=:id",
                id=row["id"],
                a=asset_id,
                p=reference,
                meta=canonical(dict(is_mock=result.is_mock)),
            )
            await repo.execute(
                "UPDATE wardrobe.job SET status='SUCCEEDED',progress_pct=100,result_ref=:a,"
                "finished_at=now(),updated_at=now(),lease_owner=NULL,leased_until=NULL "
                "WHERE id=:id",
                id=row["id"],
                a=str(asset_id),
            )
            await worker_event(
                repo,
                row,
                "VtonJobSucceeded",
                dict(
                    result_asset_id=str(asset_id),
                    provider_mode=row["provider"],
                    revision=row["outfit_revision"],
                ),
            )

    try:
        await asyncio.wait_for(perform(), settings.decart_timeout_seconds)
    except TimeoutError:
        code = "PROVIDER_TIMEOUT"
    except ProviderFailure as error:
        code, retryable = error.code, error.retryable
    except ApiError:
        code = "INPUT_UNAVAILABLE"
    except Exception:
        code, retryable = "PROVIDER_OR_STORAGE_UNAVAILABLE", True
    if code:
        # Safe, fixed taxonomy; never put exception text in DB, API or logs.
        allowed = {
            "PROVIDER_TIMEOUT",
            "INPUT_UNAVAILABLE",
            "INPUT_CHANGED",
            "PROVIDER_FAILED",
            "PROVIDER_INVALID_RESULT",
            "PROVIDER_OR_STORAGE_UNAVAILABLE",
            "PROVIDER_CAPABILITY_UNAVAILABLE",
            "PROVIDER_RATE_LIMITED",
        }
        code = code if code in allowed else "PROVIDER_FAILED"
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            if asset_id:
                await repo.execute(
                    "UPDATE wardrobe.asset SET status='DELETED' WHERE id=:id", id=asset_id
                )
            locked = await repo.one(
                "SELECT status,lease_owner FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"]
            )
            if locked["status"] == "RUNNING" and locked["lease_owner"] == row["lease_owner"]:
                retry = retryable and row["attempt_count"] < row["max_attempts"]
                status = (
                    "QUEUED" if retry else "TIMED_OUT" if code == "PROVIDER_TIMEOUT" else "FAILED"
                )
                await repo.execute(
                    "UPDATE wardrobe.job SET status=CAST(:status AS wardrobe.job_status),"
                    "error_code=:code,error_message_safe='VTON processing failed',"
                    "next_attempt_at=:next,lease_owner=NULL,leased_until=NULL,"
                    "finished_at=:finished,updated_at=now() WHERE id=:id",
                    id=row["id"],
                    status=status,
                    code=code,
                    next=utc_now() + timedelta(seconds=2 ** row["attempt_count"]),
                    finished=None if retry else utc_now(),
                )
                await worker_event(
                    repo,
                    row,
                    "VtonJobRetryScheduled" if retry else "VtonJobFailed",
                    dict(code=code, attempt=row["attempt_count"]),
                )
        if provider and reference:
            try:
                await asyncio.wait_for(provider.cancel(reference), 2)
            except Exception:
                pass
