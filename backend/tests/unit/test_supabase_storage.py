from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.infrastructure.adapters.object_storage import storage_client, verify_supabase_bucket


def cloud_values(settings_values):
    return settings_values | dict(
        storage_provider="SUPABASE",
        storage_region="ap-southeast-1",
        storage_endpoint="https://example.storage.supabase.co/storage/v1/s3",
        storage_public_base_url="https://example.storage.supabase.co/storage/v1/s3",
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="unit-server-only-key",
    )


def test_supabase_s3_signatures_preserve_prefix_region_and_upload_contract(settings_values):
    settings = Settings(**cloud_values(settings_values))
    client = storage_client(settings, signing=True)
    try:
        url = client.generate_presigned_url(
            "put_object",
            Params={"Bucket": settings.storage_bucket, "Key": "staging/test",
                    "ContentType": "image/png", "ContentLength": 25},
            ExpiresIn=300,
        )
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        assert parsed.path == "/storage/v1/s3/wardrobe-assets/staging/test"
        assert "/ap-southeast-1/s3/aws4_request" in query["X-Amz-Credential"][0]
        assert query["X-Amz-Expires"] == ["300"]
        assert query["X-Amz-SignedHeaders"] == ["content-length;content-type;host"]
        assert "unit-server-only-key" not in url
    finally:
        client.close()


@pytest.mark.parametrize("patch", [
    {"supabase_service_role_key": ""},
    {"supabase_url": "http://example.supabase.co"},
    {"supabase_url": "https://example.supabase.co/path"},
    {"storage_endpoint": "https://other.storage.supabase.co/storage/v1/s3"},
    {"storage_public_base_url": "https://api.example"},
    {"storage_endpoint": "https://example.storage.supabase.co/storage/v1/s3?token=test"},
])
def test_supabase_rejects_wrong_project_or_unsafe_credentials(settings_values, patch):
    with pytest.raises(ValidationError):
        Settings(**(cloud_values(settings_values) | patch))


@pytest.mark.parametrize("status,payload,allowed", [
    (200, {"id": "wardrobe-assets", "public": False}, True),
    (200, {"id": "wardrobe-assets", "public": True}, False),
    (200, {"id": "wardrobe-assets"}, False),
    (200, {"id": "other", "public": False}, False),
    (403, {"message": "denied"}, False),
    (404, {"message": "missing"}, False),
])
def test_supabase_bucket_check_fails_closed(settings_values, monkeypatch, status, payload, allowed):
    settings = Settings(**cloud_values(settings_values))
    original_client = httpx.Client
    requests = []

    def respond(request):
        requests.append(request)
        assert request.method == "GET"
        assert str(request.url) == "https://example.supabase.co/storage/v1/bucket/wardrobe-assets"
        assert request.headers["Authorization"] == "Bearer unit-server-only-key"
        return httpx.Response(status, json=payload)

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(
        **kwargs, transport=httpx.MockTransport(respond)
    ))
    if allowed:
        verify_supabase_bucket(settings)
    else:
        with pytest.raises(RuntimeError) as error:
            verify_supabase_bucket(settings)
        assert "unit-server-only-key" not in str(error.value)
    assert len(requests) == 1
