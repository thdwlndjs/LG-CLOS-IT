from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.v1.sprint1 import Actor, Key, metadata
from app.application.sprint5 import Sprint5
from app.core.rate_limit import rate_guard
from app.schemas.sprint5 import (
    CareCompleteRequest,
    CareGuide,
    CareProfileUpdate,
    CareSchedule,
    CareScheduleCreate,
    CareScheduleList,
    CareScheduleUpdate,
    HistoryItemList,
    RecordCancelRequest,
    WearConfirmRequest,
    WearRecord,
)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(rate_guard)])
Start = Annotated[date | None, Query(alias="from")]
End = Annotated[date | None, Query(alias="to")]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/history", response_model=HistoryItemList, **metadata("/history", "get"))
async def history(
    request: Request,
    actor: Actor,
    member_id: UUID | None = None,
    from_: Start = None,
    to: End = None,
    timezone: str = "UTC",
    kind: Literal["WEAR", "CARE", "OUTFIT_SELECTION"] | None = None,
    limit: Limit = 20,
    offset: Offset = 0,
):
    return await Sprint5(request).history(
        actor, member_id, from_, to, timezone, kind, limit, offset
    )


@router.post(
    "/wear-confirmations",
    status_code=201,
    response_model=WearRecord,
    **metadata("/wear-confirmations", "post"),
)
async def wear(request: Request, actor: Actor, body: WearConfirmRequest, key: Key):
    return await Sprint5(request).wear_confirm(actor, body, key)


@router.post(
    "/wear-confirmations/{wear_id}/cancel",
    status_code=201,
    response_model=WearRecord,
    **metadata("/wear-confirmations/{wear_id}/cancel", "post"),
)
async def cancel_wear(
    request: Request, actor: Actor, wear_id: UUID, body: RecordCancelRequest, key: Key
):
    return await Sprint5(request).wear_cancel(actor, wear_id, body, key)


@router.get(
    "/garments/{garment_id}/care-guide",
    response_model=CareGuide,
    **metadata("/garments/{garment_id}/care-guide", "get"),
)
async def guide(request: Request, actor: Actor, garment_id: UUID):
    return await Sprint5(request).care_guide(actor, garment_id)


@router.put(
    "/garments/{garment_id}/care-profile",
    response_model=CareGuide,
    **metadata("/garments/{garment_id}/care-profile", "put"),
)
async def profile(
    request: Request, actor: Actor, garment_id: UUID, body: CareProfileUpdate, key: Key
):
    return await Sprint5(request).care_profile_update(actor, garment_id, body, key)


@router.get(
    "/care-schedules", response_model=CareScheduleList, **metadata("/care-schedules", "get")
)
async def schedules(
    request: Request,
    actor: Actor,
    member_id: UUID | None = None,
    from_: Start = None,
    to: End = None,
    timezone: str = "UTC",
    limit: Limit = 20,
    offset: Offset = 0,
):
    return await Sprint5(request).schedule_list(
        actor, member_id, from_, to, timezone, limit, offset
    )


@router.post(
    "/care-schedules",
    status_code=201,
    response_model=CareSchedule,
    **metadata("/care-schedules", "post"),
)
async def schedule(request: Request, actor: Actor, body: CareScheduleCreate, key: Key):
    return await Sprint5(request).schedule_create(actor, body, key)


@router.patch(
    "/care-schedules/{schedule_id}",
    response_model=CareSchedule,
    **metadata("/care-schedules/{schedule_id}", "patch"),
)
async def edit(
    request: Request, actor: Actor, schedule_id: UUID, body: CareScheduleUpdate, key: Key
):
    return await Sprint5(request).schedule_update(actor, schedule_id, body, key)


@router.post(
    "/care-schedules/{schedule_id}/complete",
    status_code=201,
    response_model=CareSchedule,
    **metadata("/care-schedules/{schedule_id}/complete", "post"),
)
async def complete(
    request: Request, actor: Actor, schedule_id: UUID, body: CareCompleteRequest, key: Key
):
    return await Sprint5(request).schedule_complete(actor, schedule_id, body, key)


@router.post(
    "/care-schedules/{schedule_id}/completion/cancel",
    status_code=201,
    response_model=CareSchedule,
    **metadata("/care-schedules/{schedule_id}/completion/cancel", "post"),
)
async def cancel_completion(
    request: Request, actor: Actor, schedule_id: UUID, body: RecordCancelRequest, key: Key
):
    return await Sprint5(request).completion_cancel(actor, schedule_id, body, key)
