"""Human-triggered single attempt; background workers cannot submit C-2 jobs."""

import asyncio
import base64
import hashlib
from datetime import timedelta
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx

from app.application.assets import MAX_BYTES, signed_asset, validate_image
from app.application.common.idempotency import canonical
from app.application.poc_vton import fingerprint, resolve_inputs, revalidate
from app.application.poc_vton_worker import read_verified, validate_manifest
from app.application.sprint3 import Sprint3, ready_asset
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.domain.vton import InputItem, ProviderFailure, ProviderRequest
from app.infrastructure.adapters.fitroom import (
    AttemptPermit,
    FitRoomAdapter,
    live_allowed,
    prepare_image,
)
from app.infrastructure.adapters.vton import MockVtonProvider
from app.infrastructure.db.sprint1_repository import Sprint1Repository

TAG = "fitroom-c2-v1"
PREPROCESSING = "alpha-white-exif-thumbnail-v1"


async def prepared_inputs(settings, resources, assets):
    results = []
    for asset in assets:
        try:
            data = await read_verified(settings, resources, asset)
            image = await asyncio.to_thread(prepare_image, data)
        except ProviderFailure as error:
            raise ApiError(422, error.code, "Stored source image validation failed") from None
        results.append(
            dict(
                asset_id=str(asset["id"]),
                checksum_sha256=hashlib.sha256(image).hexdigest(),
                data_uri="data:image/png;base64," + base64.b64encode(image).decode(),
            )
        )
    return results


async def audit(repo, actor, job_id, action, **details):
    await repo.execute(
        "INSERT INTO wardrobe.fitroom_audit(member_id,job_id,action,details) "
        "VALUES(:m,:j,:a,CAST(:d AS jsonb))",
        m=actor.member_id,
        j=job_id,
        a=action,
        d=canonical(details),
    )


async def consume(repo, actor, job_id, expected, live):
    """Caller MUST commit this transaction before any network attempt."""
    row = await repo.one(
        "UPDATE wardrobe.fitroom_request SET consumed_at=now() WHERE job_id=:j "
        "AND member_id=:m AND fingerprint=:f AND consumed_at IS NULL "
        "AND ((mode='FIXTURE' AND NOT :live) OR (mode='LIVE' AND :live "
        "AND approved_at IS NOT NULL AND expires_at>now())) RETURNING *",
        j=job_id,
        m=actor.member_id,
        f=expected,
        live=live,
    )
    return row


class Fitroom(Sprint3):
    async def blocked(self, actor, identity, code):
        async with self.sessions.begin() as session:
            await audit(Sprint1Repository(session), actor, identity, "BLOCKED", code=code)
        raise ApiError(403, code, "FitRoom request blocked; no generation was submitted")

    async def row(self, repo, actor, identity):
        result = await repo.one(
            "SELECT j.*,r.mode,r.fingerprint,r.approved_at,r.expires_at,r.consumed_at,"
            "r.provider_job_id FROM wardrobe.job j JOIN wardrobe.fitroom_request r "
            "ON r.job_id=j.id WHERE j.id=:j AND j.member_id=:m AND j.household_id=:h",
            j=identity,
            m=actor.member_id,
            h=actor.household_id,
        )
        if not result:
            raise ApiError(404, "NOT_FOUND", "Review not found")
        return result

    async def preview(self, actor, body):
        slots = {i.slot for i in body.request.items}
        if slots not in ({"TOP", "BOTTOM"}, {"DRESS"}):
            await self.blocked(actor, None, "UNSUPPORTED_COMPOSITION")
        if body.mode == "FIXTURE" and (
            self.settings.app_env not in {"local", "test"} or self.settings.public_deployment
        ):
            await self.blocked(actor, None, "FIXTURE_ENV_BLOCKED")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            person, garments, manifest = await resolve_inputs(repo, actor, body.request)
            # Validate local bytes, never call a paid provider input-check endpoint.
            prepared = await prepared_inputs(self.settings, self.resources, [person, *garments])
            prepared_manifest = [
                {k: i[k] for k in ("asset_id", "checksum_sha256")} for i in prepared
            ]
            digest = fingerprint(
                dict(
                    manifest=manifest,
                    hd_mode=body.hd_mode,
                    preprocessing=PREPROCESSING,
                    prepared=prepared_manifest,
                )
            )
            await repo.lock(f"fitroom-review:{actor.member_id}:{digest}:{body.mode}")
            prior = await repo.one(
                "SELECT job_id FROM wardrobe.fitroom_request WHERE member_id=:m "
                "AND fingerprint=:f AND mode=:mode",
                m=actor.member_id,
                f=digest,
                mode=body.mode,
            )
            if prior:
                identity = prior["job_id"]
            else:
                identity = uuid4()
                snapshot = dict(
                    schema_version=TAG,
                    request_id=str(identity),
                    household_id=str(actor.household_id),
                    member_id=str(actor.member_id),
                    client_context_id=str(body.request.client_context_id),
                    draft_id=body.request.draft_id,
                    draft_revision=body.request.draft_revision,
                    submitted_at=utc_now().isoformat(),
                    provider="FITROOM",
                    **manifest,
                    contains_liked=any(i.kind == "LIKED" for i in body.request.items),
                    input_fingerprint=digest,
                    hd_mode=body.hd_mode,
                    preprocessing=PREPROCESSING,
                    prepared_inputs=prepared_manifest,
                    estimated_credits=1,
                    composition="combo" if "TOP" in slots else "full_set",
                )
                payload = dict(
                    contract_version=TAG,
                    personal_account=actor.personal_account,
                    request=body.request.model_dump(mode="json"),
                    request_snapshot=snapshot,
                )
                await repo.execute(
                    "INSERT INTO wardrobe.job(id,household_id,member_id,kind,request_payload,"
                    "correlation_id) VALUES(:j,:h,:m,'VTON',CAST(:p AS jsonb),:c)",
                    j=identity,
                    h=actor.household_id,
                    m=actor.member_id,
                    p=canonical(payload),
                    c=actor.correlation_id,
                )
                await repo.execute(
                    "INSERT INTO wardrobe.fitroom_request(job_id,member_id,fingerprint,mode) "
                    "VALUES(:j,:m,:f,:mode)",
                    j=identity,
                    m=actor.member_id,
                    f=digest,
                    mode=body.mode,
                )
            await audit(repo, actor, identity, "REVIEWED", mode=body.mode, credits=1)
        return await self.get(actor, identity)

    async def get(self, actor, identity):
        # This GET is DB/storage only. It never polls FitRoom.
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await self.row(repo, actor, identity)
            person, garments = await revalidate(repo, actor, row["request_payload"])
            prepared = await prepared_inputs(self.settings, self.resources, [person, *garments])
            profile = await repo.one(
                "SELECT display_name FROM wardrobe.member WHERE id=:m", m=actor.member_id
            )
            items = []
            for item, asset in zip(
                row["request_payload"]["request_snapshot"]["items"], garments, strict=True
            ):
                table = "garment" if item["kind"] == "OWNED" else "liked_item"
                name = await repo.one(
                    f"SELECT name FROM wardrobe.{table} WHERE id=:id", id=UUID(item["id"])
                )
                items.append(
                    dict(**item, name=name["name"], image=signed_asset(self.settings, asset))
                )
            result = None
            if row["status"] == "SUCCEEDED":
                result = signed_asset(
                    self.settings,
                    await ready_asset(repo, actor, UUID(row["result_ref"]), "VTON_RESULT"),
                )
            allowed = row["consumed_at"] is None and (
                (
                    row["mode"] == "FIXTURE"
                    and self.settings.app_env in {"local", "test"}
                    and not self.settings.public_deployment
                )
                or (
                    live_allowed(self.settings)
                    and row["approved_at"]
                    and row["expires_at"]
                    and row["expires_at"] > utc_now()
                )
            )
            return dict(
                job_id=str(identity),
                status=row["status"],
                mode=row["mode"],
                profile=profile["display_name"],
                person=signed_asset(self.settings, person),
                prepared_inputs=prepared,
                items=items,
                fingerprint=row["fingerprint"],
                request_snapshot=row["request_payload"]["request_snapshot"],
                estimated_credits=1,
                actual_fixture_credits=0,
                authorized=bool(allowed),
                consumed=row["consumed_at"] is not None,
                provider_job_known=bool(row["provider_job_id"]),
                polling_allowed=bool(
                    self.settings.fitroom_status_read_unbilled_verified
                    and live_allowed(self.settings)
                ),
                is_mock=row["mode"] == "FIXTURE",
                result_asset=result,
                result_semantics="FIXTURE_NOT_REAL_TRY_ON"
                if row["mode"] == "FIXTURE"
                else "PROVIDER_GENERATED_UNREVIEWED",
                error=row["error_code"],
            )

    async def execute(self, actor, identity, body, adapter_factory=FitRoomAdapter):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await self.row(repo, actor, identity)
            person, garments = await revalidate(repo, actor, row["request_payload"])
        live = row["mode"] == "LIVE"
        if live and not live_allowed(self.settings):
            await self.blocked(actor, identity, "PAID_CALL_BLOCKED")
        if not live and (
            self.settings.app_env not in {"local", "test"} or self.settings.public_deployment
        ):
            await self.blocked(actor, identity, "FIXTURE_ENV_BLOCKED")
        if str(body.person_asset_id) != str(person["id"]) or body.fingerprint != row["fingerprint"]:
            await self.blocked(actor, identity, "REVIEW_CHANGED")
        request = ProviderRequest(
            str(identity),
            await read_verified(self.settings, self.resources, person),
            tuple([await read_verified(self.settings, self.resources, a) for a in garments]),
            tuple(
                InputItem(
                    **{k: i[k] for k in ("kind", "id", "slot", "asset_id", "checksum_sha256")}
                )
                for i in row["request_payload"]["request_snapshot"]["items"]
            ),
        )
        validate_manifest(request, row["request_payload"]["request_snapshot"])
        snapshot = row["request_payload"]["request_snapshot"]
        transformed = [prepare_image(data) for data in (request.person, *request.garments)]
        if snapshot.get("preprocessing") != PREPROCESSING or [
            hashlib.sha256(data).hexdigest() for data in transformed
        ] != [i["checksum_sha256"] for i in snapshot.get("prepared_inputs", [])]:
            await self.blocked(actor, identity, "PREPROCESSING_CHANGED")
        # Commit the one-shot claim BEFORE submit. A crash loses permission; never restores it.
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await revalidate(repo, actor, row["request_payload"])
            grant = await consume(repo, actor, identity, body.fingerprint, live)
            await audit(repo, actor, identity, "CONSUMED" if grant else "BLOCKED", mode=row["mode"])
            if grant:
                await repo.execute(
                    "UPDATE wardrobe.job SET "
                    "status='RUNNING',attempt_count=1,started_at=now() WHERE id=:j",
                    j=identity,
                )
        if not grant:
            raise ApiError(
                409,
                "CALL_PERMISSION_UNAVAILABLE",
                "Approval missing, expired or already consumed; retry is forbidden",
            )
        try:
            if live:
                reference = await adapter_factory(self.settings).submit(
                    request,
                    AttemptPermit(str(identity), True),
                    row["request_payload"]["request_snapshot"]["hd_mode"],
                )
                async with self.sessions.begin() as session:
                    repo = Sprint1Repository(session)
                    await repo.execute(
                        "UPDATE wardrobe.fitroom_request SET provider_job_id=:p WHERE job_id=:j",
                        p=reference,
                        j=identity,
                    )
                    await audit(repo, actor, identity, "PROVIDER_JOB_IDENTIFIED")
            else:
                # Synthetic fixture, explicitly not captured real-provider output.
                fixture = MockVtonProvider()
                reference = await fixture.submit(request)
                result = await fixture.get_status(reference)
                await self.save_result(actor, identity, result.image, True)
        except Exception:
            async with self.sessions.begin() as session:
                repo = Sprint1Repository(session)
                await repo.execute(
                    "UPDATE wardrobe.job SET status='FAILED',error_code='SUBMISSION_UNCERTAIN',"
                    "error_message_safe='Do not retry generation',finished_at=now() WHERE id=:j",
                    j=identity,
                )
                await audit(repo, actor, identity, "SUBMISSION_UNCERTAIN")
        return await self.get(actor, identity)

    async def poll(self, actor, identity, adapter_factory=FitRoomAdapter):
        # Explicit user action only; GET/detail and startup cannot call this.
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await self.row(repo, actor, identity)
            await audit(repo, actor, identity, "STATUS_REQUESTED")
        if not (
            row["mode"] == "LIVE"
            and row["consumed_at"]
            and row["provider_job_id"]
            and live_allowed(self.settings)
            and self.settings.fitroom_status_read_unbilled_verified
        ):
            await self.blocked(actor, identity, "STATUS_COST_UNVERIFIED")
        if row["status"] == "SUCCEEDED":
            return await self.get(actor, identity)
        try:
            response = await adapter_factory(self.settings).status(row["provider_job_id"])
            if response.get("status") == "COMPLETED":
                image = await download_result(response.get("download_signed_url", ""))
                await self.save_result(actor, identity, image, False)
            elif response.get("status") == "FAILED":
                async with self.sessions.begin() as session:
                    repo = Sprint1Repository(session)
                    await repo.execute(
                        "UPDATE wardrobe.job SET status='FAILED',error_code='PROVIDER_FAILED',"
                        "finished_at=now() WHERE id=:j",
                        j=identity,
                    )
                    await audit(repo, actor, identity, "PROVIDER_FAILED")
            else:
                async with self.sessions.begin() as session:
                    await audit(Sprint1Repository(session), actor, identity, "STATUS_PENDING")
        except Exception:
            await self.blocked(actor, identity, "STATUS_UNAVAILABLE_NO_GENERATION_RETRY")
        return await self.get(actor, identity)

    async def save_result(self, actor, identity, image, is_mock):
        if len(image) > MAX_BYTES:
            raise ProviderFailure("PROVIDER_INVALID_RESULT")
        validate_image(image, "image/png")
        asset_id = uuid4()
        key = f"assets/{actor.household_id}/{actor.member_id}/{asset_id}/fitroom-result.png"
        await asyncio.to_thread(
            self.resources.storage.put_object,
            Bucket=self.settings.storage_bucket,
            Key=key,
            Body=image,
            ContentType="image/png",
        )
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await self.row(repo, actor, identity)
            await revalidate(repo, actor, row["request_payload"])
            await repo.lock("fitroom-result:" + str(identity))
            existing = await repo.one("SELECT result_ref FROM wardrobe.job WHERE id=:j", j=identity)
            if existing["result_ref"]:
                return
            await repo.execute(
                "INSERT INTO "
                "wardrobe.asset(id,household_id,owner_id,kind,status,asset_key,content_type,"
                "byte_size,upload_expires_at,finalized_at,retention_expires_at,metadata) "
                "VALUES(:id,:h,:m,'VTON_RESULT','READY',:k,'image/png',:size,now(),now(),"
                ":expiry,CAST(:meta AS jsonb))",
                id=asset_id,
                h=actor.household_id,
                m=actor.member_id,
                k=key,
                size=len(image),
                expiry=utc_now() + timedelta(days=30),
                meta=canonical(
                    dict(
                        is_mock=is_mock,
                        job_id=str(identity),
                        checksum_sha256=hashlib.sha256(image).hexdigest(),
                        request_snapshot=row["request_payload"]["request_snapshot"],
                    )
                ),
            )
            await repo.execute(
                "UPDATE wardrobe.job SET "
                "status='SUCCEEDED',result_ref=:a,progress_pct=100,finished_at=now() WHERE id=:j",
                a=str(asset_id),
                j=identity,
            )
            await audit(
                repo, actor, identity, "RESULT_STORED", is_mock=is_mock, asset_id=str(asset_id)
            )


async def download_result(url):
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "storage.googleapis.com"
        or parsed.port not in {None, 443}
        or parsed.username
        or parsed.fragment
    ):
        raise ProviderFailure("PROVIDER_INVALID_RESULT")
    async with httpx.AsyncClient(
        timeout=30,
        follow_redirects=False,
        trust_env=False,
        transport=httpx.AsyncHTTPTransport(retries=0),
    ) as client:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise ProviderFailure("PROVIDER_INVALID_RESULT")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise ProviderFailure("PROVIDER_INVALID_RESULT")
    # PNG persistence contract, preserving returned pixels for JPEG inputs too.
    return prepare_image(bytes(data))
