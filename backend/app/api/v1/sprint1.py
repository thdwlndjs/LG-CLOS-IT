from functools import lru_cache
from typing import Annotated
from uuid import UUID

import yaml
from fastapi import APIRouter, Depends, Header, Query, Request

from app.application.common.authorization import ActorContext
from app.application.sprint1 import Sprint1
from app.core.errors import ApiError
from app.core.paths import DOCS_DIR
from app.core.rate_limit import rate_guard
from app.core.security import current_actor
from app.schemas.errors import ErrorEnvelope
from app.schemas.sprint1 import (
    Asset,
    AssetFinalizeRequest,
    ConsentHistory,
    Garment,
    GarmentDeleted,
    GarmentList,
    GarmentLocateRequest,
    GarmentUpsert,
    LocatedGarmentList,
    ObservationRequest,
    ObservationResponse,
    SessionStartRequest,
    SessionStartResponse,
    Settings,
    UploadIntentRequest,
    UploadIntentResponse,
)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(rate_guard)])
Actor = Annotated[ActorContext, Depends(current_actor)]
Key = Annotated[UUID, Header(alias="Idempotency-Key")]


@lru_cache
def source_contract():
    return yaml.safe_load((DOCS_DIR / "06_OPENAPI.yaml").read_text(encoding="utf-8"))


def metadata(path, method):
    source = source_contract()["paths"]["/api/v1" + path][method]
    return dict(
        operation_id=source["operationId"],
        summary=source["summary"],
        tags=source["tags"],
        openapi_extra={"x-fsd-ids": source["x-fsd-ids"]},
        responses={
            int(code): {"model": ErrorEnvelope, "description": response["description"]}
            for code, response in source["responses"].items()
            if int(code) >= 400
        },
    )


@router.post(
    "/sessions",
    status_code=201,
    response_model=SessionStartResponse,
    **metadata("/sessions", "post"),
)
async def sessions(request: Request, body: SessionStartRequest, key: Key):
    return await Sprint1(request).session_start(body, key)


def garment_wire(actor, value):
    if actor.personal_account:
        return value
    # Original OpenAPI forbids additional properties. Legacy credentials keep
    # the original wire shape; only the new personal login opts into extensions.
    data = value.model_dump(mode="json") if hasattr(value, "model_dump") else dict(value)
    if "items" in data:
        data["items"] = [{k: v for k, v in item.items() if k not in {"device_id", "name"}}
                         for item in data["items"]]
    else:
        data = {k: v for k, v in data.items() if k not in {"device_id", "name"}}
    return data


@router.get("/garments", response_model=GarmentList, response_model_exclude_unset=True,
            **metadata("/garments", "get"))
async def garments(
    request: Request,
    actor: Actor,
    member_id: UUID | None = None,
    owner_id: UUID | None = None,
    category: str | None = None,
    color: str | None = None,
    season: str | None = None,
    status: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    result = await Sprint1(request).listing(
        actor,
        dict(owner_id=owner_id, category=category, color=color, season=season, status=status),
        member_id,
        limit,
        offset,
    )
    return garment_wire(actor, result)


@router.post("/garments", status_code=201, response_model=Garment,
             response_model_exclude_unset=True, **metadata("/garments", "post"))
async def garment_create(request: Request, actor: Actor, body: GarmentUpsert, key: Key):
    return garment_wire(actor, await Sprint1(request).upsert(actor, body, key=key))


# Static path precedes the UUID path; /locate must not be interpreted as an ID.
@router.post(
    "/garments/locate",
    status_code=201,
    response_model=LocatedGarmentList,
    **metadata("/garments/locate", "post"),
)
async def locate(request: Request, actor: Actor, body: GarmentLocateRequest):
    return await Sprint1(request).listing(actor, body.model_dump(), None, None, 0, locate=True)


@router.get(
    "/garments/{garment_id}", response_model=Garment, response_model_exclude_unset=True,
    **metadata("/garments/{garment_id}", "get")
)
async def garment_detail(request: Request, actor: Actor, garment_id: UUID):
    return garment_wire(actor, await Sprint1(request).detail(actor, garment_id))


@router.patch(
    "/garments/{garment_id}", response_model=Garment, response_model_exclude_unset=True,
    **metadata("/garments/{garment_id}", "patch")
)
async def garment_patch(
    request: Request,
    actor: Actor,
    garment_id: UUID,
    body: GarmentUpsert,
    if_match: Annotated[str, Header(alias="If-Match")],
):
    value = if_match
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    if not value.isascii() or not value.isdigit() or int(value) < 1:
        raise ApiError(422, "VALIDATION_ERROR", "If-Match must contain a positive version")
    return garment_wire(actor, await Sprint1(request).upsert(
        actor, body, garment_id=garment_id, version=int(value)))


@router.post(
    "/garment-observations",
    status_code=201,
    response_model=ObservationResponse,
    **metadata("/garment-observations", "post"),
)
async def observation(request: Request, actor: Actor, body: ObservationRequest, key: Key):
    return await Sprint1(request).observation(actor, body, key)


@router.get("/settings", response_model=Settings, **metadata("/settings", "get"))
async def settings_get(request: Request, actor: Actor, member_id: UUID | None = None):
    return await Sprint1(request).settings_get(actor, member_id)


@router.put("/settings", response_model=Settings, **metadata("/settings", "put"))
async def settings_put(request: Request, actor: Actor, body: Settings):
    return await Sprint1(request).settings_put(actor, body)


@router.delete(
    "/garments/{garment_id}",
    response_model=GarmentDeleted,
    **metadata("/garments/{garment_id}", "delete"),
)
async def garment_delete(
    request: Request,
    actor: Actor,
    garment_id: UUID,
    if_match: Annotated[str, Header(alias="If-Match")],
):
    value = if_match
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    if not value.isascii() or not value.isdigit() or int(value) < 1:
        raise ApiError(422, "VALIDATION_ERROR", "If-Match must contain a positive version")
    return await Sprint1(request).delete(actor, garment_id, int(value))


@router.get(
    "/settings/consent-history",
    response_model=ConsentHistory,
    **metadata("/settings/consent-history", "get"),
)
async def consent_history(request: Request, actor: Actor):
    return await Sprint1(request).consent_history(actor)


@router.post(
    "/assets/upload-intents",
    status_code=201,
    response_model=UploadIntentResponse,
    **metadata("/assets/upload-intents", "post"),
)
async def upload_intent(request: Request, actor: Actor, body: UploadIntentRequest, key: Key):
    from app.application.assets import Assets

    return await Assets(request).intent(actor, body, key)


@router.post(
    "/assets/{asset_id}/finalize",
    status_code=201,
    response_model=Asset,
    **metadata("/assets/{asset_id}/finalize", "post"),
)
async def asset_finalize(
    request: Request, actor: Actor, asset_id: UUID, body: AssetFinalizeRequest, key: Key
):
    from app.application.assets import Assets

    return await Assets(request).finalize(actor, asset_id, body, key)
