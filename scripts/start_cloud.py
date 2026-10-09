"""Render entry point. Resolve private service addresses without YAML interpolation."""

import os
import subprocess
import sys
import time
from urllib.parse import urlparse


def configure(environ):
    values = dict(environ)
    database = values.get("DATABASE_URL", "")
    for prefix in ("postgres://", "postgresql://"):
        if database.startswith(prefix):
            database = "postgresql+asyncpg://" + database[len(prefix) :]
    values["DATABASE_URL"] = database
    redis = values["REDIS_URL"]
    values["CELERY_BROKER_URL"] = redis
    parsed = urlparse(redis)
    values["CELERY_RESULT_BACKEND"] = parsed._replace(path="/1").geturl()
    external_storage = values.get("STORAGE_PROVIDER", "MINIO") == "SUPABASE"
    if external_storage:
        if not values.get("STORAGE_ENDPOINT") or not values.get("STORAGE_REGION"):
            raise ValueError("Supabase requires STORAGE_ENDPOINT and STORAGE_REGION")
    else:
        values["STORAGE_ENDPOINT"] = "http://" + values["MINIO_HOSTPORT"]
    values["CARD_RENDERER_URL"] = "http://" + values["RENDERER_HOSTPORT"]
    origin = values.get("API_PUBLIC_ORIGIN") or values.get("RENDER_EXTERNAL_URL", "")
    parsed = urlparse(origin)
    if (
        parsed.scheme != "https"
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or parsed.username
    ):
        raise ValueError("API_PUBLIC_ORIGIN must be an HTTPS origin")
    values["STORAGE_PUBLIC_BASE_URL"] = (
        values["STORAGE_ENDPOINT"] if external_storage else origin.rstrip("/")
    )
    values.update(
        APP_ENV="staging",
        PUBLIC_DEPLOYMENT="true",
        AUTH_MODE="JWT",
        DEMO_AUTH_ENABLED="false",
    )
    return values


def private_bucket():
    from botocore.exceptions import ClientError

    from app.core.config import load_settings
    from app.infrastructure.adapters.object_storage import storage_client, verify_supabase_bucket

    settings = load_settings()
    if settings.storage_provider == "SUPABASE":
        verify_supabase_bucket(settings)
        client = storage_client(settings)
        try:
            client.head_bucket(Bucket=settings.storage_bucket)
        finally:
            client.close()
        return
    client = storage_client(settings)
    try:
        for attempt in range(30):
            try:
                try:
                    client.head_bucket(Bucket=settings.storage_bucket)
                except ClientError as error:
                    if str(error.response["Error"]["Code"]) not in {
                        "404",
                        "NoSuchBucket",
                        "NotFound",
                    }:
                        raise
                    client.create_bucket(Bucket=settings.storage_bucket)
                # No anonymous policies are created. Reject an existing public policy.
                try:
                    client.get_bucket_policy(Bucket=settings.storage_bucket)
                except ClientError as error:
                    if error.response["Error"]["Code"] != "NoSuchBucketPolicy":
                        raise
                else:
                    raise RuntimeError("Bucket policy requires explicit review")
                return
            except RuntimeError:
                raise
            except Exception:
                if attempt == 29:
                    raise RuntimeError(
                        "Private storage initialization failed"
                    ) from None
                time.sleep(2)
    finally:
        client.close()


def main():
    os.environ.update(configure(os.environ))
    role = sys.argv[1] if len(sys.argv) > 1 else "api"
    if role not in {"api", "worker"}:
        raise ValueError("Unknown service role")
    private_bucket()
    if role == "api":
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
        command = [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:create_app",
            "--factory",
            "--host",
            "0.0.0.0",
            "--port",
            os.getenv("PORT", "10000"),
            "--no-access-log",
        ]
    else:
        command = [
            sys.executable,
            "-m",
            "celery",
            "-A",
            "app.workers.celery_app:celery_app",
            "worker",
            "--loglevel=INFO",
            "--concurrency=1",
            "--beat",
            "--schedule=/tmp/wardrobe-celerybeat",
        ]
    os.execv(sys.executable, command)


if __name__ == "__main__":
    main()
