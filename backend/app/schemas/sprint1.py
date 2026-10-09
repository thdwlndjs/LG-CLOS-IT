"""Sprint 1 wire DTOs. Names and fields follow the authoritative OpenAPI."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, field_validator


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Member(DTO):
    id: UUID
    household_id: UUID
    display_name: str
    role: Literal["OWNER", "MEMBER", "CHILD"]


class SessionStartRequest(DTO):
    household_id: UUID
    member_id: UUID
    demo_mode: StrictBool = False


class SessionStartResponse(DTO):
    session_id: UUID
    access_token: str
    token_type: Literal["Bearer"]
    expires_at: datetime
    member: Member
    capabilities: list[str]


class Asset(DTO):
    asset_id: UUID
    asset_key: str
    content_type: str
    read_url: str | None = None
    expires_at: datetime | None = None


class Garment(DTO):
    id: UUID
    owner_id: UUID
    category: str
    color: str
    material: str | None = None
    season_tags: list[str] = Field(default_factory=list)
    image: Asset | None = None
    status: Literal["AVAILABLE", "IN_USE", "LAUNDRY", "CARE", "STORED", "UNKNOWN", "RETIRED"]
    care_label: str | None = None
    location_label: str | None = None
    stale: bool = True
    care_guide_available: bool = False
    care_guide_url: str | None = None
    shared_with_member_ids: list[UUID] = Field(default_factory=list)
    location_id: UUID | None = None
    location_confidence: float | None = None
    last_seen_at: datetime | None = None
    version: int


class GarmentUpsert(DTO):
    owner_id: UUID
    category: str
    color: str
    material: str | None = None
    season_tags: list[str] = Field(default_factory=list)
    image_asset_id: UUID | None = None
    care_label: str | None = None
    location_id: UUID | None = None
    tag_value: str | None = None
    shared_with_member_ids: list[UUID] = Field(default_factory=list)


class ObservationRequest(DTO):
    garment_id: UUID | None = None
    observation_id: UUID | None = None
    tag_value: str | None = None
    location_id: UUID | None = None
    sensor_type: Literal["RFID", "VISION", "MANUAL", "MOCK"]
    confidence: StrictFloat
    observed_at: datetime
    source_id: str

    @field_validator("observed_at", mode="before")
    @classmethod
    def datetime_wire_type(cls, value):
        if not isinstance(value, str | datetime):
            raise ValueError("A datetime string is required")
        return value

    @field_validator("observed_at")
    @classmethod
    def aware_time(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("A timezone offset is required")
        return value


class ObservationResponse(DTO):
    observation_id: UUID
    state_updated: bool
    garment: Garment


class Page(DTO):
    limit: int
    offset: int
    total: int


class GarmentList(DTO):
    items: list[Garment]
    page: Page


class GarmentLocateRequest(DTO):
    owner_id: UUID | None = None
    category: str | None = None
    color: str | None = None
    garment_id: UUID | None = None


class LocatedGarment(DTO):
    garment_id: UUID
    location_id: UUID | None = None
    location_label: str | None = None
    confidence: float | None = None
    last_seen_at: datetime | None = None
    status: Literal["FOUND", "STALE", "UNKNOWN"]
    fallback: str | None = None


class LocatedGarmentList(DTO):
    items: list[LocatedGarment]
    page: Page


class Settings(DTO):
    member_id: UUID
    timezone: str
    units: Literal["METRIC", "IMPERIAL"]
    weather_mode: Literal["LIVE", "MOCK"]
    calendar_enabled: StrictBool
    vton_provider: Literal["DECART", "MOCK"]
    notifications_enabled: StrictBool
    image_upload_consent: StrictBool = False
    provider_connection_status: Literal["MOCK_ONLY"] = "MOCK_ONLY"


class UploadIntentRequest(DTO):
    file_name: str
    content_type: Literal["image/png", "image/jpeg", "image/webp"]
    size_bytes: int = Field(ge=1, le=10485760, strict=True)
    purpose: Literal["GARMENT", "PERSON_VTON", "STYLE", "OTHER"]


class UploadIntentResponse(DTO):
    asset_id: UUID
    upload_url: str
    method: Literal["PUT"]
    expires_at: datetime
    required_headers: dict[str, str]


class AssetFinalizeRequest(DTO):
    checksum_sha256: str = Field(pattern="^[0-9a-f]{64}$")


class ConsentRecord(DTO):
    id: UUID
    granted: bool
    policy_version: str
    changed_at: datetime


class ConsentHistory(DTO):
    items: list[ConsentRecord]


class GarmentDeleted(DTO):
    garment_id: UUID
    deleted: Literal[True]
