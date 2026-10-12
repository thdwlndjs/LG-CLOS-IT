from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.v1.sprint1 import Actor
from app.application.fitroom import Fitroom, audit
from app.core.errors import ApiError
from app.core.rate_limit import rate_guard
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.fitroom import FitroomExecute, FitroomPreview

router = APIRouter(
    prefix="/api/v1/integration/fitroom", tags=["C-2 FitRoom"], dependencies=[Depends(rate_guard)]
)
TRACE = {"x-fsd-ids": ["VTON-001", "VTON-002"], "x-poc-ids": ["POC-V01", "POC-V04"]}


async def invoke(service, actor, identity, action, operation):
    async with service.sessions.begin() as session:
        await audit(
            Sprint1Repository(session), actor, identity, "API_REQUESTED", operation=operation
        )
    try:
        return await action()
    except ApiError as error:
        async with service.sessions.begin() as session:
            await audit(
                Sprint1Repository(session), actor, identity, "API_REJECTED", code=error.code
            )
        raise


@router.post("/reviews", openapi_extra=TRACE)
async def preview(request: Request, actor: Actor, body: FitroomPreview):
    service = Fitroom(request)
    return await invoke(service, actor, None, lambda: service.preview(actor, body), "PREVIEW")


@router.get("/reviews/{job_id}", openapi_extra=TRACE)
async def detail(request: Request, actor: Actor, job_id: UUID):
    service = Fitroom(request)
    return await invoke(service, actor, job_id, lambda: service.get(actor, job_id), "DETAIL")


@router.post("/reviews/{job_id}/execute", openapi_extra=TRACE)
async def execute(request: Request, actor: Actor, job_id: UUID, body: FitroomExecute):
    service = Fitroom(request)
    return await invoke(
        service, actor, job_id, lambda: service.execute(actor, job_id, body), "EXECUTE"
    )


@router.post("/reviews/{job_id}/status", openapi_extra=TRACE)
async def status(request: Request, actor: Actor, job_id: UUID):
    service = Fitroom(request)
    return await invoke(service, actor, job_id, lambda: service.poll(actor, job_id), "STATUS")
