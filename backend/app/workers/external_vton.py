"""Durable isolated LIKED mock jobs; never create garments, outfits or histories."""

import asyncio
import hashlib
from datetime import timedelta
from uuid import uuid4

from app.application.assets import MAX_BYTES, validate_image
from app.application.common.authorization import ActorContext
from app.application.common.idempotency import canonical
from app.application.sprint3 import ready_asset
from app.core.clock import utc_now
from app.core.config import load_settings
from app.domain.vton import ProviderRequest
from app.infrastructure.adapters.vton import MockVtonProvider
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.infrastructure.resources import RuntimeResources
from app.workers.celery_app import celery_app


async def process():
    settings = load_settings()
    resources = RuntimeResources(settings)
    try:
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await repo.execute(
                "UPDATE wardrobe.job j SET status='TIMED_OUT',error_code='PROVIDER_TIMEOUT',"
                "finished_at=now(),updated_at=now() FROM wardrobe.external_vton_job v "
                "WHERE v.job_id=j.id AND j.status='RUNNING' AND j.leased_until<now()"
            )
            row = await repo.one(
                "SELECT j.*,v.person_asset_id,m.role FROM wardrobe.job j "
                "JOIN wardrobe.external_vton_job v ON v.job_id=j.id "
                "JOIN wardrobe.member m ON m.id=j.member_id WHERE j.status='QUEUED' "
                "ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED"
            )
            if row is None:
                return
            lease = str(uuid4())
            await repo.execute(
                "UPDATE wardrobe.job SET status='RUNNING',attempt_count=attempt_count+1,"
                "started_at=now(),updated_at=now(),lease_owner=:lease,leased_until=:expiry "
                "WHERE id=:id", id=row["id"], lease=lease,
                expiry=utc_now() + timedelta(seconds=settings.decart_timeout_seconds + 10),
            )
        actor = ActorContext(row["household_id"], row["member_id"], row["role"], uuid4(),
                             str(row["id"]))
        key = None
        try:
            async with resources.database.sessions.begin() as session:
                person = await ready_asset(Sprint1Repository(session), actor,
                                           row["person_asset_id"], "PERSON", actor.member_id)
            obj = await asyncio.to_thread(resources.storage.get_object,
                                          Bucket=settings.storage_bucket, Key=person["asset_key"])
            try:
                data = await asyncio.to_thread(obj["Body"].read, MAX_BYTES + 1)
            finally:
                obj["Body"].close()
            if (len(data) != person["byte_size"] or len(data) > MAX_BYTES
                    or hashlib.sha256(data).hexdigest() != person["metadata"]["checksum_sha256"]):
                raise ValueError("Input checksum changed")
            validate_image(data, person["content_type"])
            provider = MockVtonProvider()
            # Generated synthetic external image, no external network fetch or SSRF surface.
            synthetic = (await provider.get_status("mock:synthetic-product")).image
            reference = await provider.submit(ProviderRequest(str(row["id"]), data, (synthetic,)))
            result = await provider.get_status(reference)
            validate_image(result.image, "image/png")
            asset_id = uuid4()
            key = f"assets/{actor.household_id}/{actor.member_id}/{asset_id}/liked-result.png"
            await asyncio.to_thread(resources.storage.put_object, Bucket=settings.storage_bucket,
                                    Key=key, Body=result.image, ContentType="image/png")
            async with resources.database.sessions.begin() as session:
                repo = Sprint1Repository(session)
                await repo.lock("consent:" + str(actor.member_id))
                await ready_asset(repo, actor, row["person_asset_id"], "PERSON", actor.member_id)
                owned = await repo.one(
                    "SELECT id FROM wardrobe.job WHERE id=:id AND status='RUNNING' "
                    "AND lease_owner=:lease FOR UPDATE", id=row["id"], lease=lease,
                )
                if not owned:
                    raise ValueError("Lease expired")
                await repo.execute(
                    "INSERT INTO wardrobe.asset(id,household_id,owner_id,kind,asset_key,"
                    "content_type,"
                    "status,byte_size,metadata,finalized_at,retention_expires_at) "
                    "VALUES(:id,:h,:m,'VTON_RESULT',:key,'image/png','READY',:size,"
                    "CAST(:meta AS jsonb),"
                    "now(),:expiry)", id=asset_id, h=actor.household_id, m=actor.member_id, key=key,
                    size=len(result.image), expiry=utc_now() + timedelta(days=30),
                    meta=canonical(dict(is_mock=True, source="LIKED", job_id=str(row["id"]),
                                        checksum_sha256=hashlib.sha256(result.image).hexdigest())),
                )
                await repo.execute(
                    "UPDATE wardrobe.external_vton_job SET result_asset_id=:asset WHERE job_id=:id",
                    asset=asset_id, id=row["id"],
                )
                await repo.execute(
                    "UPDATE wardrobe.job SET status='SUCCEEDED',progress_pct=100,result_ref=:asset,"
                    "finished_at=now(),updated_at=now(),lease_owner=NULL,leased_until=NULL "
                    "WHERE id=:id",
                    asset=str(asset_id), id=row["id"],
                )
        except Exception:
            if key:
                await asyncio.to_thread(resources.storage.delete_object,
                                        Bucket=settings.storage_bucket, Key=key)
            async with resources.database.sessions.begin() as session:
                await Sprint1Repository(session).execute(
                    "UPDATE wardrobe.job SET status='FAILED',"
                    "error_code='INPUT_OR_STORAGE_UNAVAILABLE',"
                    "finished_at=now(),updated_at=now(),lease_owner=NULL,leased_until=NULL "
                    "WHERE id=:id AND lease_owner=:lease AND status='RUNNING'",
                    id=row["id"], lease=lease,
                )
    finally:
        await resources.close()


@celery_app.task(name="wardrobe.process_external_vton")
def external_vton():
    asyncio.run(process())
