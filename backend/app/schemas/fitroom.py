"""Additive C-2 review contract; never replaces the C-stage Mock DTO."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.poc_vton import UnifiedVtonRequest


class FitroomPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request: UnifiedVtonRequest
    mode: Literal["FIXTURE", "LIVE"] = "FIXTURE"
    hd_mode: bool = False


class FitroomExecute(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fingerprint: str
    confirmed: Literal[True]
    person_asset_id: UUID
