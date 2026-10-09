from datetime import date as Date
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool

from app.schemas.sprint1 import DTO, Asset, Page


class CardItem(DTO):
    garment_id: UUID
    slot: str
    position: int
    image_asset_id: UUID | None = None


class CardTemplateData(DTO):
    title: str
    style_tag: str
    date: Date | None = None
    weather_label: str | None = None
    items: list[CardItem]
    template_version: Literal["minimal-v1"] = "minimal-v1"


class CardPrepareRequest(DTO):
    outfit_id: UUID
    context_snapshot_id: UUID | None = None
    template_id: Literal["minimal-v1"]


class CardDraft(DTO):
    id: UUID
    outfit_id: UUID
    template_id: str
    data: CardTemplateData
    status: Literal["DRAFT", "QUEUED", "RUNNING", "READY", "FAILED", "SAVED"]
    image_asset: Asset | None = None
    is_saved: bool = False
    saved_title: str | None = None
    share_url: str | None = None
    share_expires_at: datetime | None = None
    shared_fields: list[str] = Field(default_factory=list)
    linked_outfit_id: UUID | None = None


class CardDraftList(DTO):
    items: list[CardDraft]
    page: Page


class CardRenderRequest(DTO):
    card_id: UUID
    output_format: Literal["PNG", "WEBP"] = "PNG"
    width: Literal[1080] = 1080
    height: Literal[1350] = 1350


class CardSaveRequest(DTO):
    title: str | None = Field(default=None, max_length=200)
    visibility: Literal["PRIVATE", "SHAREABLE"]
    reuse_outfit: StrictBool = False
