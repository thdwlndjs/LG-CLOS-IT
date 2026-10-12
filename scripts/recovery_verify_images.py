"""Read-only database/S3 image integrity checks on the recovered persistent target."""

import asyncio
import hashlib
import io
import json

import asyncpg
import boto3
from botocore.config import Config
from PIL import Image

from recovery_seed_demo import ROOT, plan


async def inspect():
    runtime = json.loads(
        (ROOT / "test-results/recovery-normalization/runtime.json").read_text(
            encoding="utf-8"
        )
    )
    connection = await asyncpg.connect(
        host="127.0.0.1",
        port=57433,
        database="wardrobe_demo_recovered",
        user="wardrobe",
        password=runtime["postgres_password"],
        timeout=10,
    )
    try:
        async with connection.transaction(readonly=True):
            await connection.execute("SET LOCAL statement_timeout='10s'")
            assets = [
                dict(row)
                for row in await connection.fetch(
                    "SELECT id,asset_key,content_type,metadata FROM wardrobe.asset WHERE status='READY' ORDER BY id"
                )
            ]
            garments = [
                dict(row)
                for row in await connection.fetch(
                    "SELECT id,image_asset_id FROM wardrobe.garment"
                )
            ]
    finally:
        await connection.close()
    storage = boto3.client(
        "s3",
        endpoint_url="http://127.0.0.1:19100",
        aws_access_key_id=runtime["storage_access"],
        aws_secret_access_key=runtime["storage_secret"],
        region_name="us-east-1",
        config=Config(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=10,
            retries={"max_attempts": 0},
            s3={"addressing_style": "path"},
        ),
    )
    listed = {}
    for page in storage.get_paginator("list_objects_v2").paginate(
        Bucket="wardrobe-assets"
    ):
        listed.update({item["Key"]: item["Size"] for item in page.get("Contents", [])})
    checks, errors = [], []
    by_id = {}
    for asset in assets:
        item = {"asset_id": str(asset["id"]), "key": asset["asset_key"]}
        try:
            response = storage.get_object(
                Bucket="wardrobe-assets", Key=asset["asset_key"]
            )
            with response["Body"] as body:
                data = body.read()
            item["bytes"] = len(data)
            item["sha256"] = hashlib.sha256(data).hexdigest()
            metadata = json.loads(asset["metadata"])
            expected = metadata.get("checksum_sha256")
            item["checksum_match"] = bool(expected) and item["sha256"] == expected
            item["list_size_match"] = listed.get(asset["asset_key"]) == len(data)
            if asset["content_type"].startswith("image/"):
                with Image.open(io.BytesIO(data)) as image:
                    image.load()
                    item["decoded"] = True
                    item["dimensions"] = list(image.size)
            else:
                item["decoded"] = None
            item["pass"] = (
                item["checksum_match"]
                and item["list_size_match"]
                and item["decoded"] is not False
            )
        except Exception as exception:
            item["pass"] = False
            item["error"] = type(exception).__name__
        if not item["pass"]:
            errors.append(item)
        checks.append(item)
        by_id[item["asset_id"]] = item
    inventory = plan()
    owned = {row["garment_id"] for row in inventory["rows"]}
    original_links = [
        str(row["image_asset_id"]) for row in garments if str(row["id"]) in owned
    ]
    scene_ids = {row["derivative_asset_id"] for row in inventory["right66"]}
    for row in inventory["rows"]:
        if row["group"] == "approved24" and row["garment_id"] in inventory["left21"]:
            scene_ids.add(row["approved_mapping"]["scene_asset_id"])
    missing_references = [
        asset_id
        for asset_id in set(original_links) | scene_ids
        if asset_id not in by_id or not by_id[asset_id]["pass"]
    ]
    report = {
        "mode": "READ_ONLY",
        "endpoint": "127.0.0.1:19100",
        "ready_assets": len(assets),
        "objects": len(listed),
        "listed_bytes": sum(listed.values()),
        "downloaded_bytes": sum(item.get("bytes", 0) for item in checks),
        "asset_checks": checks,
        "failed_assets": errors,
        "approved_original_links": len(original_links),
        "scene_unique_assets": len(scene_ids),
        "missing_references": missing_references,
        "shared_K_assets": "31 shelf garments deliberately reuse approved K1-K3; 87 garments need not have 87 unique Scene files",
        "pass": not errors and not missing_references and len(original_links) == 104,
    }
    output = ROOT / "test-results/recovery-normalization/image-validation.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                key: report[key]
                for key in (
                    "pass",
                    "ready_assets",
                    "objects",
                    "listed_bytes",
                    "approved_original_links",
                    "scene_unique_assets",
                    "missing_references",
                )
            }
        )
    )


if __name__ == "__main__":
    asyncio.run(inspect())
