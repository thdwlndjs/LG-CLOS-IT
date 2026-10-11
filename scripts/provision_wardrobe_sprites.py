"""Install generated scene derivatives in the isolated local DB, preserving originals."""

import asyncio
import hashlib
import json
from uuid import UUID

import httpx
from PIL import Image
from sqlalchemy import text

from remediation_local import PACKAGE, ROOT, call, engine, identity, login, upload

MANIFEST = PACKAGE / "templates/wardrobe_sprite_manifest.json"


def masks(path, batch):
    with Image.open(path) as image:
        alpha = image.getchannel("A")
        pixels = alpha.load()
        result = []
        for i, item in enumerate(batch["items"]):
            modes = {}
            for mode in ("hanging", "folded"):
                if batch["batch"] == "batch-07":
                    edges = (
                        [0, 236, 440, 665, 1065]
                        if mode == "hanging"
                        else [0, 300, 455, 645, 1045]
                    )
                elif batch["batch"] == "batch-06":
                    edges = [0, 198, 416, 603, 777, 977, 1130, 1310, 1536]
                else:
                    edges = list(range(0, 1537, 192))
                x0, x1 = edges[i : i + 2]
                y0, y1 = (0, 710) if mode == "hanging" else (720, 1024)
                left, top, right, bottom = x1, y1, x0, y0
                parts = []
                for y in range(y0, y1):
                    x = x0
                    while x < x1:
                        while x < x1 and pixels[x, y] < 64:
                            x += 1
                        start = x
                        while x < x1 and pixels[x, y] >= 64:
                            x += 1
                        if x > start:
                            parts.append(f"M{start} {y}h{x - start}v1h{start - x}z")
                            left = min(left, start)
                            right = max(right, x)
                            top = min(top, y)
                            bottom = max(bottom, y + 1)
                if right <= left or bottom <= top:
                    raise RuntimeError(
                        f"Empty generated sprite: {item['item_id']}/{mode}"
                    )
                modes[mode] = {
                    "width": 1536,
                    "height": 1024,
                    "path": "".join(parts),
                    "crop": [left, top, right - left, bottom - top],
                    "basis": "generated atlas alpha silhouette; original rasters unchanged",
                    "scene_alignment": "hanging" if mode == "hanging" else "shelf",
                }
            result.append((item, modes))
        return result


async def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    db = engine()
    try:
        auth = login("mom")
        with httpx.Client(
            timeout=60, headers={"Authorization": "Bearer " + auth["access_token"]}
        ) as client:
            settings = call(client, "GET", "/settings")
            if not settings["image_upload_consent"]:
                raise RuntimeError("Image consent required")
            for batch in manifest["batches"]:
                path = ROOT / batch["local_atlas"]
                if (
                    hashlib.sha256(path.read_bytes()).hexdigest()
                    != batch["atlas_sha256"]
                ):
                    raise RuntimeError("Derivative changed")
                if "atlas_asset_id" not in batch:
                    batch["atlas_asset_id"] = upload(client, path)["asset_id"]
                    MANIFEST.write_text(
                        json.dumps(manifest, indent=2), encoding="utf-8"
                    )
                asset_id = UUID(batch["atlas_asset_id"])
                async with db.begin() as c:
                    await c.execute(
                        text(
                            "UPDATE wardrobe.asset SET kind='OTHER', metadata=metadata || CAST(:m AS jsonb) WHERE id=:a AND household_id=:h AND status='READY'"
                        ),
                        {
                            "a": asset_id,
                            "h": identity("household"),
                            "m": json.dumps(
                                {
                                    "scene_role": "generated-wardrobe-sprites",
                                    "generation_tool": "built-in image_gen",
                                    "source_items": [
                                        i["item_id"] for i in batch["items"]
                                    ],
                                    "is_demo": True,
                                    "visual_review": "local_display_candidate_not_product_fidelity_certified",
                                }
                            ),
                        },
                    )
                    for item, variants in masks(path, batch):
                        item["cells"] = {mode: mask["crop"] for mode, mask in variants.items()}
                        item["mask_sha256"] = {
                            mode: hashlib.sha256(mask["path"].encode()).hexdigest()
                            for mode, mask in variants.items()
                        }
                        row = (
                            (
                                await c.execute(
                                    text(
                                        "SELECT a.id,a.metadata FROM wardrobe.asset a JOIN wardrobe.garment g ON g.image_asset_id=a.id WHERE g.id=:g AND g.household_id=:h"
                                    ),
                                    {
                                        "g": identity(item["item_id"]),
                                        "h": identity("household"),
                                    },
                                )
                            )
                            .mappings()
                            .one()
                        )
                        if row["metadata"]["checksum_sha256"] != item["source_sha256"]:
                            raise RuntimeError(
                                "Source changed; refusing stale derivative"
                            )
                        sprites = {
                            mode: {
                                "asset_id": str(asset_id),
                                "source_sha256": item["source_sha256"],
                                "mask": mask,
                            }
                            for mode, mask in variants.items()
                        }
                        await c.execute(
                            text(
                                "UPDATE wardrobe.asset SET metadata=jsonb_set(metadata,'{scene_sprites}',CAST(:sprites AS jsonb)) WHERE id=:a AND household_id=:h"
                            ),
                            {
                                "a": row["id"],
                                "h": identity("household"),
                                "sprites": json.dumps(sprites),
                            },
                        )
                batch["status"] = "LOCAL_DISPLAY_CANDIDATE"
                batch["display_geometry_basis"] = "alpha silhouette bounds; see item.cells"
                MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
                print(
                    batch["batch"]
                    + ": private generated sprites linked; original garment image IDs preserved"
                )
    finally:
        await db.dispose()


if __name__ == "__main__":
    asyncio.run(main())
