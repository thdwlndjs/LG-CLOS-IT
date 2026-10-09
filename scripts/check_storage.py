"""Verify real private local S3 object upload/download/delete; clean up only our key."""
import hashlib
import json
import secrets
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from botocore.exceptions import ClientError  # noqa: E402

from app.core.config import load_settings  # noqa: E402
from app.infrastructure.adapters.object_storage import storage_client  # noqa: E402


def main():
    settings = load_settings()
    if settings.app_env not in {"local", "test"} or settings.public_deployment:
        raise RuntimeError("Storage verification is allowed only in private local/test")
    client = storage_client(settings)
    bucket = settings.storage_bucket
    key = "sprint0-verification/" + uuid4().hex
    payload = secrets.token_bytes(65536)
    created = False
    try:
        client.head_bucket(Bucket=bucket)
        client.put_object(Bucket=bucket, Key=key, Body=payload,
                          ContentType="application/octet-stream")
        created = True
        if client.head_object(Bucket=bucket, Key=key)["ContentLength"] != len(payload):
            raise RuntimeError("Uploaded object length does not match")
        response = client.get_object(Bucket=bucket, Key=key)
        try:
            downloaded = response["Body"].read()
        finally:
            response["Body"].close()
        if downloaded != payload:
            raise RuntimeError("Downloaded bytes do not match uploaded bytes")
        url = settings.storage_endpoint.rstrip("/") + "/" + quote(bucket) + "/" + key
        try:
            with urlopen(url, timeout=5) as response:
                raise RuntimeError(f"Anonymous object read returned HTTP {response.status}")
        except HTTPError as exc:
            exc.close()
            if exc.code != 403:
                raise RuntimeError(f"Expected anonymous read denial, got {exc.code}") from exc
        client.delete_object(Bucket=bucket, Key=key)
        try:
            client.head_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            delete_status = exc.response["ResponseMetadata"]["HTTPStatusCode"]
            if delete_status != 404:
                raise
        else:
            raise RuntimeError("Deleted object is still present")
        created = False
        print(json.dumps({"bucket": bucket, "bytes": len(payload),
                          "sha256": hashlib.sha256(payload).hexdigest(),
                          "upload": "passed", "download_exact_bytes": "passed",
                          "anonymous_read_http": 403, "delete_then_head_http": delete_status}))
    finally:
        try:
            if created:
                client.delete_object(Bucket=bucket, Key=key)
        finally:
            client.close()


if __name__ == "__main__":
    main()
