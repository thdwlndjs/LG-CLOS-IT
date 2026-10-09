from dataclasses import dataclass
from uuid import UUID

from app.core.errors import ApiError


@dataclass(frozen=True)
class ActorContext:
    household_id: UUID
    member_id: UUID
    role: str
    session_id: UUID
    correlation_id: str
    station_id: UUID | None = None
    personal_account: bool = False


def require_household(actor: ActorContext, household_id: UUID) -> None:
    if actor.household_id != household_id:
        raise ApiError(404, "NOT_FOUND", "Resource not found")


def require_self(actor: ActorContext, member_id: UUID) -> None:
    if actor.member_id != member_id:
        raise ApiError(403, "FORBIDDEN", "Access denied")

