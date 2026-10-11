"""Public official catalog evidence; no credentials, scraping bypass or inferred facts."""

import concurrent.futures
import hashlib
import io
import json
from pathlib import Path

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"
OUT = ROOT / "test-results/remediation/source-images"
CACHE = ROOT / "test-results/remediation/catalog.json"
GENERIC = {
    "Men's",
    "Women's",
    "Kids & Baby",
    "other",
    "Fleece",
    "Shirts",
    "Sweaters & Pullovers",
    "Jackets",
    "Vests",
    "Pants",
    "Shorts",
    "Accessories",
    "Packs & Gear",
    "Black",
    "Blue",
    "Green",
    "Grey",
    "Neutral",
    "Pink",
    "Purple",
    "Red",
    "White",
    "Yellow",
    "Brown",
    "Orange",
}


def select(products):
    groups = {"TOP": [], "BOTTOM": [], "OUTER": [], "ACCESSORY": []}
    for p in products:
        tags = set(p["tags"])
        if "Kids & Baby" in tags:
            continue
        category = (
            "ACCESSORY"
            if tags & {"Accessories", "Packs & Gear"}
            else "BOTTOM"
            if tags & {"Pants", "Shorts"}
            else "OUTER"
            if tags & {"Jackets", "Vests"}
            else "TOP"
            if tags & {"Shirts", "Sweaters & Pullovers"}
            else None
        )
        if category and p["images"]:
            groups[category].append(p)
    picked = []
    for category, count in [
        ("TOP", 18),
        ("BOTTOM", 9),
        ("OUTER", 16),
        ("ACCESSORY", 8),
    ]:
        assert len(groups[category]) >= count, (category, len(groups[category]))
        for p in groups[category][:count]:
            color_names = [t for t in p["tags"] if t not in GENERIC]
            color = " / ".join(
                color_names
                or [
                    t
                    for t in p["tags"]
                    if t in GENERIC
                    and t
                    not in {"Men's", "Women's", "other", "Accessories", "Packs & Gear"}
                ]
            )
            owner = "mom" if "Women's" in p["tags"] else "son"
            role = (
                "summer"
                if "Shorts" in p["tags"]
                or (
                    "Shirts" in p["tags"]
                    and "Long-Sleeved" not in p["title"]
                    and "Cashmere" not in p["title"]
                )
                else "winter"
                if category == "OUTER"
                or any(
                    x in p["title"].lower()
                    for x in ["cashmere", "fleece", "down", "puff", "micro d", "snow"]
                )
                else "transitional"
            )
            picked.append(
                {
                    "item_id": f"REM-{len(picked) + 1:02}",
                    "brand": p["vendor"],
                    "name": p["title"],
                    "model": p["product_type"],
                    "color": color,
                    "color_sku": p["handle"].rsplit("_", 1)[-1].upper(),
                    "category": category,
                    "owner": owner,
                    "season_role": role,
                    "material": None,
                    "care": {},
                    "missing_facts": ["material", "care"],
                    "product_url": "https://wornwear.patagonia.com/products/"
                    + p["handle"],
                    "catalog_url": "https://wornwear.patagonia.com/products.json?limit=250",
                    "image_url": p["images"][0]["src"],
                    "source_listing_condition": p["variants"][0]["option2"],
                    "facts_checked_at": "2026-10-11",
                    "ownership_and_state_basis": "synthetic_demo",
                    "image_basis": "official_Worn_Wear_actual_listing_photo",
                    "rights": "Source attribution is not a commercial license; isolated local PoC only. Public/commercial reuse requires permission.",
                }
            )
    # Four-person household without pretending the catalog audience proves ownership.
    for item in [x for x in picked if x["owner"] == "son"][-5:]:
        item["owner"] = "dad"
    for item in [x for x in picked if x["owner"] == "mom"][-4:]:
        item["owner"] = "daughter"
    outer = [x for x in picked if x["category"] == "OUTER"]
    for x in picked:
        x["initial_storage"] = (
            "accessory"
            if x["category"] == "ACCESSORY"
            else "external"
            if x in outer[-8:]
            else "internal"
        )
    picked.append(
        {
            "item_id": "REM-52",
            "candidate_id": "PC11",
            "brand": "Dr. Martens",
            "name": "1461 Smooth Leather Oxford Shoes",
            "model": "11838002",
            "color": "Black",
            "color_sku": "11838002",
            "category": "SHOES",
            "owner": "son",
            "season_role": "transitional",
            "material": "Smooth leather upper; other components unverified",
            "care": {},
            "missing_facts": ["other component composition", "care"],
            "product_url": "https://www.drmartens.com/us/en/1461-smooth-leather-oxford-shoes-black/p/11838002",
            "image_url": "https://cdn.media.amplience.net/i/drmartens/NX_11838002.80?fmt=png&qlt=80&sm=center&w=768",
            "facts_checked_at": "2026-10-11",
            "ownership_and_state_basis": "synthetic_demo",
            "image_basis": "official_product_CDN_photo",
            "initial_storage": "accessory",
            "rights": "Attribution is not a license. Private local PoC; publication/commercial use requires permission.",
        }
    )
    return picked


def download(row):
    OUT.mkdir(parents=True, exist_ok=True)
    url = row["image_url"]
    assert (
        url.startswith("https://cdn.shopify.com/s/files/1/0751/2601/4248/")
        or url
        == "https://cdn.media.amplience.net/i/drmartens/NX_11838002.80?fmt=png&qlt=80&sm=center&w=768"
    ), url
    path = OUT / (row["item_id"] + ".jpg")
    if not path.exists():
        with httpx.Client(timeout=45, follow_redirects=False) as client:
            r = client.get(url)
            r.raise_for_status()
            assert r.headers.get("content-type", "").startswith("image/")
            Image.open(io.BytesIO(r.content)).verify()
            # Preserve bytes, including PNG where extension is not the MIME source.
            path.write_bytes(r.content)
    with Image.open(path) as im:
        assert min(im.size) >= 100, "Reject placeholders"
        row["image_dimensions"] = list(im.size)
        row["image_content_type"] = Image.MIME[im.format]
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    if row.get("image_sha256") and row["image_sha256"] != checksum:
        raise RuntimeError(
            row["item_id"] + ": source changed; refusing silent manifest replacement"
        )
    row["image_sha256"] = checksum
    row["local_image"] = path.relative_to(ROOT).as_posix()
    row["transform_history"] = ["none: original downloaded bytes"]
    return row


if __name__ == "__main__":
    out = PACKAGE / "templates/remediation_products.json"
    if out.exists():
        rows = json.loads(out.read_text(encoding="utf-8"))["items"]
    else:
        if not CACHE.exists():
            r = httpx.get(
                "https://wornwear.patagonia.com/products.json?limit=250", timeout=45
            )
            r.raise_for_status()
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_bytes(r.content)
        rows = select(json.loads(CACHE.read_text(encoding="utf-8"))["products"])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(download, rows))
    out.write_text(
        json.dumps(
            {
                "source": "official public Worn Wear product catalog",
                "count": len(rows),
                "items": rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    from collections import Counter

    print(
        json.dumps(
            {
                "images_verified": len(rows),
                "groups": dict(Counter(x["initial_storage"] for x in rows)),
                "owners": dict(Counter(x["owner"] for x in rows)),
            }
        )
    )
