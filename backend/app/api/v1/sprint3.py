from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.v1.sprint1 import Actor, Key, metadata
from app.application.sprint3 import Sprint3
from app.application.sprint6 import Sprint6
from app.core.rate_limit import rate_guard
from app.schemas.sprint3 import (
    AcceptedJob,
    Job,
    VtonEndRequest,
    VtonJobRequest,
    VtonModifyRequest,
    VtonSession,
    VtonSessionCreate,
)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(rate_guard)])


@router.post(
    "/vton-sessions",
    status_code=201,
    response_model=VtonSession,
    **metadata("/vton-sessions", "post"),
)
async def create(request: Request, actor: Actor, body: VtonSessionCreate, key: Key):
    return await Sprint3(request).session_create(actor, body, key)


@router.get(
    "/vton-sessions/{session_id}",
    response_model=VtonSession,
    **metadata("/vton-sessions/{session_id}", "get"),
)
async def detail(request: Request, actor: Actor, session_id: UUID):
    return await Sprint3(request).session_get(actor, session_id)


@router.patch(
    "/vton-sessions/{session_id}/outfit",
    response_model=VtonSession,
    **metadata("/vton-sessions/{session_id}/outfit", "patch"),
)
async def modify(request: Request, actor: Actor, session_id: UUID, body: VtonModifyRequest):
    return await Sprint3(request).session_modify(actor, session_id, body)


@router.post(
    "/vton-sessions/{session_id}/end",
    status_code=201,
    response_model=VtonSession,
    **metadata("/vton-sessions/{session_id}/end", "post"),
)
async def end(request: Request, actor: Actor, session_id: UUID, body: VtonEndRequest, key: Key):
    return await Sprint3(request).session_end(actor, session_id, body, key)


@router.post(
    "/vton-jobs", status_code=202, response_model=AcceptedJob, **metadata("/vton-jobs", "post")
)
async def execute(request: Request, actor: Actor, body: VtonJobRequest, key: Key):
    return await Sprint3(request).job_create(actor, body, key)


@router.get("/jobs/{job_id}", response_model=Job, **metadata("/jobs/{job_id}", "get"))
async def job(request: Request, actor: Actor, job_id: UUID):
    return await Sprint6(request).job_get(actor, job_id)


@router.post(
    "/jobs/{job_id}/cancel",
    status_code=201,
    response_model=Job,
    **metadata("/jobs/{job_id}/cancel", "post"),
)
async def cancel(request: Request, actor: Actor, job_id: UUID, key: Key):
    return await Sprint6(request).job_cancel(actor, job_id, key)
