from app.core.config import Settings


def storage_client(settings: Settings, *, signing=False):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=(settings.storage_public_base_url if signing else settings.storage_endpoint),
        aws_access_key_id=settings.storage_access_key.get_secret_value(),
        aws_secret_access_key=settings.storage_secret_key.get_secret_value(),
        region_name=settings.storage_region,
        config=Config(
            signature_version="s3v4",
            connect_timeout=2,
            read_timeout=2,
            retries={"max_attempts": 0},
            s3={"addressing_style": "path"},
        ),
    )


def verify_supabase_bucket(settings: Settings):
    """Require a pre-created private bucket; never silently make a public bucket private."""
    from urllib.parse import quote

    import httpx

    key = settings.supabase_service_role_key.get_secret_value()
    url = settings.supabase_url.rstrip("/") + "/storage/v1/bucket/" + quote(
        settings.storage_bucket, safe=""
    )
    try:
        with httpx.Client(timeout=5, follow_redirects=False) as client:
            response = client.get(url, headers={"Authorization": "Bearer " + key, "apikey": key})
            response.raise_for_status()
            bucket = response.json()
        if bucket.get("id") != settings.storage_bucket or bucket.get("public") is not False:
            raise RuntimeError("Supabase bucket must exist and be private")
    except (httpx.HTTPError, ValueError, AttributeError):
        raise RuntimeError("Supabase private bucket verification failed") from None
