from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.v1.sprint1 import Actor, Key
from app.application.poc_vton import PocVton
from app.core.rate_limit import rate_guard
from app.schemas.poc_vton import UnifiedAccepted, UnifiedCancelled, UnifiedJob, UnifiedVtonRequest

router = APIRouter(
    prefix="/api/v1/integration/vton-jobs",
    tags=["Integration VTON"],
    dependencies=[Depends(rate_guard)],
)
TRACE = {
    "x-fsd-ids": ["VTON-001", "VTON-002"],
    "x-poc-ids": ["POC-V01", "POC-V02", "POC-V03", "POC-V04", "POC-V05", "POC-V06"],
}


@router.post("", status_code=202, response_model=UnifiedAccepted, openapi_extra=TRACE)
async def create(request: Request, actor: Actor, body: UnifiedVtonRequest, key: Key):
    return await PocVton(request).unified_create(actor, body, key)


@router.get("/{job_id}", response_model=UnifiedJob, openapi_extra=TRACE)
async def detail(request: Request, actor: Actor, job_id: UUID):
    return await PocVton(request).unified_get(actor, job_id)


@router.post("/{job_id}/cancel", response_model=UnifiedCancelled, openapi_extra=TRACE)
async def cancel(request: Request, actor: Actor, job_id: UUID, key: Key):
    return await PocVton(request).unified_cancel(actor, job_id, key)
