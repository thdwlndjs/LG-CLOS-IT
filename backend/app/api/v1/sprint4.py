from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from app.api.v1.sprint1 import Actor, Key, metadata
from app.application.sprint4 import Sprint4
from app.core.rate_limit import rate_guard
from app.schemas.sprint3 import AcceptedJob
from app.schemas.sprint4 import (
    CardDraft,
    CardDraftList,
    CardPrepareRequest,
    CardRenderRequest,
    CardSaveRequest,
)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(rate_guard)])


@router.post(
    "/cards/drafts", status_code=201, response_model=CardDraft, **metadata("/cards/drafts", "post")
)
async def prepare(request: Request, actor: Actor, body: CardPrepareRequest, key: Key):
    return await Sprint4(request).card_prepare(actor, body, key)


@router.post(
    "/card-render-jobs",
    status_code=202,
    response_model=AcceptedJob,
    **metadata("/card-render-jobs", "post"),
)
async def render(request: Request, actor: Actor, body: CardRenderRequest, key: Key):
    return await Sprint4(request).card_render(actor, body, key)


@router.get("/cards", response_model=CardDraftList, **metadata("/cards", "get"))
async def cards(
    request: Request,
    actor: Actor,
    member_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await Sprint4(request).card_list(actor, member_id, limit, offset)


@router.get("/cards/{card_id}", response_model=CardDraft, **metadata("/cards/{card_id}", "get"))
async def card(request: Request, actor: Actor, card_id: UUID):
    return await Sprint4(request).card_get(actor, card_id)


@router.post(
    "/cards/{card_id}/save",
    status_code=201,
    response_model=CardDraft,
    **metadata("/cards/{card_id}/save", "post"),
)
async def save(request: Request, actor: Actor, card_id: UUID, body: CardSaveRequest, key: Key):
    return await Sprint4(request).card_save(actor, card_id, body, key)


share_metadata = metadata("/card-shares/{token}", "get")
share_metadata["openapi_extra"]["security"] = []
share_metadata["responses"][200] = {
    "description": "Private image shared by explicit bearer link",
    "content": {
        mime: {"schema": {"type": "string", "format": "binary"}}
        for mime in ("image/png", "image/webp")
    },
}


@router.get("/card-shares/{token}", response_class=Response, **share_metadata)
async def share(request: Request, token: str):
    data, content_type = await Sprint4(request).card_share(token)
    return Response(
        data,
        media_type=content_type,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
