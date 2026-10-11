"""C-only Mock worker. Verified bytes and immutable manifest, never a try-on claim."""

import asyncio
import hashlib
from datetime import timedelta
from uuid import UUID, uuid4

from app.application.assets import MAX_BYTES, validate_image
from app.application.common.authorization import ActorContext
from app.application.common.idempotency import canonical
from app.application.poc_vton import CONTRACT, SEMANTICS, revalidate
from app.application.vton_worker import worker_event
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.domain.vton import InputItem, ProviderFailure, ProviderRequest
from app.infrastructure.adapters.vton import provider_for
from app.infrastructure.db.sprint1_repository import Sprint1Repository


async def read_verified(settings, resources, asset):
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


def validate_manifest(request, snapshot):
    if len(request.garments) != len(snapshot["items"]) or len(request.input_manifest) != len(
        snapshot["items"]
    ):
        raise ProviderFailure("INPUT_CHANGED")
    if hashlib.sha256(request.person).hexdigest() != snapshot["person"]["checksum_sha256"]:
        raise ProviderFailure("INPUT_CHANGED")
    for data, item, manifest in zip(
        request.garments, snapshot["items"], request.input_manifest, strict=True
    ):
        if (manifest.kind, manifest.id, manifest.slot, manifest.asset_id) != (
            item["kind"],
            item["id"],
            item["slot"],
            item["asset_id"],
        ):
            raise ProviderFailure("INPUT_CHANGED")
        if hashlib.sha256(data).hexdigest() != item["checksum_sha256"]:
            raise ProviderFailure("INPUT_CHANGED")


async def process_jobs(settings, resources, provider_factory=provider_for):
    async with resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        expired = await repo.all(
            "UPDATE wardrobe.job SET status='TIMED_OUT',error_code='WORKER_LEASE_EXPIRED',"
            "error_message_safe='Worker lease expired',finished_at=now(),updated_at=now(),"
            "lease_owner=NULL,leased_until=NULL WHERE kind='VTON' AND status='RUNNING' "
            "AND request_payload->>'contract_version'=:tag AND leased_until<=now() RETURNING *",
            tag=CONTRACT,
        )
        for row in expired:
            await worker_event(repo, row, "PocVtonFailed", dict(code="WORKER_LEASE_EXPIRED"))
        selected = await repo.all(
            "SELECT * FROM wardrobe.job WHERE kind='VTON' AND status='QUEUED' "
            "AND request_payload->>'contract_version'=:tag AND next_attempt_at<=now() "
            "ORDER BY created_at,id LIMIT 10 FOR UPDATE SKIP LOCKED",
            tag=CONTRACT,
        )
        rows = []
        for source in selected:
            row = dict(source)
            row["lease_owner"] = uuid4().hex
            await repo.execute(
                "UPDATE wardrobe.job SET status='RUNNING',attempt_count=attempt_count+1,"
                "progress_pct=10,lease_owner=:lease,leased_until=:expiry,"
                "started_at=coalesce(started_at,now()),updated_at=now() WHERE id=:id",
                id=row["id"],
                lease=row["lease_owner"],
                expiry=utc_now() + timedelta(seconds=settings.decart_timeout_seconds + 30),
            )
            await worker_event(repo, row, "PocVtonStarted", {})
            rows.append(row)
    semaphore = asyncio.Semaphore(settings.decart_max_concurrency)

    async def execute(row):
        async with semaphore:
            await execute_job(settings, resources, row, provider_factory)

    await asyncio.gather(*(execute(row) for row in rows))
    return len(rows)


async def execute_job(settings, resources, row, provider_factory):
    payload = row["request_payload"]
    snapshot = payload["request_snapshot"]
    actor = ActorContext(
        row["household_id"],
        row["member_id"],
        "MEMBER",
        UUID(int=0),
        row["correlation_id"] or str(row["id"]),
        personal_account=payload.get("personal_account", False),
    )
    asset_id = None
    provider = reference = None

    async def perform():
        nonlocal asset_id, provider, reference
        # Configuration changes never turn an accepted Mock job into a paid call.
        if (
            settings.vton_provider != "MOCK"
            or settings.public_deployment
            or settings.app_env not in {"local", "test"}
        ):
            raise ProviderFailure("PROVIDER_CAPABILITY_UNAVAILABLE")
        async with resources.database.sessions.begin() as session:
            person, garments = await revalidate(Sprint1Repository(session), actor, payload)
        person_data = await read_verified(settings, resources, person)
        garment_data = tuple([await read_verified(settings, resources, a) for a in garments])
        request = ProviderRequest(
            str(row["id"]),
            person_data,
            garment_data,
            tuple(
                InputItem(
                    **{k: item[k] for k in ("kind", "id", "slot", "asset_id", "checksum_sha256")}
                )
                for item in snapshot["items"]
            ),
        )
        validate_manifest(request, snapshot)
        provider = provider_factory("MOCK")
        reference = await provider.submit(request)
        result = await provider.get_status(reference)
        while result.status in {"PENDING", "RUNNING"}:
            await asyncio.sleep(0.1)
            result = await provider.get_status(reference)
        if result.status != "SUCCEEDED" or not result.image or not result.is_mock:
            raise ProviderFailure("PROVIDER_INVALID_RESULT")
        if len(result.image) > MAX_BYTES:
            raise ProviderFailure("PROVIDER_INVALID_RESULT")
        await asyncio.to_thread(validate_image, result.image, "image/png")
        asset_id = uuid4()
        key = f"assets/{actor.household_id}/{actor.member_id}/{asset_id}/mock-receipt.png"
        async with resources.database.sessions.begin() as session:
            await Sprint1Repository(session).execute(
                "INSERT INTO wardrobe.asset(id,household_id,owner_id,kind,asset_key,content_type,"
                "upload_expires_at,metadata) VALUES(:id,:h,:m,'VTON_RESULT',:key,'image/png',"
                ":expiry,CAST(:meta AS jsonb))",
                id=asset_id,
                h=actor.household_id,
                m=actor.member_id,
                key=key,
                expiry=utc_now() + timedelta(minutes=15),
                meta=canonical(
                    dict(
                        job_id=str(row["id"]),
                        is_mock=True,
                        result_semantics=SEMANTICS,
                        input_manifest=snapshot,
                    )
                ),
            )
        await asyncio.to_thread(
            resources.storage.put_object,
            Bucket=settings.storage_bucket,
            Key=key,
            Body=result.image,
            ContentType="image/png",
        )
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            for owner in sorted({person["owner_id"], *(a["owner_id"] for a in garments)}, key=str):
                await repo.lock("consent:" + str(owner))
            # Guard source updates through commit as well as consent changes.
            for item in sorted(snapshot["items"], key=lambda i: (i["kind"], i["id"])):
                table = "garment" if item["kind"] == "OWNED" else "liked_item"
                await repo.one(
                    f"SELECT id FROM wardrobe.{table} WHERE id=:id FOR SHARE", id=UUID(item["id"])
                )
            await revalidate(repo, actor, payload)
            locked = await repo.one(
                "SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"]
            )
            asset = await repo.one(
                "SELECT status FROM wardrobe.asset WHERE id=:id FOR UPDATE", id=asset_id
            )
            if (
                locked["status"] != "RUNNING"
                or locked["lease_owner"] != row["lease_owner"]
                or asset["status"] != "PENDING_UPLOAD"
            ):
                await repo.execute(
                    "UPDATE wardrobe.asset SET status='DELETED' WHERE id=:id", id=asset_id
                )
                return
            await repo.execute(
                "UPDATE wardrobe.asset SET status='READY',byte_size=:size,finalized_at=now(),"
                "retention_expires_at=:expiry,metadata=metadata || CAST(:meta AS jsonb) "
                "WHERE id=:id",
                id=asset_id,
                size=len(result.image),
                expiry=utc_now() + timedelta(days=30),
                meta=canonical(dict(checksum_sha256=hashlib.sha256(result.image).hexdigest())),
            )
            await repo.execute(
                "UPDATE wardrobe.job SET status='SUCCEEDED',progress_pct=100,result_ref=:a,"
                "finished_at=now(),updated_at=now(),lease_owner=NULL,leased_until=NULL "
                "WHERE id=:id",
                id=row["id"],
                a=str(asset_id),
            )
            await worker_event(
                repo, row, "PocVtonSucceeded", dict(result_asset_id=str(asset_id), is_mock=True)
            )

    code = None
    try:
        await asyncio.wait_for(perform(), settings.decart_timeout_seconds)
    except TimeoutError:
        code = "PROVIDER_TIMEOUT"
    except ProviderFailure as error:
        code = error.code
    except ApiError as error:
        code = error.code
    except Exception:
        code = "PROVIDER_OR_STORAGE_UNAVAILABLE"
    if code:
        allowed = {
            "PROVIDER_TIMEOUT",
            "INPUT_CHANGED",
            "ASSET_UNAVAILABLE",
            "NOT_FOUND",
            "GARMENT_UNAVAILABLE",
            "VALIDATION_ERROR",
            "PROVIDER_INVALID_RESULT",
            "PROVIDER_CAPABILITY_UNAVAILABLE",
            "PROVIDER_OR_STORAGE_UNAVAILABLE",
        }
        code = code if code in allowed else "PROVIDER_FAILED"
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            if asset_id:
                await repo.execute(
                    "UPDATE wardrobe.asset SET status='DELETED' WHERE id=:id", id=asset_id
                )
            locked = await repo.one(
                "SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"]
            )
            if locked["status"] == "RUNNING" and locked["lease_owner"] == row["lease_owner"]:
                await repo.execute(
                    "UPDATE wardrobe.job SET status=CAST(:status AS wardrobe.job_status),"
                    "error_code=:code,error_message_safe='Mock request processing failed',"
                    "finished_at=now(),updated_at=now(),"
                    "lease_owner=NULL,leased_until=NULL WHERE id=:id",
                    id=row["id"],
                    code=code,
                    status="TIMED_OUT" if code == "PROVIDER_TIMEOUT" else "FAILED",
                )
                await worker_event(repo, row, "PocVtonFailed", dict(code=code))
        if provider and reference:
            try:
                await asyncio.wait_for(provider.cancel(reference), 2)
            except Exception:
                pass
