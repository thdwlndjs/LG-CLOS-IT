"""Verify the actual Celery cleanup consumer using one disposable, private asset."""

import asyncio
import json
from uuid import UUID, uuid4

from botocore.exceptions import ClientError
from sqlalchemy import text

from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources
from app.workers.celery_app import celery_app


async def main():
    settings = load_settings()
    if settings.app_env not in {"local", "test"} or settings.public_deployment:
        raise RuntimeError("Cleanup verification is private development only")
    resources = RuntimeResources(settings)
    asset_id = uuid4()
    keys = [
        "verification/cleanup/" + str(asset_id) + "/" + name
        for name in ("staging", "final")
    ]
    try:
        async with resources.database.engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO wardrobe.asset(id,household_id,owner_id,asset_key,content_type,"
                    "kind,metadata,upload_expires_at) VALUES (:id,:h,:owner,:key,'image/png',"
                    "'GARMENT',CAST(:metadata AS jsonb),now()-interval '1 minute')"
                ),
                dict(
                    id=asset_id,
                    h=UUID("10000000-0000-4000-8000-000000000001"),
                    owner=UUID("20000000-0000-4000-8000-000000000001"),
                    key=keys[1],
                    metadata=json.dumps({"staging_key": keys[0]}),
                ),
            )
        for key in keys:
            await asyncio.to_thread(
                resources.storage.put_object,
                Bucket=settings.storage_bucket,
                Key=key,
                Body=b"temporary cleanup verification fixture",
            )
        result = celery_app.send_task("wardrobe.cleanup_assets")
        await asyncio.to_thread(result.get, timeout=30)
        async with resources.database.engine.connect() as conn:
            assert (
                await conn.scalar(
                    text("SELECT status::text FROM wardrobe.asset WHERE id=:id"),
                    dict(id=asset_id),
                )
                == "DELETED"
            )
        for key in keys:
            try:
                await asyncio.to_thread(
                    resources.storage.head_object,
                    Bucket=settings.storage_bucket,
                    Key=key,
                )
            except ClientError as exc:
                assert exc.response["Error"]["Code"] in {"404", "NoSuchKey"}
            else:
                raise AssertionError("Expired object still exists")
        print("Actual Celery consumer deleted expired staging and final objects")
    finally:
        for key in keys:
            await asyncio.to_thread(
                resources.storage.delete_object, Bucket=settings.storage_bucket, Key=key
            )
        async with resources.database.engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM wardrobe.asset WHERE id=:id"), dict(id=asset_id)
            )
        await resources.close()


if __name__ == "__main__":
    asyncio.run(main())
