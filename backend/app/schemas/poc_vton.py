"""C-stage additive request: provenance identities never become garment FKs."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Slot = Literal["TOP", "BOTTOM", "OUTER", "DRESS", "SHOES", "ACCESSORY"]


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["OWNED", "LIKED"]
    id: UUID
    slot: Slot
    position: Literal[0] = 0
    expected_asset_id: UUID
    expected_source_version: int | None = Field(default=None, ge=1)


class UnifiedVtonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_context_id: UUID
    draft_id: str = Field(min_length=1, max_length=200)
    draft_revision: int = Field(ge=0, strict=True)
    person_asset_id: UUID
    provider: Literal["MOCK"] = "MOCK"
    items: list[Item] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def composition(self):
        slots = [item.slot for item in self.items]
        identities = {(item.kind, item.id) for item in self.items}
        if len(set(slots)) != len(slots) or len(identities) != len(self.items):
            raise ValueError("Duplicate slot or provenance identity")
        if "DRESS" in slots:
            if "TOP" in slots or "BOTTOM" in slots:
                raise ValueError("DRESS conflicts with TOP/BOTTOM")
        elif not {"TOP", "BOTTOM"}.issubset(slots):
            raise ValueError("TOP+BOTTOM or DRESS required")
        return self


class SnapshotItem(BaseModel):
    kind: Literal["OWNED", "LIKED"]
    id: UUID
    slot: Slot
    position: Literal[0]
    owner_id: UUID
    source_version: int | None
    asset_id: UUID
    checksum_sha256: str = Field(pattern="^[a-f0-9]{64}$")
    source_fingerprint: str = Field(pattern="^[a-f0-9]{64}$")


class PersonInput(BaseModel):
    asset_id: UUID
    checksum_sha256: str = Field(pattern="^[a-f0-9]{64}$")


class RequestSnapshot(BaseModel):
    schema_version: Literal["poc-vton-c1"]
    request_id: UUID
    household_id: UUID
    member_id: UUID
    client_context_id: UUID
    draft_id: str
    draft_revision: int
    submitted_at: datetime
    provider: Literal["MOCK"]
    person: PersonInput
    items: list[SnapshotItem]
    contains_liked: bool
    input_fingerprint: str


class UnifiedAccepted(BaseModel):
    job_id: UUID
    status: Literal["QUEUED"]
    request_snapshot: RequestSnapshot
    status_url: str
    is_mock: Literal[True]
    result_semantics: Literal["MOCK_RECEIPT_NOT_REAL_TRY_ON"]


class UnifiedJob(BaseModel):
    job_id: UUID
    status: Literal["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]
    request_snapshot: RequestSnapshot
    result_asset: dict | None
    is_mock: Literal[True]
    result_semantics: Literal["MOCK_RECEIPT_NOT_REAL_TRY_ON"]
    error: dict | None


class UnifiedCancelled(BaseModel):
    job_id: UUID
    status: Literal["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]
