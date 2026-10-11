"""Additive local handoff scene contract; geometry requires explicit approval."""

from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.sprint1 import DTO, Asset


class SceneGeometry(DTO):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    z_index: int = Field(ge=0, le=100)


class SceneItem(DTO):
    garment_id: UUID
    location_id: UUID
    name: str | None
    version: int
    image: Asset
    geometry: SceneGeometry
    anchor_id: str | None
    image_mask: dict | None = None


class SceneBlocked(DTO):
    garment_id: UUID
    reason: Literal[
        "CLEAN_PLATE_UNAPPROVED",
        "LOCATION_UNKNOWN_OR_STALE",
        "SLOT_UNAPPROVED",
        "SLOT_OCCUPANCY_CONFLICT",
        "IMAGE_UNAVAILABLE",
    ]


class WardrobeScene(DTO):
    device_id: UUID
    frame: Asset | None
    items: list[SceneItem]
    blocked: list[SceneBlocked]
    quality_status: Literal["approved", "BLOCKED_CLEAN_PLATE"]
    total: int = Field(ge=0, le=100)
