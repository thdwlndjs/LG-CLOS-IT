from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.v1.sprint1 import Actor, metadata
from app.application.sprint7 import Sprint7
from app.core.errors import ApiError
from app.core.rate_limit import rate_guard
from app.schemas.sprint7 import HomeDashboard

router = APIRouter(prefix="/api/v1", dependencies=[Depends(rate_guard)])


@router.get("/home", response_model=HomeDashboard, **metadata("/home", "get"))
async def home(
    request: Request,
    actor: Actor,
    member_id: UUID | None = None,
    at: datetime | None = None,
    timezone: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
):
    if at is not None:
        try:
            datetime.fromisoformat(request.query_params["at"].replace("Z", "+00:00"))
        except ValueError:
            raise ApiError(422, "VALIDATION_ERROR", "ISO timestamp with offset required") from None
    return await Sprint7(request).home(actor, member_id, at, timezone)
