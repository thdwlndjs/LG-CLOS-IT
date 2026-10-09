"""Create the private local bucket; grant no anonymous read policy."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from botocore.exceptions import ClientError  # noqa: E402

from app.core.config import load_settings  # noqa: E402
from app.infrastructure.adapters.object_storage import storage_client  # noqa: E402


def main():
    settings = load_settings()
    if settings.app_env not in {"local", "test"} or settings.public_deployment:
        raise RuntimeError("Local bucket initialization only")
    client = storage_client(settings)
    try:
        try:
            client.head_bucket(Bucket=settings.storage_bucket)
        except ClientError as exc:
            if str(exc.response["Error"]["Code"]) not in {"404", "NoSuchBucket", "NotFound"}:
                raise
            client.create_bucket(Bucket=settings.storage_bucket)
    finally:
        client.close()
    print("Private storage bucket is available")


if __name__ == "__main__":
    main()

