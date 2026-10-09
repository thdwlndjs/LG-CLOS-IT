from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool

from app.schemas.sprint1 import DTO, Page
from app.schemas.sprint5 import AwareDTO

ActionStatus = Literal[
    "PROPOSED",
    "APPROVED",
    "REJECTED",
    "IN_PROGRESS",
    "AWAITING_CONFIRMATION",
    "COMPLETED",
    "FAILED",
    "EXPIRED",
    "CANCELLED",
]


class StorageOptimizeRequest(DTO):
    household_id: UUID
    member_id: UUID
    mode: Literal["WEAR_PATTERN", "SPACE_ENVIRONMENT"]
    dry_run: StrictBool = False
    season: Literal["SPRING", "SUMMER", "AUTUMN", "WINTER", "ALL"] = "ALL"
    analysis_window_days: int = Field(default=90, strict=True, ge=1, le=365)
    garment_ids: list[UUID] = Field(default_factory=list, max_length=100)


class StorageActionItem(AwareDTO):
    id: UUID
    garment_id: UUID
    source_location_id: UUID | None = None
    destination_location_id: UUID
    status: Literal[
        "PENDING", "IN_PROGRESS", "AWAITING_CONFIRMATION", "COMPLETED", "FAILED", "SKIPPED"
    ]
    expected_garment_version: int | None = None
    expected_state_version: int | None = None
    score: float | None = None
    reasons: list[str] = Field(default_factory=list)
    confirmed_at: datetime | None = None
    confirmation_method: str | None = None
    failure_reason: str | None = None


class StorageAction(AwareDTO):
    id: UUID
    household_id: UUID
    action_type: str
    status: ActionStatus
    reasoning: list[str]
    items: list[StorageActionItem]
    version: int
    requested_by: UUID | None = None
    approved_by: UUID | None = None
    created_at: datetime
    approved_at: datetime | None = None
    completed_at: datetime | None = None
    expires_at: datetime | None = None
    rules_version: str | None = None
    executable: bool = False


class StorageActionList(DTO):
    items: list[StorageAction]
    page: Page


class StorageDecisionRequest(DTO):
    expected_version: int = Field(strict=True, ge=1)
    decision: Literal["APPROVE", "REJECT", "CANCEL"]


class StorageItemConfirmation(AwareDTO):
    garment_id: UUID
    confirmed: StrictBool
    observed_location_id: UUID | None = None
    observed_at: datetime | None = None
    confirmation_method: Literal["USER", "SENSOR_VERIFIED"] = "USER"
    failure_reason: str | None = Field(default=None, max_length=500)


class StorageConfirmRequest(DTO):
    expected_version: int = Field(strict=True, ge=1)
    items: list[StorageItemConfirmation] = Field(min_length=1, max_length=100)


class StorageBlockedItem(DTO):
    garment_id: UUID
    reasons: list[str]


class StoragePlacement(DTO):
    garment_id: UUID
    source_location_id: UUID
    destination_location_id: UUID
    score: float
    reasons: list[str]


class StoragePlanResult(AwareDTO):
    status: Literal["FEASIBLE", "PARTIAL", "NO_CHANGE", "NO_FEASIBLE_PLAN"]
    feasible: bool
    dry_run: bool
    rules_version: str
    snapshot_at: datetime
    action_ids: list[UUID] = Field(default_factory=list)
    proposed_items: list[StoragePlacement] = Field(default_factory=list)
    blocked: list[StorageBlockedItem] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)
