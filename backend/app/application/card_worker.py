import asyncio
import base64
import hashlib
import io
from datetime import timedelta
from uuid import uuid4

import httpx
from PIL import Image

from app.application.assets import MAX_BYTES, validate_image
from app.application.common.authorization import ActorContext
from app.application.common.idempotency import canonical
from app.application.sprint4 import card_inputs
from app.application.vton_worker import worker_event
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint4 import CardTemplateData


async def render_card(settings, payload):
    async with httpx.AsyncClient(
        timeout=settings.card_render_timeout_seconds, follow_redirects=False
    ) as client:
        async with client.stream(
            "POST", settings.card_renderer_url.rstrip("/") + "/render", json=payload
        ) as response:
            response.raise_for_status()
            if response.headers.get("content-type") != "image/png":
                raise ApiError(422, "INVALID_RENDER_RESULT", "PNG response required")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise ApiError(422, "INVALID_RENDER_RESULT", "Image too large")
            return bytes(data)


async def process_cards(settings, resources, renderer=render_card):
    async with resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        expired = await repo.all(
            "UPDATE wardrobe.job SET "
            "status='TIMED_OUT',error_code='WORKER_LEASE_EXPIRED',error_message_safe='Card"
            " worker lease "
            "expired',lease_owner=NULL,leased_until=NULL,finished_at=now(),updated_at=now()"
            " WHERE kind='CARD_RENDER' AND status='RUNNING' AND leased_until<=now()"
            " RETURNING *"
        )
        for row in expired:
            await repo.execute(
                "UPDATE wardrobe.outfit_card SET status='FAILED',updated_at=now() WHERE"
                " id=(SELECT card_id FROM wardrobe.card_render_job WHERE job_id=:j)",
                j=row["id"],
            )
            await worker_event(repo, row, "CardGenerationFailed", dict(code="WORKER_LEASE_EXPIRED"))
        selected = await repo.all(
            "SELECT j.*,c.card_id,c.output_format FROM wardrobe.job j JOIN "
            "wardrobe.card_render_job c ON c.job_id=j.id WHERE j.status='QUEUED' "
            "AND j.next_attempt_at<=now() ORDER BY j.created_at,j.id LIMIT 1 FOR "
            "UPDATE OF j SKIP LOCKED"
        )
        rows = []
        for original in selected:
            row = dict(original)
            row["lease_owner"] = uuid4().hex
            row["attempt_count"] += 1
            await repo.execute(
                "UPDATE wardrobe.job SET "
                "status='RUNNING',attempt_count=attempt_count+1,progress_pct=10,lease_owner=:l,leased_until=:expiry,started_at=coalesce(started_at,now()),updated_at=now(),error_code=NULL,error_message_safe=NULL"
                " WHERE id=:id",
                id=row["id"],
                l=row["lease_owner"],
                expiry=utc_now() + timedelta(seconds=settings.card_render_timeout_seconds + 30),
            )
            await worker_event(
                repo, row, "CardGenerationStarted", dict(attempt=row["attempt_count"])
            )
            rows.append(row)
    for row in rows:
        await execute_card(settings, resources, row, renderer)
    return len(rows)


async def execute_card(settings, resources, row, renderer):
    actor = ActorContext(
        row["household_id"],
        row["member_id"],
        "MEMBER",
        uuid4(),
        row["correlation_id"] or str(row["id"]),
    )
    asset_id = None

    async def perform():
        nonlocal asset_id
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            card = await repo.one(
                "SELECT * FROM wardrobe.outfit_card WHERE id=:id", id=row["card_id"]
            )
            data = CardTemplateData(**card["template_data"]["data"])
            inputs = await card_inputs(repo, actor, data)
            asset_id = uuid4()
            mime = "image/png" if row["output_format"] == "PNG" else "image/webp"
            extension = row["output_format"].lower()
            key = f"assets/{actor.household_id}/{actor.member_id}/{asset_id}/card.{extension}"
            await repo.execute(
                "INSERT INTO "
                "wardrobe.asset(id,household_id,owner_id,kind,asset_key,content_type,metadata,upload_expires_at)"
                " VALUES (:id,:h,:m,'CARD',:k,:mime,CAST(:p AS jsonb),:expiry)",
                id=asset_id,
                h=actor.household_id,
                m=actor.member_id,
                k=key,
                mime=mime,
                p=canonical(dict(job_id=str(row["id"]), template_version="minimal-v1")),
                expiry=utc_now() + timedelta(minutes=15),
            )
        images = []
        for item, asset in zip(data.items, inputs, strict=True):
            encoded = None
            if asset:
                obj = await asyncio.to_thread(
                    resources.storage.get_object,
                    Bucket=settings.storage_bucket,
                    Key=asset["asset_key"],
                )
                try:
                    content = await asyncio.to_thread(obj["Body"].read, MAX_BYTES + 1)
                finally:
                    obj["Body"].close()
                if (
                    len(content) != asset["byte_size"]
                    or len(content) > MAX_BYTES
                    or obj.get("ContentType") != asset["content_type"]
                    or hashlib.sha256(content).hexdigest()
                    != asset["metadata"].get("checksum_sha256")
                ):
                    raise ApiError(409, "INPUT_CHANGED", "Image changed")
                validate_image(content, asset["content_type"])
                encoded = f"data:{asset['content_type']};base64," + base64.b64encode(
                    content
                ).decode("ascii")
            images.append(dict(slot=item.slot, image=encoded))
        payload = dict(
            template="minimal-v1",
            format=row["output_format"],
            title=data.title,
            style_tag=data.style_tag,
            date=data.date.isoformat() if data.date else None,
            weather_label=data.weather_label,
            items=images,
        )
        result = await renderer(settings, payload)
        validate_image(result, "image/png")
        with Image.open(io.BytesIO(result)) as image:
            if image.size != (1080, 1350):
                raise ApiError(422, "INVALID_RENDER_RESULT", "Required dimensions not met")
            if row["output_format"] == "WEBP":
                output = io.BytesIO()
                image.save(output, "WEBP", lossless=True)
                result = output.getvalue()
        if len(result) > MAX_BYTES:
            raise ApiError(422, "INVALID_RENDER_RESULT", "Image too large")
        await asyncio.to_thread(
            resources.storage.put_object,
            Bucket=settings.storage_bucket,
            Key=key,
            Body=result,
            ContentType=mime,
        )
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            for owner in sorted({actor.member_id, *(a["owner_id"] for a in inputs if a)}, key=str):
                await repo.lock("consent:" + str(owner))
            await card_inputs(repo, actor, data)
            current = await repo.one(
                "SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"]
            )
            asset = await repo.one(
                "SELECT status FROM wardrobe.asset WHERE id=:id FOR UPDATE", id=asset_id
            )
            if (
                current["status"] != "RUNNING"
                or current["lease_owner"] != row["lease_owner"]
                or asset["status"] != "PENDING_UPLOAD"
            ):
                await repo.execute(
                    "UPDATE wardrobe.asset SET status='DELETED' WHERE id=:id", id=asset_id
                )
                return
            await repo.execute(
                "UPDATE wardrobe.asset SET "
                "status='READY',byte_size=:size,finalized_at=now(),retention_expires_at=:expiry,metadata=metadata"
                " || CAST(:p AS jsonb) WHERE id=:id",
                id=asset_id,
                size=len(result),
                expiry=utc_now() + timedelta(days=30),
                p=canonical(
                    dict(
                        checksum_sha256=hashlib.sha256(result).hexdigest(), width=1080, height=1350
                    )
                ),
            )
            await repo.execute(
                "UPDATE wardrobe.outfit_card SET "
                "status='READY',image_asset_id=:a,updated_at=now() WHERE id=:id",
                id=row["card_id"],
                a=asset_id,
            )
            await repo.execute(
                "UPDATE wardrobe.job SET "
                "status='SUCCEEDED',progress_pct=100,result_ref=:a,lease_owner=NULL,leased_until=NULL,finished_at=now(),updated_at=now()"
                " WHERE id=:id",
                id=row["id"],
                a=str(asset_id),
            )
            await worker_event(
                repo,
                row,
                "CardGenerated",
                dict(card_id=str(row["card_id"]), asset_id=str(asset_id)),
            )

    code = None
    retryable = False
    try:
        await asyncio.wait_for(perform(), settings.card_render_timeout_seconds)
    except TimeoutError:
        code, retryable = "RENDER_TIMEOUT", True
    except ApiError as error:
        code = error.code
    except Exception:
        code, retryable = "RENDER_OR_STORAGE_UNAVAILABLE", True
    if code:
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            if asset_id:
                await repo.execute(
                    "UPDATE wardrobe.asset SET status='DELETED' WHERE id=:id", id=asset_id
                )
            current = await repo.one(
                "SELECT * FROM wardrobe.job WHERE id=:id FOR UPDATE", id=row["id"]
            )
            if current["status"] == "RUNNING" and current["lease_owner"] == row["lease_owner"]:
                retry = retryable and row["attempt_count"] < row["max_attempts"]
                await repo.execute(
                    "UPDATE wardrobe.job SET status=CAST(:s AS "
                    "wardrobe.job_status),error_code=:c,error_message_safe='Card rendering "
                    "failed',lease_owner=NULL,leased_until=NULL,next_attempt_at=:next,finished_at=:finished,updated_at=now()"
                    " WHERE id=:id",
                    id=row["id"],
                    s="QUEUED" if retry else "FAILED",
                    c=code,
                    next=utc_now() + timedelta(seconds=2 ** row["attempt_count"]),
                    finished=None if retry else utc_now(),
                )
                if not retry:
                    await repo.execute(
                        "UPDATE wardrobe.outfit_card SET status='FAILED',updated_at=now() WHERE"
                        " id=:id",
                        id=row["card_id"],
                    )
                await worker_event(
                    repo,
                    row,
                    "CardRetryScheduled" if retry else "CardGenerationFailed",
                    dict(code=code, attempt=row["attempt_count"]),
                )
