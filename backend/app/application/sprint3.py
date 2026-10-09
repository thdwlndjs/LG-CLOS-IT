from uuid import UUID, uuid4

from app.application.assets import signed_asset
from app.application.common.authorization import require_self
from app.application.common.idempotency import canonical, idempotent
from app.application.sprint2 import Sprint2
from app.core.errors import ApiError
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint2 import OutfitItem
from app.schemas.sprint3 import Job, VtonSession


async def ready_asset(repo, actor, identity, kind, owner=None):
    row = await repo.one(
        "SELECT a.*,a.id AS asset_id FROM wardrobe.asset a "
        "JOIN wardrobe.member_settings ms ON ms.member_id=a.owner_id "
        "WHERE a.id=:id AND a.household_id=:h AND a.owner_id=:m AND a.kind=:kind "
        "AND a.status='READY' AND a.retention_expires_at>now() AND ms.image_upload_consent",
        id=identity,
        h=actor.household_id,
        m=owner or actor.member_id,
        kind=kind,
    )
    if row is None:
        raise ApiError(409, "ASSET_UNAVAILABLE", "Consented ready image required")
    return row


async def input_assets(repo, actor, person, items):
    person = await ready_asset(repo, actor, person, "PERSON")
    assets = []
    for item in items:
        garment = await repo.garment(actor, item.garment_id)
        if garment is None:
            raise ApiError(404, "NOT_FOUND", "Garment unavailable")
        if garment["status"] != "AVAILABLE":
            raise ApiError(409, "GARMENT_UNAVAILABLE", "Garment is not available")
        if garment["category"] != item.slot:
            raise ApiError(409, "INPUT_CHANGED", "Garment slot changed")
        assets.append(
            await ready_asset(
                repo,
                actor,
                garment["image_asset_id"],
                "GARMENT",
                garment["owner_id"],
            )
        )
    return person, assets


class Sprint3(Sprint2):
    async def require_session(self, repo, actor, identity, lock=False):
        row = await repo.one(
            "SELECT * FROM wardrobe.outfit_session WHERE id=:id AND member_id=:m"
            + (" FOR UPDATE" if lock else ""),
            id=identity,
            m=actor.member_id,
        )
        if row is None:
            raise ApiError(404, "NOT_FOUND", "VTON session not found")
        return row

    async def session_event(self, repo, actor, row, name, payload):
        await repo.execute(
            "INSERT INTO wardrobe.outfit_session_event(session_id,event_type,revision,payload) "
            "VALUES (:s,:e,:r,CAST(:p AS jsonb))",
            s=row["id"],
            e=name,
            r=row["revision"],
            p=canonical(payload),
        )
        await self.event(repo, actor, name, "outfit_session", row["id"], payload)

    async def session_dto(self, repo, actor, row):
        initial = await repo.one(
            "SELECT payload FROM wardrobe.outfit_session_event "
            "WHERE session_id=:s AND event_type='VtonSessionCreated'",
            s=row["id"],
        )
        binding = initial["payload"] if initial else {}
        latest = await repo.one(
            "SELECT j.id,j.status,v.person_asset_id,v.outfit_revision,v.result_asset_id "
            "FROM wardrobe.job j JOIN wardrobe.vton_job v ON v.job_id=j.id "
            "WHERE v.session_id=:s ORDER BY j.created_at DESC,j.id DESC LIMIT 1",
            s=row["id"],
        )
        person = latest["person_asset_id"] if latest else binding.get("person_asset_id")
        outfit = await self.outfit_dto(
            repo,
            actor,
            await self.require_outfit(repo, actor, row["outfit_id"]),
        )
        reasons = []
        if row["status"] != "ACTIVE":
            reasons.append("SESSION_NOT_ACTIVE")
        if not outfit.try_on_ready:
            reasons.append("OUTFIT_NOT_READY")
        if not person:
            reasons.append("PERSON_IMAGE_REQUIRED")
        elif not reasons:
            try:
                await input_assets(repo, actor, person, outfit.items)
            except ApiError as error:
                reasons.append(error.code)
        current = None
        if (
            latest
            and latest["status"] == "SUCCEEDED"
            and row["status"] == "ACTIVE"
            and latest["outfit_revision"] == row["revision"]
        ):
            try:
                await ready_asset(repo, actor, latest["result_asset_id"], "VTON_RESULT")
                await input_assets(repo, actor, person, outfit.items)
                current = latest["id"]
            except ApiError:
                pass
        return VtonSession(
            **{
                k: row[k]
                for k in (
                    "id",
                    "member_id",
                    "source_screen",
                    "status",
                    "revision",
                    "outfit_id",
                    "context_snapshot_id",
                    "final_outfit_id",
                    "created_at",
                    "final_items_snapshot",
                )
            },
            source_outfit_id=binding.get("source_outfit_id"),
            person_asset_id=person,
            items=outfit.items,
            provider_mode=self.settings.vton_provider,
            vton_available=not reasons,
            unavailable_reasons=reasons,
            current_result_job_id=current,
            card_entry_payload=(
                dict(
                    outfit_id=str(row["final_outfit_id"]),
                    context_snapshot_id=str(row["context_snapshot_id"])
                    if row["context_snapshot_id"]
                    else None,
                )
                if row["status"] == "ENDED"
                else None
            ),
        )

    async def session_get(self, actor, identity):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            return await self.session_dto(
                repo, actor, await self.require_session(repo, actor, identity)
            )

    async def session_create(self, actor, body, key):
        require_self(actor, body.member_id)
        if body.garment_id and body.outfit_id:
            raise ApiError(422, "VALIDATION_ERROR", "Choose one entry outfit or garment")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                items = []
                if body.outfit_id:
                    source = await self.require_outfit(repo, actor, body.outfit_id, lock=True)
                    if source["status"] == "ARCHIVED":
                        raise ApiError(409, "CONFLICT", "Entry outfit archived")
                    items = (await self.outfit_dto(repo, actor, source)).items
                elif body.garment_id:
                    garment = await repo.garment(actor, body.garment_id)
                    if garment is None:
                        raise ApiError(404, "NOT_FOUND", "Entry garment not found")
                    if garment["category"] not in {
                        "TOP",
                        "BOTTOM",
                        "OUTER",
                        "SHOES",
                        "ACCESSORY",
                        "DRESS",
                    }:
                        raise ApiError(422, "VALIDATION_ERROR", "Unsupported entry slot")
                    items = [OutfitItem(garment_id=body.garment_id, slot=garment["category"])]
                await self.validate_items(repo, actor, items, "DRAFT")
                if body.context_snapshot_id:
                    await self.require_context(repo, actor, body.context_snapshot_id)
                if body.person_asset_id:
                    await ready_asset(repo, actor, body.person_asset_id, "PERSON")
                identity, outfit = uuid4(), uuid4()
                await self.insert_outfit(repo, actor, outfit, "VTON Draft", "DRAFT", items)
                await repo.execute(
                    "INSERT INTO wardrobe.outfit_session(id,member_id,source_screen,status,"
                    "outfit_id,context_snapshot_id) VALUES (:id,:m,:source,'ACTIVE',:o,:c)",
                    id=identity,
                    m=actor.member_id,
                    source=body.source_screen,
                    o=outfit,
                    c=body.context_snapshot_id,
                )
                row = await self.require_session(repo, actor, identity)
                await self.session_event(
                    repo,
                    actor,
                    row,
                    "VtonSessionCreated",
                    dict(
                        source_outfit_id=str(body.outfit_id) if body.outfit_id else None,
                        outfit_id=str(outfit),
                        person_asset_id=str(body.person_asset_id) if body.person_asset_id else None,
                        source_screen=body.source_screen,
                    ),
                )
                return (await self.session_dto(repo, actor, row)).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "vton_session_create",
                key,
                body.model_dump(mode="json"),
                201,
                create,
            )

    def editable(self, row, revision):
        if row["status"] != "ACTIVE" or row["revision"] != revision:
            raise ApiError(409, "CONFLICT", "Session ended or revision changed")

    async def session_modify(self, actor, identity, body):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await self.require_session(repo, actor, identity, True)
            self.editable(row, body.expected_revision)
            await self.validate_items(repo, actor, body.items, "DRAFT")
            outfit = uuid4()
            await self.insert_outfit(repo, actor, outfit, "VTON Draft", "DRAFT", body.items)
            await repo.execute(
                "UPDATE wardrobe.outfit_session SET outfit_id=:o,revision=revision+1,"
                "updated_at=now() WHERE id=:id",
                id=identity,
                o=outfit,
            )
            row = await self.require_session(repo, actor, identity)
            await self.session_event(
                repo,
                actor,
                row,
                "VtonOutfitModified",
                dict(
                    outfit_id=str(outfit),
                    items=[i.model_dump(mode="json") for i in body.items],
                ),
            )
            return await self.session_dto(repo, actor, row)

    async def session_end(self, actor, identity, body, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def end():
                row = await self.require_session(repo, actor, identity, True)
                self.editable(row, body.expected_revision)
                if body.final_outfit_id and body.final_outfit_id != row["outfit_id"]:
                    raise ApiError(409, "CONFLICT", "Final outfit must be current selection")
                outfit = await self.outfit_dto(
                    repo,
                    actor,
                    await self.require_outfit(repo, actor, row["outfit_id"], True),
                )
                await self.validate_items(repo, actor, outfit.items, "SAVED")
                items = [i.model_dump(mode="json") for i in outfit.items]
                if body.save_outfit:
                    await repo.execute(
                        "UPDATE wardrobe.outfit SET status='SAVED',version=version+1,"
                        "updated_at=now() WHERE id=:id",
                        id=outfit.id,
                    )
                await repo.execute(
                    "UPDATE wardrobe.outfit_session SET status='ENDED',final_outfit_id=:o,"
                    "final_items_snapshot=CAST(:items AS jsonb),ended_at=now(),updated_at=now() "
                    "WHERE id=:id",
                    id=identity,
                    o=outfit.id,
                    items=canonical(items),
                )
                initial = await repo.one(
                    "SELECT payload FROM wardrobe.outfit_session_event "
                    "WHERE session_id=:s AND event_type='VtonSessionCreated'",
                    s=identity,
                )
                original_items = await repo.all(
                    "SELECT garment_id,slot,position FROM wardrobe.outfit_item WHERE outfit_id=:id",
                    id=UUID(initial["payload"]["outfit_id"]),
                )
                baseline = {
                    (str(i["garment_id"]), i["slot"], i["position"]) for i in original_items
                }
                selected = {(str(i.garment_id), i.slot, i.position) for i in outfit.items}
                feedback = "ACCEPTED" if selected == baseline else "MODIFIED"
                await repo.execute(
                    "INSERT INTO wardrobe.outfit_feedback(session_id,outfit_id,feedback_type) "
                    "VALUES (:s,:o,:f)",
                    s=identity,
                    o=outfit.id,
                    f=feedback,
                )
                row = await self.require_session(repo, actor, identity)
                await self.session_event(
                    repo,
                    actor,
                    row,
                    "VtonSessionEnded",
                    dict(
                        final_outfit_id=str(outfit.id),
                        final_items_snapshot=items,
                        feedback=feedback,
                    ),
                )
                return (await self.session_dto(repo, actor, row)).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "vton_session_end",
                key,
                dict(session_id=str(identity), **body.model_dump(mode="json")),
                201,
                end,
            )

    async def job_create(self, actor, body, key):
        if body.provider != self.settings.vton_provider or body.provider != "MOCK":
            raise ApiError(503, "PROVIDER_CAPABILITY_UNAVAILABLE", "Live contract unverified")
        if self.settings.app_env not in {"local", "test"} or self.settings.public_deployment:
            raise ApiError(403, "FORBIDDEN", "Mock VTON requires private development")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                row = await self.require_session(repo, actor, body.session_id, True)
                self.editable(row, body.expected_revision)
                if row["outfit_id"] != body.outfit_id:
                    raise ApiError(409, "CONFLICT", "Job outfit is not current selection")
                outfit = await self.outfit_dto(
                    repo,
                    actor,
                    await self.require_outfit(repo, actor, body.outfit_id, True),
                )
                await self.validate_items(repo, actor, outfit.items, "SAVED", available=True)
                person, garments = await input_assets(
                    repo, actor, body.person_asset_id, outfit.items
                )
                identity = uuid4()
                payload = dict(
                    outfit_id=str(outfit.id),
                    items=[i.model_dump(mode="json") for i in outfit.items],
                    person_asset_id=str(person["id"]),
                    garment_asset_ids=[str(a["id"]) for a in garments],
                )
                await repo.execute(
                    "INSERT INTO wardrobe.job(id,household_id,member_id,kind,request_payload,"
                    "correlation_id,created_at,updated_at) VALUES (:id,:h,:m,'VTON',"
                    "CAST(:p AS jsonb),:c,clock_timestamp(),clock_timestamp())",
                    id=identity,
                    h=actor.household_id,
                    m=actor.member_id,
                    p=canonical(payload),
                    c=actor.correlation_id,
                )
                await repo.execute(
                    "INSERT INTO wardrobe.vton_job(job_id,session_id,outfit_revision,provider,"
                    "person_asset_id) VALUES (:id,:s,:r,:p,:person)",
                    id=identity,
                    s=body.session_id,
                    r=body.expected_revision,
                    p=body.provider,
                    person=body.person_asset_id,
                )
                await self.event(
                    repo,
                    actor,
                    "VtonJobRequested",
                    "job",
                    identity,
                    dict(
                        session_id=str(body.session_id),
                        revision=body.expected_revision,
                        provider_mode=body.provider,
                    ),
                )
                return dict(
                    job_id=str(identity), status="QUEUED", status_url=f"/api/v1/jobs/{identity}"
                )

            return await idempotent(
                repo,
                actor.member_id,
                "vton_job_create",
                key,
                body.model_dump(mode="json"),
                202,
                create,
            )

    async def require_job(self, repo, actor, identity, lock=False):
        row = await repo.one(
            "SELECT j.*,v.session_id,v.outfit_revision,v.provider,v.result_asset_id "
            "FROM wardrobe.job j JOIN wardrobe.vton_job v ON v.job_id=j.id "
            "WHERE j.id=:id AND j.member_id=:m AND j.household_id=:h"
            + (" FOR UPDATE OF j" if lock else ""),
            id=identity,
            m=actor.member_id,
            h=actor.household_id,
        )
        if row is None:
            raise ApiError(404, "NOT_FOUND", "VTON job not found")
        return row

    async def job_dto(self, repo, actor, row):
        session = await self.require_session(repo, actor, row["session_id"])
        latest = await repo.one(
            "SELECT j.id FROM wardrobe.job j JOIN wardrobe.vton_job v ON v.job_id=j.id "
            "WHERE v.session_id=:s ORDER BY j.created_at DESC,j.id DESC LIMIT 1",
            s=row["session_id"],
        )
        current = (
            row["outfit_revision"] == session["revision"]
            and session["status"] == "ACTIVE"
            and latest["id"] == row["id"]
        )
        image = None
        if row["status"] == "SUCCEEDED":
            try:
                source = await ready_asset(repo, actor, row["result_asset_id"], "VTON_RESULT")
                payload = row["request_payload"]
                await input_assets(
                    repo,
                    actor,
                    payload["person_asset_id"],
                    [OutfitItem(**i) for i in payload["items"]],
                )
                image = signed_asset(self.settings, source)
            except ApiError:
                current = False
        error = (
            dict(
                code=row["error_code"],
                message=row["error_message_safe"] or "Job failed",
                request_id=row["correlation_id"] or str(row["id"]),
                details={},
            )
            if row["error_code"]
            else None
        )
        return Job(
            **{
                k: row[k]
                for k in (
                    "id",
                    "kind",
                    "status",
                    "created_at",
                    "updated_at",
                    "progress_pct",
                    "attempt_count",
                    "session_id",
                    "outfit_revision",
                )
            },
            provider_mode=row["provider"],
            is_current=current,
            stale=not current,
            result_asset=image,
            error=error,
        )

    async def job_get(self, actor, identity):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            return await self.job_dto(repo, actor, await self.require_job(repo, actor, identity))

    async def job_cancel(self, actor, identity, key):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def cancel():
                row = await self.require_job(repo, actor, identity, True)
                if row["status"] not in {"QUEUED", "RUNNING"}:
                    raise ApiError(409, "CONFLICT", "Job is terminal")
                await repo.execute(
                    "UPDATE wardrobe.job SET status='CANCELLED',finished_at=now(),updated_at=now(),"
                    "lease_owner=NULL,leased_until=NULL WHERE id=:id",
                    id=identity,
                )
                await self.event(repo, actor, "VtonJobCancelled", "job", identity, {})
                return (
                    await self.job_dto(repo, actor, await self.require_job(repo, actor, identity))
                ).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "vton_job_cancel",
                key,
                dict(job_id=str(identity)),
                201,
                cancel,
            )
