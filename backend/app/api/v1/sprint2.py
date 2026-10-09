from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from app.api.v1.sprint1 import Actor, Key, metadata
from app.application.sprint2 import Sprint2
from app.core.errors import ApiError
from app.core.rate_limit import rate_guard
from app.schemas.sprint2 import (
    Context,
    ContextCaptureRequest,
    Outfit,
    OutfitList,
    OutfitUpsert,
    RecommendRequest,
    RecommendResponse,
    StyleReference,
    StyleReferenceCreate,
    StyleReferenceList,
)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(rate_guard)])


@router.post(
    "/context-snapshots",
    status_code=201,
    response_model=Context,
    **metadata("/context-snapshots", "post"),
)
async def capture(request: Request, actor: Actor, body: ContextCaptureRequest, key: Key):
    return await Sprint2(request).context_capture(actor, body, key)


@router.get(
    "/context-snapshots/{context_id}",
    response_model=Context,
    **metadata("/context-snapshots/{context_id}", "get"),
)
async def context(request: Request, actor: Actor, context_id: UUID):
    return await Sprint2(request).context_get(actor, context_id)


@router.post(
    "/outfit-recommendations",
    status_code=201,
    response_model=RecommendResponse,
    **metadata("/outfit-recommendations", "post"),
)
async def recommend(request: Request, actor: Actor, body: RecommendRequest, key: Key):
    return await Sprint2(request).recommend(actor, body, key)


@router.get("/outfits", response_model=OutfitList, **metadata("/outfits", "get"))
async def outfits(
    request: Request,
    actor: Actor,
    member_id: UUID | None = None,
    status: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await Sprint2(request).outfit_list(actor, member_id, status, limit, offset)


@router.post("/outfits", status_code=201, response_model=Outfit, **metadata("/outfits", "post"))
async def create(request: Request, actor: Actor, body: OutfitUpsert, key: Key):
    return await Sprint2(request).outfit_upsert(actor, body, key)


@router.get(
    "/outfits/{outfit_id}", response_model=Outfit, **metadata("/outfits/{outfit_id}", "get")
)
async def outfit(request: Request, actor: Actor, outfit_id: UUID):
    return await Sprint2(request).outfit_get(actor, outfit_id)


@router.patch(
    "/outfits/{outfit_id}", response_model=Outfit, **metadata("/outfits/{outfit_id}", "patch")
)
async def patch(
    request: Request,
    actor: Actor,
    outfit_id: UUID,
    body: OutfitUpsert,
    if_match: Annotated[str, Header(alias="If-Match")],
):
    value = if_match
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    if not value.isascii() or not value.isdigit() or int(value) < 1:
        raise ApiError(422, "VALIDATION_ERROR", "If-Match requires a positive version")
    return await Sprint2(request).outfit_upsert(actor, body, target=outfit_id, version=int(value))


@router.get(
    "/style-references", response_model=StyleReferenceList, **metadata("/style-references", "get")
)
async def styles(
    request: Request,
    actor: Actor,
    member_id: UUID | None = None,
    source: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await Sprint2(request).style_list(actor, member_id, source, limit, offset)


@router.post(
    "/style-references",
    status_code=201,
    response_model=StyleReference,
    **metadata("/style-references", "post"),
)
async def style_create(request: Request, actor: Actor, body: StyleReferenceCreate, key: Key):
    return await Sprint2(request).style_create(actor, body, key)


@router.delete(
    "/style-references/{style_id}",
    status_code=204,
    **metadata("/style-references/{style_id}", "delete"),
)
async def style_delete(request: Request, actor: Actor, style_id: UUID):
    await Sprint2(request).style_delete(actor, style_id)
    return Response(status_code=204)
