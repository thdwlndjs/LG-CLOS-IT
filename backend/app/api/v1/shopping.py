from uuid import UUID, uuid4

from fastapi import Request
from pydantic import BaseModel, ConfigDict

from app.api.v1.integration import Actor, Key, accessible, router
from app.application.common.idempotency import idempotent
from app.application.sprint3 import ready_asset
from app.core.errors import ApiError
from app.infrastructure.adapters.shopping import LIKED, list_items
from app.infrastructure.db.sprint1_repository import Sprint1Repository


class BulkImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: UUID


class LikedVton(BaseModel):
    model_config = ConfigDict(extra="forbid")
    external_item_id: str
    person_asset_id: UUID


@router.get("/shopping/purchases")
async def purchases(actor: Actor):
    return dict(items=list_items("PURCHASED"), provider="MOCK", is_mock=True)


@router.get("/shopping/liked")
async def liked(actor: Actor):
    return dict(items=list_items("LIKED"), provider="MOCK", is_mock=True)


@router.post("/shopping/purchases/bulk-import", status_code=201)
async def bulk_import(request: Request, actor: Actor, body: BulkImport, key: Key):
    async with request.app.state.resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        await accessible(repo, actor, body.device_id)

        async def action():
            await repo.lock(f"purchase-import:{actor.member_id}")
            results = []
            for item in list_items("PURCHASED"):
                if item["status"] in {"CANCELLED", "RETURNED"}:
                    results.append(dict(item_id=item["id"], status="SKIPPED",
                                        reason=item["status"]))
                    continue
                if (item["status"] != "PURCHASED" or not item["category"] or not item["color"]
                        or not isinstance(item["quantity"], int) or item["quantity"] < 1):
                    results.append(dict(item_id=item["id"], status="NEEDS_REVIEW",
                                        reason="REQUIRED_INFORMATION_MISSING"))
                    continue
                for unit in range(1, item["quantity"] + 1):
                    previous = await repo.one(
                        "SELECT garment_id FROM wardrobe.shopping_import WHERE member_id=:m "
                        "AND provider='MOCK' AND external_item_id=:item AND unit=:unit",
                        m=actor.member_id, item=item["id"], unit=unit,
                    )
                    if previous:
                        results.append(dict(item_id=item["id"], unit=unit, status="SKIPPED",
                                            reason="ALREADY_IMPORTED",
                                            garment_id=str(previous["garment_id"])))
                        continue
                    garment_id = uuid4()
                    await repo.execute(
                        "INSERT INTO wardrobe.garment(id,household_id,owner_id,device_id,name,"
                        "category,color) VALUES(:id,:h,:m,:d,:name,:category,:color)",
                        id=garment_id, h=actor.household_id, m=actor.member_id, d=body.device_id,
                        name=item["name"], category=item["category"], color=item["color"],
                    )
                    await repo.execute(
                        "INSERT INTO wardrobe.garment_state(garment_id) VALUES(:id)", id=garment_id,
                    )
                    await repo.execute(
                        "INSERT INTO wardrobe.shopping_import(member_id,provider,external_item_id,"
                        "unit,garment_id) VALUES(:m,'MOCK',:item,:unit,:g)",
                        m=actor.member_id, item=item["id"], unit=unit, g=garment_id,
                    )
                    results.append(dict(item_id=item["id"], unit=unit, status="REGISTERED",
                                        garment_id=str(garment_id)))
            return dict(provider="MOCK", is_mock=True, results=results,
                        counts={s.lower(): sum(r["status"] == s for r in results)
                                for s in ("REGISTERED", "SKIPPED", "NEEDS_REVIEW", "FAILED")})

        return await idempotent(repo, actor.member_id, "shopping_bulk_import", key,
                                body.model_dump(mode="json"), 201, action)


@router.post("/shopping/liked/vton-jobs", status_code=202)
async def liked_vton(request: Request, actor: Actor, body: LikedVton, key: Key):
    if body.external_item_id not in {i["id"] for i in LIKED}:
        raise ApiError(404, "NOT_FOUND", "Liked product not found")
    async with request.app.state.resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        await ready_asset(repo, actor, body.person_asset_id, "PERSON", actor.member_id)

        async def action():
            job_id = uuid4()
            await repo.execute(
                "INSERT INTO wardrobe.job(id,household_id,member_id,kind) VALUES(:id,:h,:m,'VTON')",
                id=job_id, h=actor.household_id, m=actor.member_id,
            )
            await repo.execute(
                "INSERT INTO wardrobe.external_vton_job(job_id,external_item_id,provider,"
                "person_asset_id) VALUES(:id,:item,'MOCK',:person)",
                id=job_id, item=body.external_item_id, person=body.person_asset_id,
            )
            return dict(job_id=str(job_id), status="QUEUED", provider="MOCK", is_mock=True,
                        status_url=f"/api/v1/integration/shopping/liked/vton-jobs/{job_id}")

        return await idempotent(repo, actor.member_id, "liked_vton", key,
                                body.model_dump(mode="json"), 202, action)


@router.get("/shopping/liked/vton-jobs/{job_id}")
async def liked_job(request: Request, actor: Actor, job_id: UUID):
    from app.application.assets import signed_asset

    async with request.app.state.resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        row = await repo.one(
            "SELECT j.id,j.status,j.error_code,v.person_asset_id,a.id AS asset_id,a.asset_key,"
            "a.content_type FROM wardrobe.job j JOIN wardrobe.external_vton_job v ON v.job_id=j.id "
            "LEFT JOIN wardrobe.asset a ON a.id=v.result_asset_id AND a.status='READY' "
            "AND a.retention_expires_at>now() WHERE j.id=:id AND j.member_id=:m "
            "AND j.household_id=:h",
            id=job_id, m=actor.member_id, h=actor.household_id,
        )
        if not row:
            raise ApiError(404, "NOT_FOUND", "Job not found")
        await ready_asset(repo, actor, row["person_asset_id"], "PERSON", actor.member_id)
        return dict(id=row["id"], status=row["status"], provider="MOCK", is_mock=True,
                    error_code=row["error_code"], result_asset=signed_asset(
                        request.app.state.settings, row) if row["asset_id"] else None)
