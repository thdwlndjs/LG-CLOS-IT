"""Verify public-origin S3 signatures against private LOCAL MinIO, then clean up."""

import asyncio
import hashlib
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import httpx
from pydantic import SecretStr
from app.infrastructure.resources import RuntimeResources
from app.core.config import load_settings
from app.infrastructure.adapters.object_storage import storage_client
from app.main import create_app


async def main():
    settings = load_settings()
    if settings.app_env not in {"local", "test"} or settings.public_deployment:
        raise RuntimeError("This probe is restricted to local private services")
    settings = settings.model_copy(
        update={
            "storage_public_base_url": "https://relay.example",
            "storage_endpoint": "http://127.0.0.1:9000",
            "redis_url": SecretStr("redis://127.0.0.1:6379/0"),
        }
    )
    s3 = storage_client(settings)
    signer = storage_client(settings, signing=True)
    uid = str(uuid4())
    staging = f"staging/{uid}/{uid}/{uid}"
    asset = f"assets/{uid}/{uid}/{uid}/" + uuid4().hex
    data = b"private-relay-signature-verification"
    app = create_app(settings)
    app.state.resources = RuntimeResources(settings)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://relay.example"
        ) as client:
            put = signer.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": settings.storage_bucket,
                    "Key": staging,
                    "ContentType": "image/png",
                    "ContentLength": len(data),
                },
                ExpiresIn=300,
            )
            response = await client.put(
                put, content=data, headers={"Content-Type": "image/png"}
            )
            assert response.status_code == 200, response.status_code
            assert (
                s3.get_object(Bucket=settings.storage_bucket, Key=staging)[
                    "Body"
                ].read()
                == data
            )
            s3.copy_object(
                Bucket=settings.storage_bucket,
                Key=asset,
                CopySource={"Bucket": settings.storage_bucket, "Key": staging},
            )
            get = signer.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.storage_bucket, "Key": asset},
                ExpiresIn=60,
            )
            response = await client.get(get)
            assert response.status_code == 200
            assert (
                hashlib.sha256(response.content).digest()
                == hashlib.sha256(data).digest()
            )
            signature = httpx.URL(get).params["X-Amz-Signature"]
            tampered = ("0" if signature[0] != "0" else "1") + signature[1:]
            response = await client.get(get.replace(signature, tampered))
            assert response.status_code == 403
            assert (await client.get("/wardrobe-assets/")).status_code in {403, 404}
            assert (
                await client.put(
                    put,
                    content=b"x" * (10 * 1024 * 1024 + 1),
                    headers={"Content-Type": "image/png"},
                )
            ).status_code == 413
        print(
            "Real MinIO relay: signed PUT/GET, checksum, tampered signature, listing and size limit PASS"
        )
    finally:
        for key in (staging, asset):
            s3.delete_object(Bucket=settings.storage_bucket, Key=key)
        s3.close()
        signer.close()
        await app.state.resources.close()


if __name__ == "__main__":
    asyncio.run(main())
