"""Private staged uploads, verified immutable final objects, and retention cleanup."""

import asyncio
import hashlib
import io
import warnings
from datetime import timedelta
from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from PIL import Image, UnidentifiedImageError

from app.application.common.idempotency import canonical, idempotent
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.infrastructure.adapters.object_storage import storage_client
from app.infrastructure.db.sprint1_repository import Sprint1Repository

MAX_BYTES = 10485760
FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}


def signed_asset(settings, row):
    signer = storage_client(settings, signing=True)
    try:
        url = signer.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.storage_bucket, "Key": row["asset_key"]},
            ExpiresIn=60,
        )
    finally:
        signer.close()
    return dict(
        asset_id=row["asset_id"],
        asset_key=row["asset_key"],
        content_type=row["content_type"],
        read_url=url,
        expires_at=utc_now() + timedelta(seconds=60),
    )


def validate_image(data, content_type):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=list(FORMATS.values())) as image:
                if image.format != FORMATS[content_type] or max(image.size) > 4096:
                    raise ValueError("Invalid image format or dimensions")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated images are not allowed")
                image.verify()
            with Image.open(io.BytesIO(data), formats=list(FORMATS.values())) as image:
                image.load()
    except (
        ValueError,
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as exc:
        raise ApiError(
            422, "VALIDATION_ERROR", "Image decoding or dimension validation failed"
        ) from exc


async def cleanup_assets(settings, sessions, storage, member_id=None):
    async with sessions.begin() as session:
        repo = Sprint1Repository(session)
        await repo.execute(
            "UPDATE wardrobe.asset SET status='DELETED' WHERE "
            "(status='PENDING_UPLOAD' AND upload_expires_at <= now()) OR "
            "(status='READY' AND retention_expires_at <= now())"
        )
        rows = await repo.all(
            "SELECT id,asset_key,metadata,status FROM wardrobe.asset WHERE "
            "(status='DELETED' OR (status='READY' AND upload_expires_at <= now())) "
            + ("AND owner_id=:member" if member_id else ""),
            **({"member": member_id} if member_id else {}),
        )
    for row in rows:
        keys = [row["metadata"].get("staging_key")]
        if row["status"] == "DELETED":
            keys.append(row["asset_key"])
        try:
            for key in keys:
                if key:
                    await asyncio.to_thread(
                        storage.delete_object, Bucket=settings.storage_bucket, Key=key
                    )
        except Exception as exc:
            raise ApiError(
                503, "STORAGE_UNAVAILABLE", "Asset deletion pending; cleanup will retry"
            ) from exc


class Assets:
    def __init__(self, request):
        self.settings = request.app.state.settings
        self.resources = request.app.state.resources
        self.sessions = self.resources.database.sessions

    async def consent(self, repo, actor):
        await repo.lock("consent:" + str(actor.member_id))
        row = await repo.one(
            "SELECT image_upload_consent FROM wardrobe.member_settings WHERE member_id=:id",
            id=actor.member_id,
        )
        if not row or not row["image_upload_consent"]:
            raise ApiError(403, "CONSENT_REQUIRED", "Image upload consent is required")

    async def intent(self, actor, body, key):
        if body.purpose not in {"GARMENT", "STYLE", "PERSON_VTON"}:
            raise ApiError(
                503, "FEATURE_UNAVAILABLE", "This asset purpose belongs to a later Sprint"
            )
        if not body.file_name.strip() or len(body.file_name) > 255:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid file name")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await self.consent(repo, actor)

            async def create():
                asset_id = uuid4()
                base = f"{actor.household_id}/{actor.member_id}/{asset_id}"
                staging = "staging/" + base
                final = "assets/" + base + "/" + uuid4().hex
                expires = utc_now() + timedelta(minutes=5)
                await repo.execute(
                    "INSERT INTO wardrobe.asset(id,household_id,owner_id,asset_key,content_type,"
                    "kind,byte_size,metadata,upload_expires_at) VALUES (:id,:h,:owner,:key,:type,"
                    ":kind,:size,CAST(:metadata AS jsonb),:expiry)",
                    kind="PERSON" if body.purpose == "PERSON_VTON" else body.purpose,
                    id=asset_id,
                    h=actor.household_id,
                    owner=actor.member_id,
                    key=final,
                    type=body.content_type,
                    size=body.size_bytes,
                    metadata=canonical({"staging_key": staging}),
                    expiry=utc_now() + timedelta(minutes=15),
                )
                signer = storage_client(self.settings, signing=True)
                try:
                    url = signer.generate_presigned_url(
                        "put_object",
                        Params={
                            "Bucket": self.settings.storage_bucket,
                            "Key": staging,
                            "ContentType": body.content_type,
                            "ContentLength": body.size_bytes,
                        },
                        ExpiresIn=300,
                    )
                finally:
                    signer.close()
                return dict(
                    asset_id=str(asset_id),
                    upload_url=url,
                    method="PUT",
                    expires_at=expires.isoformat(),
                    required_headers={
                        "Content-Type": body.content_type,
                        "Content-Length": str(body.size_bytes),
                    },
                )

            return await idempotent(
                repo,
                actor.member_id,
                "asset_intent",
                key,
                body.model_dump(mode="json"),
                201,
                create,
                ttl=300,
            )

    async def finalize(self, actor, asset_id, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await self.consent(repo, actor)
            row = await repo.one(
                "SELECT * FROM wardrobe.asset WHERE id=:id AND household_id=:h "
                "AND owner_id=:owner FOR UPDATE",
                id=asset_id,
                h=actor.household_id,
                owner=actor.member_id,
            )
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Asset not found")
            if row["status"] in {"DELETED", "FAILED"}:
                raise ApiError(409, "CONFLICT", "Asset is unavailable")

            async def finalize():
                if row["status"] == "READY":
                    if row["metadata"].get("checksum_sha256") != body.checksum_sha256:
                        raise ApiError(409, "CONFLICT", "Asset checksum differs")
                    if row["retention_expires_at"] <= utc_now():
                        raise ApiError(409, "CONFLICT", "Asset retention expired")
                else:
                    if row["upload_expires_at"] <= utc_now():
                        raise ApiError(409, "CONFLICT", "Upload expired")
                    storage = self.resources.storage
                    try:
                        obj = await asyncio.to_thread(
                            storage.get_object,
                            Bucket=self.settings.storage_bucket,
                            Key=row["metadata"]["staging_key"],
                        )
                        try:
                            data = await asyncio.to_thread(obj["Body"].read, MAX_BYTES + 1)
                        finally:
                            obj["Body"].close()
                    except ClientError as exc:
                        if exc.response["Error"]["Code"] in {"NoSuchKey", "404"}:
                            raise ApiError(409, "CONFLICT", "Upload has not arrived") from exc
                        raise ApiError(503, "STORAGE_UNAVAILABLE", "Upload read failed") from exc
                    except BotoCoreError as exc:
                        raise ApiError(503, "STORAGE_UNAVAILABLE", "Upload read failed") from exc
                    if (
                        len(data) != row["byte_size"]
                        or len(data) > MAX_BYTES
                        or obj.get("ContentType") != row["content_type"]
                        or hashlib.sha256(data).hexdigest() != body.checksum_sha256
                    ):
                        raise ApiError(
                            422, "VALIDATION_ERROR", "Upload size, MIME or checksum mismatch"
                        )
                    await asyncio.to_thread(validate_image, data, row["content_type"])
                    try:
                        await asyncio.to_thread(
                            storage.put_object,
                            Bucket=self.settings.storage_bucket,
                            Key=row["asset_key"],
                            Body=data,
                            ContentType=row["content_type"],
                        )
                    except Exception as exc:
                        raise ApiError(
                            503, "STORAGE_UNAVAILABLE", "Final object write failed"
                        ) from exc
                    metadata = {**row["metadata"], "checksum_sha256": body.checksum_sha256}
                    await repo.execute(
                        "UPDATE wardrobe.asset SET status='READY',finalized_at=now(),"
                        "retention_expires_at=:expiry,metadata=CAST(:metadata AS jsonb) "
                        "WHERE id=:id",
                        id=asset_id,
                        expiry=utc_now() + timedelta(days=30),
                        metadata=canonical(metadata),
                    )
                    from app.application.sprint1 import Sprint1

                    # Same transaction as READY; a rollback leaves a tracked pending final key.
                    await Sprint1.event(
                        self,
                        repo,
                        actor,
                        "AssetFinalized",
                        "asset",
                        asset_id,
                        {"checksum_sha256": body.checksum_sha256},
                    )
                result = signed_asset(
                    self.settings,
                    dict(
                        asset_id=row["id"],
                        asset_key=row["asset_key"],
                        content_type=row["content_type"],
                    ),
                )
                result["asset_id"] = str(result["asset_id"])
                result["expires_at"] = result["expires_at"].isoformat()
                return result

            return await idempotent(
                repo,
                actor.member_id,
                "asset_finalize:" + str(asset_id),
                key,
                body.model_dump(mode="json"),
                201,
                finalize,
                ttl=60,
            )

    async def audit(self, *args, **kwargs):
        from app.application.sprint1 import Sprint1

        return await Sprint1.audit(self, *args, **kwargs)
