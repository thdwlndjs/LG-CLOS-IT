from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.core.clock import utc_now
from app.schemas.sprint1 import DTO, Asset, Page


class ContextCaptureRequest(DTO):
    member_id: UUID
    timezone: str
    mode: Literal["AUTO", "MOCK"] = "AUTO"
    at: datetime | None = None

    @field_validator("at", mode="before")
    @classmethod
    def datetime_wire(cls, value):
        if value is not None and not isinstance(value, str | datetime):
            raise ValueError("Datetime string required")
        return value

    @field_validator("at")
    @classmethod
    def aware(cls, value):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Timezone offset required")
        return value


class ContextWeather(DTO):
    temperature_c: float | None = None
    humidity_pct: float | None = None
    precipitation_mm: float | None = None
    condition: str | None = None


class ContextSchedule(DTO):
    kind: str
    starts_at: datetime
    people: list[str] = Field(default_factory=list)


class ContextSourceStatus(DTO):
    source: str
    observed_at: datetime | None = None
    freshness: Literal["FRESH", "STALE", "UNKNOWN"]
    is_mock: bool
    missing_fields: list[str]


class Context(DTO):
    id: UUID
    member_id: UUID
    captured_at: datetime
    timezone: str
    source_mode: Literal["LIVE", "CACHED", "MOCK", "PARTIAL"]
    weather: ContextWeather = Field(default_factory=ContextWeather)
    schedule: list[ContextSchedule] = Field(default_factory=list)
    location_label: str | None = None
    is_holiday: bool | None = None
    missing_fields: list[str] = Field(default_factory=list)
    source_status: dict[str, ContextSourceStatus] = Field(default_factory=dict)


class OutfitItem(DTO):
    garment_id: UUID
    slot: Literal["TOP", "BOTTOM", "OUTER", "SHOES", "ACCESSORY", "DRESS"]
    position: int = Field(default=0, strict=True)


class Outfit(DTO):
    id: UUID
    member_id: UUID
    items: list[OutfitItem]
    status: Literal["DRAFT", "SAVED", "ARCHIVED"]
    version: int
    title: str = "Untitled Look"
    created_at: datetime
    missing_garment_ids: list[UUID] = Field(default_factory=list)
    try_on_ready: bool = False


class OutfitUpsert(DTO):
    items: list[OutfitItem]
    title: str = "Untitled Look"
    status: Literal["DRAFT", "SAVED", "ARCHIVED"] = "DRAFT"


class OutfitList(DTO):
    items: list[Outfit]
    page: Page


class RecommendRequest(DTO):
    member_id: UUID
    context_snapshot_id: UUID
    constraints: dict = Field(default_factory=dict)
    limit: int = Field(default=5, strict=True)
    theme: str | None = None


class OutfitCandidate(DTO):
    outfit: Outfit
    score: float
    reasons: list[str]


class RecommendResponse(DTO):
    recommendation_id: UUID
    context_snapshot_id: UUID
    candidates: list[OutfitCandidate]
    generated_at: datetime
    fallback_used: bool = False


class StyleReferenceCreate(DTO):
    member_id: UUID
    source: Literal["INSTAGRAM", "SHOPPING", "OTHER"]
    title: str
    source_url: str | None = None
    image_asset_id: UUID | None = None


class StyleReference(DTO):
    id: UUID
    member_id: UUID
    source: Literal["INSTAGRAM", "SHOPPING", "OTHER"]
    title: str
    source_url: str | None = None
    image_asset_id: UUID | None = None
    image: Asset | None = None
    created_at: datetime = Field(default_factory=utc_now)


class StyleReferenceList(DTO):
    items: list[StyleReference]
    page: Page
