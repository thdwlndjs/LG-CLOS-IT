"""Provenance-aware VTON, isolated from legacy outfit/session contracts."""

import hashlib
from uuid import UUID, uuid4

from app.application.assets import signed_asset
from app.application.common.idempotency import canonical, idempotent
from app.application.sprint3 import Sprint3, ready_asset
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.poc_vton import UnifiedVtonRequest

CONTRACT = "poc-vton-c1"
SEMANTICS = "MOCK_RECEIPT_NOT_REAL_TRY_ON"


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


async def resolve_inputs(repo, actor, body):
    person = await ready_asset(repo, actor, body.person_asset_id, "PERSON")
    assets, items = [], []
    for item in body.items:
        if item.kind == "OWNED":
            source = await repo.garment(actor, item.id)
            if not source:
                raise ApiError(404, "NOT_FOUND", "Input not found")
            care = await repo.one(
                "SELECT special_care FROM wardrobe.care_profile WHERE garment_id=:id", id=item.id
            )
            if source["status"] != "AVAILABLE" or (care and care["special_care"]):
                raise ApiError(409, "GARMENT_UNAVAILABLE", "Garment not available for try-on")
            owner, version = source["owner_id"], source["version"]
        else:
            source = await repo.one(
                "SELECT * FROM wardrobe.liked_item WHERE id=:id AND household_id=:h "
                "AND member_id=:m",
                id=item.id,
                h=actor.household_id,
                m=actor.member_id,
            )
            if not source:
                raise ApiError(404, "NOT_FOUND", "Input not found")
            owner, version = source["member_id"], None
        if source["category"] != item.slot:
            raise ApiError(422, "VALIDATION_ERROR", "Input category and slot differ")
        if str(source["image_asset_id"]) != str(item.expected_asset_id) or (
            item.expected_source_version is not None and item.expected_source_version != version
        ):
            raise ApiError(409, "INPUT_CHANGED", "Input image or version changed")
        image_owner = await repo.one(
            "SELECT owner_id FROM wardrobe.asset WHERE id=:id",
            id=source["image_asset_id"],
        )
        if not image_owner or image_owner["owner_id"] is None:
            raise ApiError(409, "ASSET_UNAVAILABLE", "Image unavailable")
        asset = await ready_asset(
            repo, actor, source["image_asset_id"], "GARMENT", image_owner["owner_id"]
        )
        if item.kind == "OWNED" and asset["owner_id"] != owner:
            raise ApiError(409, "ASSET_UNAVAILABLE", "Image ownership differs")
        checksum = asset["metadata"].get("checksum_sha256")
        if not checksum or len(checksum) != 64:
            raise ApiError(409, "ASSET_UNAVAILABLE", "Verified source checksum required")
        resolved = dict(
            kind=item.kind,
            id=str(item.id),
            slot=item.slot,
            position=0,
            owner_id=str(owner),
            source_version=version,
            asset_id=str(asset["id"]),
            checksum_sha256=checksum,
        )
        resolved["source_fingerprint"] = fingerprint(resolved)
        items.append(resolved)
        assets.append(asset)
    if not person["metadata"].get("checksum_sha256"):
        raise ApiError(409, "ASSET_UNAVAILABLE", "Verified person checksum required")
    manifest = dict(
        person=dict(
            asset_id=str(person["id"]), checksum_sha256=person["metadata"]["checksum_sha256"]
        ),
        items=items,
    )
    return person, assets, manifest


async def revalidate(repo, actor, payload):
    body = UnifiedVtonRequest(**payload["request"])
    person, assets, manifest = await resolve_inputs(repo, actor, body)
    original = payload["request_snapshot"]
    if manifest != {"person": original["person"], "items": original["items"]}:
        raise ApiError(409, "INPUT_CHANGED", "Snapshot source changed")
    return person, assets


class PocVton(Sprint3):
    async def require_unified_job(self, repo, actor, identity, lock=False):
        row = await repo.one(
            "SELECT * FROM wardrobe.job WHERE id=:id AND member_id=:m AND household_id=:h "
            "AND kind='VTON' AND request_payload->>'contract_version'=:tag"
            + (" FOR UPDATE" if lock else ""),
            id=identity,
            m=actor.member_id,
            h=actor.household_id,
            tag=CONTRACT,
        )
        if not row:
            raise ApiError(404, "NOT_FOUND", "VTON job not found")
        return row

    async def unified_create(self, actor, body, key):
        if self.settings.vton_provider != "MOCK":
            raise ApiError(503, "PROVIDER_CAPABILITY_UNAVAILABLE", "C-stage requires Mock provider")
        if self.settings.app_env not in {"local", "test"} or self.settings.public_deployment:
            raise ApiError(403, "FORBIDDEN", "Mock VTON requires private development")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                await repo.lock(f"poc-vton:{actor.member_id}:{body.client_context_id}")
                active = await repo.one(
                    "SELECT id FROM wardrobe.job WHERE member_id=:m AND household_id=:h "
                    "AND request_payload->>'contract_version'=:tag "
                    "AND request_payload->'request'->>'client_context_id'=:context "
                    "AND status IN ('QUEUED','RUNNING')",
                    m=actor.member_id,
                    h=actor.household_id,
                    tag=CONTRACT,
                    context=str(body.client_context_id),
                )
                if active:
                    raise ApiError(409, "CONFLICT", "A request is already running in this context")
                _, _, manifest = await resolve_inputs(repo, actor, body)
                identity = uuid4()
                snapshot = dict(
                    schema_version=CONTRACT,
                    request_id=str(identity),
                    household_id=str(actor.household_id),
                    member_id=str(actor.member_id),
                    client_context_id=str(body.client_context_id),
                    draft_id=body.draft_id,
                    draft_revision=body.draft_revision,
                    submitted_at=utc_now().isoformat(),
                    provider="MOCK",
                    **manifest,
                    contains_liked=any(i.kind == "LIKED" for i in body.items),
                    input_fingerprint=fingerprint(manifest),
                )
                payload = dict(
                    contract_version=CONTRACT,
                    personal_account=actor.personal_account,
                    request=body.model_dump(mode="json"),
                    request_snapshot=snapshot,
                )
                await repo.execute(
                    "INSERT INTO wardrobe.job(id,household_id,member_id,kind,request_payload,"
                    "correlation_id) VALUES (:id,:h,:m,'VTON',CAST(:p AS jsonb),:c)",
                    id=identity,
                    h=actor.household_id,
                    m=actor.member_id,
                    p=canonical(payload),
                    c=actor.correlation_id,
                )
                await self.event(
                    repo,
                    actor,
                    "PocVtonRequested",
                    "job",
                    identity,
                    dict(input_fingerprint=snapshot["input_fingerprint"], is_mock=True),
                )
                return dict(
                    job_id=str(identity),
                    status="QUEUED",
                    request_snapshot=snapshot,
                    status_url=f"/api/v1/integration/vton-jobs/{identity}",
                    is_mock=True,
                    result_semantics=SEMANTICS,
                )

            response = await idempotent(
                repo,
                actor.member_id,
                "poc_vton_create",
                key,
                body.model_dump(mode="json"),
                202,
                create,
            )
            row = await self.require_unified_job(repo, actor, UUID(response["job_id"]))
            await revalidate(repo, actor, row["request_payload"])
            return response

    async def unified_get(self, actor, identity):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await self.require_unified_job(repo, actor, identity)
            await revalidate(repo, actor, row["request_payload"])
            result = None
            if row["status"] == "SUCCEEDED":
                asset = await ready_asset(repo, actor, UUID(row["result_ref"]), "VTON_RESULT")
                result = signed_asset(self.settings, asset)
            return dict(
                job_id=str(row["id"]),
                status=row["status"],
                request_snapshot=row["request_payload"]["request_snapshot"],
                result_asset=result,
                is_mock=True,
                result_semantics=SEMANTICS,
                error=dict(code=row["error_code"], message=row["error_message_safe"])
                if row["error_code"]
                else None,
            )

    async def unified_cancel(self, actor, identity, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def cancel():
                row = await self.require_unified_job(repo, actor, identity, True)
                if row["status"] in {"QUEUED", "RUNNING"}:
                    await repo.execute(
                        "UPDATE wardrobe.job SET status='CANCELLED',finished_at=now(),"
                        "updated_at=now(),lease_owner=NULL,leased_until=NULL WHERE id=:id",
                        id=identity,
                    )
                    await self.event(repo, actor, "PocVtonCancelled", "job", identity, {})
                    status = "CANCELLED"
                else:
                    status = row["status"]
                return dict(job_id=str(identity), status=status)

            return await idempotent(
                repo,
                actor.member_id,
                "poc_vton_cancel",
                key,
                dict(job_id=str(identity)),
                200,
                cancel,
            )
