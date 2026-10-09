from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool

from app.core.clock import utc_now
from app.schemas.errors import Error
from app.schemas.sprint1 import DTO, Asset
from app.schemas.sprint2 import OutfitItem
from app.schemas.sprint6 import StoragePlanResult

Source = Literal["HOME", "GARMENT_DETAIL", "MY_OUTFITS", "OUTFIT_EDITOR", "CALENDAR", "OTHER"]
JobStatus = Literal["QUEUED", "RUNNING", "SUCCEEDED", "READY", "FAILED", "TIMED_OUT", "CANCELLED"]


class VtonSessionCreate(DTO):
    member_id: UUID
    source_screen: Source
    outfit_id: UUID | None = None
    context_snapshot_id: UUID | None = None
    garment_id: UUID | None = None
    person_asset_id: UUID | None = None


class VtonModifyRequest(DTO):
    items: list[OutfitItem]
    expected_revision: int = Field(strict=True)


class VtonEndRequest(DTO):
    expected_revision: int = Field(strict=True)
    final_outfit_id: UUID | None = None
    save_outfit: StrictBool = False


class VtonJobRequest(DTO):
    session_id: UUID
    expected_revision: int = Field(strict=True)
    person_asset_id: UUID
    outfit_id: UUID
    provider: Literal["DECART", "MOCK"] = "MOCK"


class VtonSession(DTO):
    id: UUID
    member_id: UUID
    source_screen: Source
    status: Literal["CREATED", "ACTIVE", "ENDED", "CANCELLED", "EXPIRED"]
    revision: int
    outfit_id: UUID | None = None
    context_snapshot_id: UUID | None = None
    final_outfit_id: UUID | None = None
    created_at: datetime = Field(default_factory=utc_now)
    source_outfit_id: UUID | None = None
    person_asset_id: UUID | None = None
    items: list[OutfitItem] = Field(default_factory=list)
    provider_mode: Literal["MOCK", "DECART"] = "MOCK"
    vton_available: bool = False
    unavailable_reasons: list[str] = Field(default_factory=list)
    current_result_job_id: UUID | None = None
    final_items_snapshot: list[OutfitItem] | None = None
    card_entry_payload: dict | None = None


class AcceptedJob(DTO):
    job_id: UUID
    status: JobStatus
    status_url: str


class Job(DTO):
    id: UUID
    kind: Literal["VTON", "CARD_RENDER", "STORAGE_OPTIMIZATION"]
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    progress_pct: int = 0
    result_asset: Asset | None = None
    error: Error | None = None
    provider_mode: Literal["MOCK", "DECART"] | None = None
    session_id: UUID | None = None
    outfit_revision: int | None = None
    card_id: UUID | None = None
    is_current: bool = False
    stale: bool = False
    attempt_count: int = 0
    storage_result: StoragePlanResult | None = None
