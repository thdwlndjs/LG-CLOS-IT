from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.v1.sprint1 import Actor, Key, metadata
from app.application.sprint6 import Sprint6
from app.core.rate_limit import rate_guard
from app.schemas.sprint3 import AcceptedJob
from app.schemas.sprint6 import (
    ActionStatus,
    StorageAction,
    StorageActionList,
    StorageConfirmRequest,
    StorageDecisionRequest,
    StorageOptimizeRequest,
)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(rate_guard)])


@router.post(
    "/storage-optimization-jobs",
    status_code=202,
    response_model=AcceptedJob,
    **metadata("/storage-optimization-jobs", "post"),
)
async def optimize(request: Request, actor: Actor, body: StorageOptimizeRequest, key: Key):
    return await Sprint6(request).optimization_create(actor, body, key)


@router.get(
    "/storage-actions", response_model=StorageActionList, **metadata("/storage-actions", "get")
)
async def actions(
    request: Request,
    actor: Actor,
    household_id: UUID | None = None,
    status: ActionStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await Sprint6(request).action_list(actor, household_id, status, limit, offset)


@router.get(
    "/storage-actions/{action_id}",
    response_model=StorageAction,
    **metadata("/storage-actions/{action_id}", "get"),
)
async def detail(request: Request, actor: Actor, action_id: UUID):
    return await Sprint6(request).action_get(actor, action_id)


@router.post(
    "/storage-actions/{action_id}/decision",
    status_code=201,
    response_model=StorageAction,
    **metadata("/storage-actions/{action_id}/decision", "post"),
)
async def decision(
    request: Request, actor: Actor, action_id: UUID, body: StorageDecisionRequest, key: Key
):
    return await Sprint6(request).action_decision(actor, action_id, body, key)


@router.post(
    "/storage-actions/{action_id}/confirm",
    status_code=201,
    response_model=StorageAction,
    **metadata("/storage-actions/{action_id}/confirm", "post"),
)
async def confirm(
    request: Request, actor: Actor, action_id: UUID, body: StorageConfirmRequest, key: Key
):
    return await Sprint6(request).action_confirm(actor, action_id, body, key)
