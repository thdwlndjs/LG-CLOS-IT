"""Synthetic S3 probe, dedicated loopback bucket only; never touches DB records."""

import io
import json
import sys

import boto3
from botocore.config import Config
from PIL import Image

from handoff_local import RUNTIME

runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
arguments = dict(
    aws_access_key_id="handoff-local",
    aws_secret_access_key=runtime["storage_secret"],
    region_name="us-east-1",
    config=Config(signature_version="s3v4"),
)
client = boto3.client("s3", endpoint_url="http://127.0.0.1:19000", **arguments)
key = "assets/handoff-synthetic-transport-probe.png"
probe = RUNTIME.parent / "storage-probe.json"
try:
    if sys.argv[1:] == ["cleanup"]:
        client.delete_object(Bucket="wardrobe-assets", Key=key)
        probe.unlink(missing_ok=True)
        print("Dedicated synthetic transport probe removed")
    else:
        output = io.BytesIO()
        Image.new("RGB", (8, 8), "blue").save(output, "PNG")
        client.put_object(
            Bucket="wardrobe-assets",
            Key=key,
            Body=output.getvalue(),
            ContentType="image/png",
        )
        signer = boto3.client("s3", endpoint_url="http://localhost:9000", **arguments)
        try:
            url = signer.generate_presigned_url(
                "get_object",
                Params={"Bucket": "wardrobe-assets", "Key": key},
                ExpiresIn=60,
            )
        finally:
            signer.close()
        probe.write_text(json.dumps({"signed_url": url}), encoding="utf-8")
        print("Dedicated synthetic transport probe prepared; URL kept in ignored file")
finally:
    client.close()
