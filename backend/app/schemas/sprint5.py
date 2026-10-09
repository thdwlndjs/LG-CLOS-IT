from datetime import date as Date
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool, field_validator

from app.schemas.sprint1 import DTO, Page
from app.schemas.sprint2 import OutfitItem


class AwareDTO(DTO):
    @field_validator("*", mode="before")
    @classmethod
    def timestamp_strings(cls, value, info):
        if info.field_name.endswith("_at") and isinstance(value, int | float | bool):
            raise ValueError("ISO timestamp required")
        return value

    @field_validator("*", mode="after")
    @classmethod
    def aware(cls, value):
        if isinstance(value, datetime) and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Timestamp offset required")
        return value


class WearConfirmRequest(AwareDTO):
    member_id: UUID
    outfit_id: UUID
    worn_at: datetime
    confirmation_method: Literal["USER", "SENSOR_VERIFIED"]
    session_id: UUID | None = None
    context_snapshot_id: UUID | None = None


class WearRecord(AwareDTO):
    id: UUID
    member_id: UUID
    outfit_id: UUID
    worn_at: datetime
    confirmation_method: str
    context_snapshot_id: UUID | None = None
    session_id: UUID | None = None
    confirmed_at: datetime
    cancelled_at: datetime | None = None
    version: int
    items_snapshot: list[OutfitItem] | None = None
    snapshot_status: Literal["FROZEN", "LEGACY_UNAVAILABLE"]


class RecordCancelRequest(DTO):
    expected_version: int = Field(strict=True, ge=1)
    reason: str = Field(min_length=1, max_length=500)


class CareConstraints(DTO):
    machine_wash_allowed: StrictBool | None = None
    tumble_dry_allowed: StrictBool | None = None
    max_wash_temperature_c: int | None = Field(default=None, strict=True, ge=0, le=95)


class CareProfileUpdate(DTO):
    expected_version: int = Field(strict=True, ge=0)
    special_care: StrictBool = False
    care_group: str = Field(min_length=1, max_length=100)
    instructions: list[str] = Field(default_factory=list, max_length=20)
    constraints: CareConstraints = Field(default_factory=CareConstraints)

    @field_validator("instructions")
    @classmethod
    def instruction_lengths(cls, value):
        if any(not x.strip() or len(x) > 500 for x in value):
            raise ValueError("Invalid instruction")
        return value


class CareGuide(DTO):
    garment_id: UUID
    care_group: str
    special_care: bool
    instructions: list[str]
    constraints: CareConstraints = Field(default_factory=CareConstraints)
    source: Literal["LABEL", "USER_PROFILE", "GENERAL"]
    warnings: list[str]
    confidence: Literal["LABEL_PROVIDED", "REVIEW_REQUIRED"]
    profile_version: int = 0


CareType = Literal["WASH", "DRY", "CLEAN", "INSPECT", "OTHER"]


class CareScheduleCreate(AwareDTO):
    garment_id: UUID
    scheduled_at: datetime
    care_type: CareType
    notes: str | None = Field(default=None, max_length=1000)
    recurrence_days: int | None = Field(default=None, strict=True, ge=1, le=365)
    timezone: str = "UTC"


class CareScheduleUpdate(AwareDTO):
    expected_version: int = Field(strict=True, ge=1)
    scheduled_at: datetime
    care_type: CareType
    status: Literal["SCHEDULED", "CANCELLED"]
    notes: str | None = Field(default=None, max_length=1000)
    recurrence_days: int | None = Field(default=None, strict=True, ge=1, le=365)
    timezone: str = "UTC"


class CareCompleteRequest(AwareDTO):
    completed_at: datetime
    expected_version: int = Field(strict=True, ge=1)
    outcome: Literal["SUCCESS", "NOT_DONE"] = "SUCCESS"
    notes: str | None = Field(default=None, max_length=1000)


class CareSchedule(AwareDTO):
    id: UUID
    garment_id: UUID
    scheduled_at: datetime
    care_type: str
    status: Literal["SCHEDULED", "COMPLETED", "CANCELLED", "OVERDUE"]
    notes: str | None = None
    version: int
    recurrence_days: int | None = None
    timezone: str
    completed_at: datetime | None = None
    care_event_id: UUID | None = None
    next_schedule_id: UUID | None = None
    next_due_at: datetime | None = None


class CareScheduleList(DTO):
    items: list[CareSchedule]
    page: Page


class HistoryItem(AwareDTO):
    id: UUID
    kind: Literal["WEAR", "CARE", "OUTFIT_SELECTION"]
    occurred_at: datetime
    local_date: Date
    status: Literal["CONFIRMED", "COMPLETED", "CANCELLED", "SELECTED", "NOT_DONE"]
    outfit_id: UUID | None = None
    garment_id: UUID | None = None
    session_id: UUID | None = None
    context_snapshot_id: UUID | None = None
    items_snapshot: list[OutfitItem] | None = None
    description: str


class HistoryItemList(DTO):
    items: list[HistoryItem]
    page: Page
    timezone: str
