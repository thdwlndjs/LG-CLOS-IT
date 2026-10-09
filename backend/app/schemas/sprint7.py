from datetime import datetime
from typing import Literal

from app.schemas.sprint1 import DTO, Member
from app.schemas.sprint2 import Context, OutfitCandidate
from app.schemas.sprint5 import CareSchedule
from app.schemas.sprint6 import StorageAction


class HomeDashboard(DTO):
    member: Member
    today_context: Context | None = None
    today_outfits: list[OutfitCandidate]
    care_alerts: list[CareSchedule]
    storage_alerts: list[StorageAction]
    updated_at: datetime
    partial: bool
    timezone: str
    at: datetime
    source_status: dict[str, Literal["FRESH", "STALE", "EMPTY", "UNAVAILABLE", "TRUNCATED"]]
