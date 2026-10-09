import asyncio
import base64
import hashlib
import hmac
from datetime import timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.application.assets import MAX_BYTES, signed_asset
from app.application.common.authorization import ActorContext, require_self
from app.application.common.idempotency import canonical, idempotent
from app.application.sprint3 import Sprint3, ready_asset
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint1 import Page
from app.schemas.sprint3 import Job
from app.schemas.sprint4 import CardDraft, CardDraftList, CardItem, CardTemplateData


async def card_inputs(repo, actor, data):
    consent = await repo.one(
        "SELECT image_upload_consent FROM wardrobe.member_settings WHERE member_id=:m",
        m=actor.member_id,
    )
    if not consent or not consent["image_upload_consent"]:
        raise ApiError(403, "CONSENT_REQUIRED", "Image consent required")
    for item in sorted(data.items, key=lambda i: str(i.garment_id)):
        await repo.one("SELECT id FROM wardrobe.garment WHERE id=:id FOR SHARE", id=item.garment_id)
    assets = []
    for item in data.items:
        garment = await repo.garment(actor, item.garment_id)
        if garment is None:
            raise ApiError(409, "INPUT_UNAVAILABLE", "Card garment access unavailable")
        if item.image_asset_id:
            assets.append(
                await ready_asset(repo, actor, item.image_asset_id, "GARMENT", garment["owner_id"])
            )
        else:
            assets.append(None)
    return assets


class Sprint4(Sprint3):
    async def require_card(self, repo, actor, identity, lock=False):
        row = await repo.one(
            "SELECT * FROM wardrobe.outfit_card WHERE id=:id AND member_id=:m"
            + (" FOR UPDATE" if lock else ""),
            id=identity,
            m=actor.member_id,
        )
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Card not found")
        return row

    async def card_dto(self, repo, actor, row):
        data = CardTemplateData(**row["template_data"]["data"])
        image = None
        if row["image_asset_id"]:
            await card_inputs(repo, actor, data)
            image = signed_asset(
                self.settings, await ready_asset(repo, actor, row["image_asset_id"], "CARD")
            )
        status = row["status"]
        if status == "RENDERING":
            latest = await repo.one(
                "SELECT j.status FROM wardrobe.job j JOIN wardrobe.card_render_job c ON"
                " c.job_id=j.id WHERE c.card_id=:id ORDER BY j.created_at DESC,j.id "
                "DESC LIMIT 1",
                id=row["id"],
            )
            status = "RUNNING" if latest and latest["status"] == "RUNNING" else "QUEUED"
        if row["is_saved"] and status == "READY":
            status = "SAVED"
        return CardDraft(
            id=row["id"],
            outfit_id=row["outfit_id"],
            template_id=row["template_id"],
            data=data,
            status=status,
            image_asset=image,
            is_saved=row["is_saved"],
            saved_title=row["template_data"].get("saved_title"),
        )

    async def card_prepare(self, actor, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                outfit = await self.outfit_dto(
                    repo, actor, await self.require_outfit(repo, actor, body.outfit_id, True)
                )
                if outfit.status == "ARCHIVED" or not outfit.items:
                    raise ApiError(409, "OUTFIT_NOT_READY", "Nonempty active outfit required")
                items, tags = [], set()
                order = {
                    slot: n
                    for n, slot in enumerate(
                        ("TOP", "DRESS", "OUTER", "BOTTOM", "SHOES", "ACCESSORY")
                    )
                }
                for item in sorted(
                    outfit.items, key=lambda i: (order[i.slot], i.position, str(i.garment_id))
                ):
                    garment = await repo.garment(actor, item.garment_id)
                    if garment is None:
                        raise ApiError(409, "INPUT_UNAVAILABLE", "Card garment access unavailable")
                    items.append(
                        CardItem(**item.model_dump(), image_asset_id=garment["image_asset_id"])
                    )
                    tags.update(garment["attributes"].get("style_tags") or [])
                data = CardTemplateData(
                    title=outfit.title, style_tag=", ".join(sorted(tags)), items=items
                )
                if body.context_snapshot_id:
                    context = await self.require_context(repo, actor, body.context_snapshot_id)
                    data.date = (
                        context["captured_at"].astimezone(ZoneInfo(context["timezone"])).date()
                    )
                    weather = self.context_dto(context).weather
                    labels = [
                        str(v) for v in (weather.condition, weather.temperature_c) if v is not None
                    ]
                    data.weather_label = (
                        f"[{context['source_mode']}] " + " / ".join(labels) if labels else None
                    )
                await card_inputs(repo, actor, data)
                identity = uuid4()
                await repo.execute(
                    "INSERT INTO "
                    "wardrobe.outfit_card(id,outfit_id,member_id,template_id,template_data)"
                    " VALUES (:id,:o,:m,:t,CAST(:p AS jsonb))",
                    id=identity,
                    o=outfit.id,
                    m=actor.member_id,
                    t=body.template_id,
                    p=canonical(dict(data=data.model_dump(mode="json"))),
                )
                await self.event(
                    repo,
                    actor,
                    "CardDraftPrepared",
                    "outfit_card",
                    identity,
                    dict(outfit_id=str(outfit.id)),
                )
                return (
                    await self.card_dto(repo, actor, await self.require_card(repo, actor, identity))
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "card_prepare",
                key,
                body.model_dump(mode="json"),
                201,
                create,
            )

    async def card_get(self, actor, identity):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            return await self.card_dto(repo, actor, await self.require_card(repo, actor, identity))

    async def card_list(self, actor, member, limit, offset):
        require_self(actor, member or actor.member_id)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            rows = await repo.all(
                "SELECT * FROM wardrobe.outfit_card WHERE member_id=:m AND is_saved "
                "ORDER BY created_at DESC,id DESC LIMIT :l OFFSET :o",
                m=actor.member_id,
                l=limit,
                o=offset,
            )
            total = await repo.one(
                "SELECT count(*) AS n FROM wardrobe.outfit_card WHERE member_id=:m AND is_saved",
                m=actor.member_id,
            )
            return CardDraftList(
                items=[await self.card_dto(repo, actor, r) for r in rows],
                page=Page(limit=limit, offset=offset, total=total["n"]),
            )

    async def card_render(self, actor, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                card = await self.require_card(repo, actor, body.card_id, True)
                if card["status"] == "RENDERING":
                    raise ApiError(409, "CONFLICT", "Card render already active")
                await card_inputs(repo, actor, CardTemplateData(**card["template_data"]["data"]))
                identity = uuid4()
                await repo.execute(
                    "INSERT INTO "
                    "wardrobe.job(id,household_id,member_id,kind,request_payload,correlation_id,created_at)"
                    " VALUES (:id,:h,:m,'CARD_RENDER',CAST(:p AS "
                    "jsonb),:c,clock_timestamp())",
                    id=identity,
                    h=actor.household_id,
                    m=actor.member_id,
                    p=canonical(dict(body.model_dump(mode="json"),
                                     personal_account=actor.personal_account)),
                    c=actor.correlation_id,
                )
                await repo.execute(
                    "INSERT INTO "
                    "wardrobe.card_render_job(job_id,card_id,template_version,output_format)"
                    " VALUES (:j,:c,'minimal-v1',:f)",
                    j=identity,
                    c=body.card_id,
                    f=body.output_format,
                )
                await repo.execute(
                    "UPDATE wardrobe.outfit_card SET "
                    "status='RENDERING',share_token_hash=NULL,share_expires_at=NULL,updated_at=now()"
                    " WHERE id=:id",
                    id=body.card_id,
                )
                await self.event(
                    repo,
                    actor,
                    "CardGenerationRequested",
                    "job",
                    identity,
                    dict(card_id=str(body.card_id)),
                )
                return dict(
                    job_id=str(identity), status="QUEUED", status_url=f"/api/v1/jobs/{identity}"
                )

            return await idempotent(
                repo, actor.member_id, "card_render", key, body.model_dump(mode="json"), 202, create
            )

    async def card_save(self, actor, identity, body, key):
        # Derive a stable opaque token for replay without storing bearer text in the cache.
        token = None
        if body.visibility == "SHAREABLE":
            digest = hmac.digest(
                self.settings.jwt_secret.get_secret_value().encode(),
                f"card-share-v1:{actor.member_id}:{identity}:{key}".encode(),
                "sha256",
            )
            token = base64.urlsafe_b64encode(digest).decode().rstrip("=")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def save():
                card = await self.require_card(repo, actor, identity, True)
                if card["status"] != "READY":
                    raise ApiError(409, "CARD_NOT_READY", "Ready card required")
                dto = await self.card_dto(repo, actor, card)
                expiry = utc_now() + timedelta(hours=24) if token else None
                await repo.execute(
                    "UPDATE wardrobe.outfit_card SET "
                    "is_saved=true,share_token_hash=:hash,share_expires_at=:expiry,template_data=template_data"
                    " || CAST(:p AS jsonb),updated_at=now() WHERE id=:id",
                    id=identity,
                    hash=hashlib.sha256(token.encode()).hexdigest() if token else None,
                    expiry=expiry,
                    p=canonical(dict(saved_title=body.title)),
                )
                dto.status, dto.is_saved, dto.saved_title = "SAVED", True, body.title
                dto.share_expires_at = expiry
                dto.shared_fields = (
                    ["outfit_title", "style_tag", "garment_images"]
                    + (["date", "weather"] if dto.data.date else [])
                    if token
                    else []
                )
                dto.linked_outfit_id = card["outfit_id"] if body.reuse_outfit else None
                await self.event(
                    repo,
                    actor,
                    "CardSaved",
                    "outfit_card",
                    identity,
                    dict(visibility=body.visibility, reuse_outfit=body.reuse_outfit),
                )
                return dto.model_dump(mode="json")

            result = await idempotent(
                repo,
                actor.member_id,
                "card_save",
                key,
                dict(card_id=str(identity), **body.model_dump(mode="json")),
                201,
                save,
            )
            return {**result, "share_url": f"/api/v1/card-shares/{token}" if token else None}

    async def card_share(self, token):
        if len(token) != 43:
            raise ApiError(404, "NOT_FOUND", "Share unavailable")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT c.*,m.household_id FROM wardrobe.outfit_card c JOIN "
                "wardrobe.member m ON m.id=c.member_id WHERE share_token_hash=:hash AND"
                " share_expires_at>now() AND c.status='READY' AND is_saved",
                hash=hashlib.sha256(token.encode()).hexdigest(),
            )
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Share unavailable")
            personal = await repo.one(
                "SELECT coalesce(j.request_payload->'personal_account'='true'::jsonb,false) "
                "AS enabled FROM wardrobe.job j JOIN wardrobe.card_render_job r "
                "ON r.job_id=j.id WHERE r.card_id=:card AND j.status='SUCCEEDED' "
                "AND j.result_ref=CAST(:asset AS text) ORDER BY j.created_at DESC LIMIT 1",
                card=row["id"], asset=str(row["image_asset_id"]),
            )
            actor = ActorContext(row["household_id"], row["member_id"], "MEMBER", uuid4(), "share",
                                 personal_account=bool(personal and personal["enabled"]))
            try:
                await card_inputs(repo, actor, CardTemplateData(**row["template_data"]["data"]))
                image = await ready_asset(repo, actor, row["image_asset_id"], "CARD")
            except ApiError as error:
                raise ApiError(404, "NOT_FOUND", "Share unavailable") from error
        try:
            obj = await asyncio.to_thread(
                self.resources.storage.get_object,
                Bucket=self.settings.storage_bucket,
                Key=image["asset_key"],
            )
            try:
                data = await asyncio.to_thread(obj["Body"].read, MAX_BYTES + 1)
            finally:
                obj["Body"].close()
        except Exception as error:
            raise ApiError(503, "STORAGE_UNAVAILABLE", "Share image unavailable") from error
        if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != image["metadata"].get(
            "checksum_sha256"
        ):
            raise ApiError(503, "STORAGE_UNAVAILABLE", "Share image unavailable")
        return data, image["content_type"]

    async def job_get(self, actor, identity):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT j.*,c.card_id FROM wardrobe.job j JOIN wardrobe.card_render_job"
                " c ON c.job_id=j.id WHERE j.id=:id AND j.member_id=:m AND "
                "j.household_id=:h",
                id=identity,
                m=actor.member_id,
                h=actor.household_id,
            )
            if row:
                card = await self.require_card(repo, actor, row["card_id"])
                image = None
                if row["status"] == "SUCCEEDED":
                    await card_inputs(
                        repo, actor, CardTemplateData(**card["template_data"]["data"])
                    )
                    image = signed_asset(
                        self.settings, await ready_asset(repo, actor, row["result_ref"], "CARD")
                    )
                return Job(
                    id=row["id"],
                    kind="CARD_RENDER",
                    status=row["status"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                    progress_pct=row["progress_pct"],
                    attempt_count=row["attempt_count"],
                    card_id=row["card_id"],
                    result_asset=image,
                    provider_mode=None,
                    error=dict(
                        code=row["error_code"],
                        message="Card rendering failed",
                        request_id=row["correlation_id"] or str(identity),
                        details={},
                    )
                    if row["error_code"]
                    else None,
                )
        return await super().job_get(actor, identity)

    async def job_cancel(self, actor, identity, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT j.id,c.card_id FROM wardrobe.job j JOIN "
                "wardrobe.card_render_job c ON c.job_id=j.id WHERE j.id=:id AND "
                "j.member_id=:m AND j.household_id=:h",
                id=identity,
                m=actor.member_id,
                h=actor.household_id,
            )
        if row is None:
            return await super().job_cancel(actor, identity, key)
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def cancel():
                await self.require_card(repo, actor, row["card_id"])
                job = await repo.one(
                    "SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=identity
                )
                if job["status"] not in {"QUEUED", "RUNNING"}:
                    raise ApiError(409, "CONFLICT", "Job is terminal")
                await repo.execute(
                    "UPDATE wardrobe.job SET "
                    "status='CANCELLED',lease_owner=NULL,leased_until=NULL,finished_at=now(),updated_at=now()"
                    " WHERE id=:id",
                    id=identity,
                )
                await repo.execute(
                    "UPDATE wardrobe.outfit_card SET status='FAILED',updated_at=now() WHERE id=:id",
                    id=row["card_id"],
                )
                await self.event(repo, actor, "CardGenerationCancelled", "job", identity, {})
                return Job(
                    id=job["id"],
                    kind="CARD_RENDER",
                    status="CANCELLED",
                    created_at=job["created_at"],
                    updated_at=utc_now(),
                    progress_pct=job["progress_pct"],
                    attempt_count=job["attempt_count"],
                    card_id=row["card_id"],
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "card_job_cancel",
                key,
                dict(job_id=str(identity)),
                201,
                cancel,
            )
