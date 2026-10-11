"""Render only explicitly approved geometry; no coordinates inferred from garment names."""

import math
from collections import Counter
from uuid import UUID

from app.application.assets import signed_asset
from app.application.sprint1 import Sprint1
from app.core.errors import ApiError


def scene_sprite(metadata, mode, assets):
    checksum = metadata.get("checksum_sha256")
    variant = metadata.get("scene_sprites", {}).get(mode)
    if not isinstance(checksum, str) or len(checksum) != 64 or not isinstance(variant, dict):
        return None
    mask = variant.get("mask")
    if (
        variant.get("source_sha256") != checksum
        or variant.get("asset_id") not in assets
        or not isinstance(mask, dict)
    ):
        return None
    crop = mask.get("crop")
    if not isinstance(crop, list) or len(crop) != 4:
        return None
    if not all(type(v) in (float, int) and math.isfinite(v) for v in crop):
        return None
    x, y, width, height = crop
    if not (
        x >= 0
        and y >= 0
        and width > 0
        and height > 0
        and x + width <= mask.get("width", 0)
        and y + height <= mask.get("height", 0)
    ):
        return None
    return variant


def approved_slot(attributes):
    slot = attributes.get("display_slot") if isinstance(attributes, dict) else None
    if not isinstance(slot, dict) or slot.get("approved") is not True:
        return None
    values = [slot.get(k) for k in ("x", "y", "width", "height")]
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
        return None
    x, y, width, height = values
    if not (
        0 <= x <= 1
        and 0 <= y <= 1
        and 0 < width <= 1
        and 0 < height <= 1
        and x + width <= 1
        and y + height <= 1
    ):
        return None
    z = slot.get("z_index", 0)
    if type(z) is not int or not 0 <= z <= 100:
        return None
    return dict(x=x, y=y, width=width, height=height, z_index=z)


async def scene(request, repo, actor, device_id):
    locations = await repo.all(
        "SELECT l.id,l.attributes,z.anchor_id FROM wardrobe.storage_location l "
        "LEFT JOIN wardrobe.lighting_zone z ON z.location_id=l.id AND z.device_id=:device "
        "WHERE l.household_id=:h",
        device=device_id,
        h=actor.household_id,
    )
    slots = {r["id"]: (r, approved_slot(r["attributes"])) for r in locations}
    frame = await repo.one(
        "SELECT *,id AS asset_id FROM wardrobe.asset WHERE household_id=:h AND kind='OTHER' "
        "AND status='READY' AND metadata->>'scene_device_id'=:device "
        "AND metadata->>'scene_role'='clean-plate' "
        "AND metadata->>'visual_approval'='approved' ORDER BY created_at DESC LIMIT 1",
        h=actor.household_id,
        device=str(device_id),
    )
    garments, total = await repo.garments(actor, {"device_id": device_id}, 251, 0)
    if total > 250:
        raise ApiError(422, "SCENE_LIMIT_EXCEEDED", "Scene supports up to 250 items")
    placements = {
        r["garment_id"]: r
        for r in await repo.all(
            "SELECT p.*,l.attributes,z.anchor_id FROM wardrobe.scene_placement p "
            "JOIN wardrobe.storage_location l ON l.id=p.compartment_id "
            "LEFT JOIN wardrobe.lighting_zone z ON z.location_id=l.id AND z.device_id=:device "
            "WHERE l.household_id=:h",
            device=device_id,
            h=actor.household_id,
        )
    }
    counts = Counter(g["location_id"] for g in garments if g["location_id"])
    items, blocked = [], []
    asset_ids = [g["image_asset_id"] for g in garments if g["image_asset_id"]]
    image_metadata = (
        {
            str(r["id"]): r["metadata"]
            for r in await repo.all(
                "SELECT id,metadata FROM wardrobe.asset WHERE id=ANY(:ids) AND household_id=:h",
                ids=asset_ids,
                h=actor.household_id,
            )
        }
        if asset_ids
        else {}
    )
    sprite_ids = set()
    for metadata in image_metadata.values():
        for variant in metadata.get("scene_sprites", {}).values():
            try:
                sprite_ids.add(UUID(variant["asset_id"]))
            except (ValueError, KeyError, TypeError):
                continue
    sprite_assets = (
        {
            str(r["id"]): r
            for r in await repo.all(
                "SELECT *,id AS asset_id FROM wardrobe.asset WHERE id=ANY(:ids) "
                "AND household_id=:h AND status='READY' AND kind='OTHER' "
                "AND metadata->>'scene_role'='generated-wardrobe-sprites'",
                ids=list(sprite_ids),
                h=actor.household_id,
            )
        }
        if sprite_ids
        else {}
    )
    service = Sprint1(request)
    for garment in garments:
        placement = placements.get(garment["id"])
        if placement and placement["source_location_id"] != garment["location_id"]:
            placement = None
        bound = slots.get(garment["location_id"])
        if placement:
            bound = (
                {
                    "id": placement["compartment_id"],
                    "attributes": {"display_slot": {"alignment": "shelf"}},
                    "anchor_id": placement["anchor_id"],
                },
                approved_slot({"display_slot": placement["geometry"]}),
            )
        # External boxes and closed drawers are intentional non-visible storage,
        # not missing or guessed positions. They remain available in garment UI.
        if bound and bound[0]["attributes"].get("scene_visibility") in {"hidden", "external"}:
            if (
                bound[0]["attributes"].get("scene_visibility") == "hidden"
                and bound[0]["attributes"].get("display_slot", {}).get("basis")
                == "image_traced_demo_subdivision"
            ):
                blocked.append({"garment_id": str(garment["id"]), "reason": "SLOT_UNAPPROVED"})
            continue
        reason = (
            "CLEAN_PLATE_UNAPPROVED"
            if frame is None
            else "LOCATION_UNKNOWN_OR_STALE"
            if service.stale(garment)
            or garment["location_confidence"] is None
            or garment["location_confidence"] < 0.9
            else "SLOT_UNAPPROVED"
            if bound is None or bound[1] is None
            else "SLOT_OCCUPANCY_CONFLICT"
            if not placement and counts[garment["location_id"]] != 1
            else None
        )
        dto = await service.dto(garment) if reason is None else None
        if reason is None and dto.image is None:
            reason = "IMAGE_UNAVAILABLE"
        if reason:
            blocked.append({"garment_id": str(garment["id"]), "reason": reason})
            continue
        location, geometry = bound
        metadata = image_metadata.get(str(garment["image_asset_id"]), {})
        image_mask = metadata.get("display_mask")
        alignment = location["attributes"].get("display_slot", {}).get("alignment")
        scene_image = dto.image.model_dump(mode="json")
        mode = "hanging" if alignment == "hanging" else "folded"
        variant = scene_sprite(metadata, mode, sprite_assets)
        if variant:
            scene_image = signed_asset(
                request.app.state.settings, sprite_assets[variant["asset_id"]]
            )
            image_mask = variant["mask"]
        if image_mask and alignment in {"hanging", "shelf"}:
            image_mask = dict(image_mask, scene_alignment=alignment)
        items.append(
            {
                "garment_id": str(garment["id"]),
                "location_id": str(location["id"]),
                "name": dto.name,
                "version": dto.version,
                "image": scene_image,
                "geometry": geometry,
                "anchor_id": location["anchor_id"],
                "image_mask": image_mask,
            }
        )
    return {
        "device_id": str(device_id),
        "frame": signed_asset(request.app.state.settings, frame) if frame else None,
        "items": items,
        "blocked": blocked,
        "quality_status": "approved" if frame else "BLOCKED_CLEAN_PLATE",
        "total": len(garments),
    }
