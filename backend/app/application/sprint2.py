from datetime import UTC, timedelta
from urllib.parse import urlsplit
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.application.assets import signed_asset
from app.application.common.authorization import require_self
from app.application.common.idempotency import canonical, idempotent
from app.application.sprint1 import Sprint1, nonblank
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.domain.recommendations import RULE_VERSION, rank_candidates
from app.infrastructure.adapters.context import collect_context
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint2 import Context, Outfit, StyleReference


class Sprint2(Sprint1):
    async def require_context(self, repo, actor, context_id):
        row = await repo.one(
            "SELECT * FROM wardrobe.context_snapshot WHERE id=:id AND member_id=:m",
            id=context_id,
            m=actor.member_id,
        )
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Context not found")
        return row

    def context_dto(self, row):
        weather = row["weather"]
        provenance = weather.get("_provenance", {})
        missing = list(provenance.get("missing_fields", []))
        valid_weather = {}
        for name in ("temperature_c", "humidity_pct", "precipitation_mm", "condition"):
            value = weather.get(name)
            if value is not None and (
                isinstance(value, str)
                if name == "condition"
                else isinstance(value, int | float) and not isinstance(value, bool)
            ):
                valid_weather[name] = value
            else:
                missing.append("weather." + name)
        schedule = []
        for index, event in enumerate(row["schedule"]):
            if not isinstance(event, dict) or not event.get("kind") or not event.get("starts_at"):
                missing.append(f"schedule[{index}].starts_at/kind")
                continue
            try:
                from app.schemas.sprint2 import ContextSchedule

                parsed = ContextSchedule(
                    **{k: event[k] for k in ("kind", "starts_at", "people") if k in event}
                )
                if parsed.starts_at.tzinfo is None:
                    raise ValueError("Schedule timestamp has no offset")
                schedule.append(parsed)
            except ValueError:
                missing.append(f"schedule[{index}]")
        if row["is_holiday"] is None:
            missing.append("is_holiday")
        status = provenance.get("source_status", {})
        if not status:
            status = {
                name: dict(
                    source="LEGACY_SNAPSHOT",
                    observed_at=row["captured_at"],
                    freshness="UNKNOWN",
                    is_mock=row["source_mode"] == "MOCK",
                    missing_fields=[x for x in missing if x.startswith(name)],
                )
                for name in ("weather", "schedule")
            }
        return Context(
            id=row["id"],
            member_id=row["member_id"],
            captured_at=row["captured_at"],
            timezone=row["timezone"],
            source_mode=row["source_mode"],
            weather=valid_weather,
            schedule=schedule,
            location_label=row["location_label"],
            is_holiday=row["is_holiday"],
            missing_fields=sorted(set(missing)),
            source_status=status,
        )

    async def context_get(self, actor, context_id):
        async with self.sessions.begin() as session:
            return self.context_dto(
                await self.require_context(Sprint1Repository(session), actor, context_id)
            )

    async def context_capture(self, actor, body, key):
        require_self(actor, body.member_id)
        try:
            ZoneInfo(body.timezone)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid timezone") from exc
        at = body.at or utc_now()
        if at > utc_now():
            raise ApiError(422, "VALIDATION_ERROR", "Future Context timestamps are not allowed")
        if body.mode == "MOCK" and (
            self.settings.app_env not in {"local", "test"} or self.settings.public_deployment
        ):
            raise ApiError(403, "FORBIDDEN", "Mock Context requires private development")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                weather, schedule, provenance, source = collect_context(
                    self.settings, body.mode, at
                )
                weather["_provenance"] = provenance
                target = uuid4()
                await repo.execute(
                    "INSERT INTO "
                    "wardrobe.context_snapshot(id,member_id,captured_at,timezone,weather,"
                    "schedule,source_mode) "
                    "VALUES (:id,:m,:at,:tz,CAST(:w AS jsonb),CAST(:s AS jsonb),:source)",
                    id=target,
                    m=actor.member_id,
                    at=at.astimezone(UTC),
                    tz=body.timezone,
                    w=canonical(weather),
                    s=canonical(schedule),
                    source=source,
                )
                response = self.context_dto(
                    await self.require_context(repo, actor, target)
                ).model_dump(mode="json")
                await self.event(repo, actor, "ContextCaptured", "context", target, response)
                return response

            return await idempotent(
                repo,
                actor.member_id,
                "context_capture",
                key,
                body.model_dump(mode="json"),
                201,
                create,
            )

    async def outfit_dto(self, repo, actor, row):
        items = await repo.all(
            "SELECT garment_id,slot,position FROM wardrobe.outfit_item WHERE "
            "outfit_id=:id ORDER BY position,CASE slot WHEN 'TOP' THEN 1 "
            "WHEN 'BOTTOM' THEN 2 WHEN 'DRESS' THEN 3 WHEN 'SHOES' THEN 4 "
            "WHEN 'OUTER' THEN 5 ELSE 6 END,garment_id",
            id=row["id"],
        )
        missing = []
        available = True
        for item in items:
            garment = await repo.garment(actor, item["garment_id"])
            if garment is None:
                missing.append(item["garment_id"])
                available = False
            elif garment["status"] != "AVAILABLE":
                available = False
        slots = {item["slot"] for item in items}
        ready = bool(
            ("DRESS" in slots or {"TOP", "BOTTOM"} <= slots)
            and not missing
            and available
            and row["status"] != "ARCHIVED"
        )
        return Outfit(
            **dict(row),
            items=[dict(i) for i in items],
            missing_garment_ids=missing,
            try_on_ready=ready,
        )

    async def require_outfit(self, repo, actor, target, lock=False):
        row = await repo.one(
            "SELECT id,member_id,title,status::text AS status,version,created_at "
            "FROM wardrobe.outfit "
            "WHERE id=:id AND member_id=:m" + (" FOR UPDATE" if lock else ""),
            id=target,
            m=actor.member_id,
        )
        if row is None:
            raise ApiError(404, "NOT_FOUND", "Outfit not found")
        return row

    async def outfit_get(self, actor, target):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            return await self.outfit_dto(
                repo, actor, await self.require_outfit(repo, actor, target)
            )

    async def outfit_list(self, actor, member_id, status, limit, offset):
        require_self(actor, member_id or actor.member_id)
        if status is not None and status not in {"DRAFT", "SAVED", "ARCHIVED"}:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid outfit status")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await repo.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            where = " WHERE member_id=:m" + (" AND status::text=:status" if status else "")
            params = dict(m=actor.member_id, **(dict(status=status) if status else {}))
            total = await repo.one(
                "SELECT count(*) AS total FROM wardrobe.outfit" + where, **params
            )
            rows = await repo.all(
                "SELECT id,member_id,title,status::text AS status,version,created_at "
                "FROM wardrobe.outfit"
                + where
                + " ORDER BY created_at,id LIMIT :limit OFFSET :offset",
                **params,
                limit=limit,
                offset=offset,
            )
            return dict(
                items=[await self.outfit_dto(repo, actor, r) for r in rows],
                page=dict(limit=limit, offset=offset, total=total["total"]),
            )

    async def validate_items(self, repo, actor, items, status, available=False):
        if len(items) > 6:
            raise ApiError(422, "VALIDATION_ERROR", "At most six items are allowed")
        seen = set()
        positions = set()
        slots = set()
        # Locks prevent retirement or grant mutation during reference validation/commit.
        for item in sorted(items, key=lambda i: str(i.garment_id)):
            if (
                item.position < 0
                or item.garment_id in seen
                or (item.slot, item.position) in positions
            ):
                raise ApiError(
                    422, "VALIDATION_ERROR", "Duplicate garment/slot or invalid position"
                )
            if item.slot != "ACCESSORY" and item.slot in slots:
                raise ApiError(422, "VALIDATION_ERROR", "Duplicate slot")
            await repo.one(
                "SELECT id FROM wardrobe.garment WHERE id=:id FOR SHARE", id=item.garment_id
            )
            garment = await repo.garment(actor, item.garment_id)
            if garment is None:
                raise ApiError(404, "NOT_FOUND", "Garment unavailable")
            if garment["category"] != item.slot:
                raise ApiError(422, "VALIDATION_ERROR", "Garment category and slot differ")
            if available:
                care = await repo.one(
                    "SELECT special_care FROM wardrobe.care_profile WHERE garment_id=:id FOR SHARE",
                    id=item.garment_id,
                )
                if garment["status"] != "AVAILABLE" or care and care["special_care"]:
                    raise ApiError(409, "CONFLICT", "Candidate eligibility changed")
            seen.add(item.garment_id)
            positions.add((item.slot, item.position))
            slots.add(item.slot)
        if "DRESS" in slots and slots & {"TOP", "BOTTOM"}:
            raise ApiError(422, "VALIDATION_ERROR", "DRESS cannot be mixed with TOP/BOTTOM")
        if status == "SAVED" and not ("DRESS" in slots or {"TOP", "BOTTOM"} <= slots):
            raise ApiError(422, "VALIDATION_ERROR", "Saved outfit needs TOP/BOTTOM or DRESS")

    async def insert_outfit(self, repo, actor, target, title, status, items):
        await repo.execute(
            "INSERT INTO wardrobe.outfit(id,member_id,title,status) VALUES "
            "(:id,:m,:title,CAST(:status AS wardrobe.outfit_status))",
            id=target,
            m=actor.member_id,
            title=title,
            status=status,
        )
        await self.replace_items(repo, target, items)

    async def replace_items(self, repo, target, items):
        await repo.execute("DELETE FROM wardrobe.outfit_item WHERE outfit_id=:id", id=target)
        for item in items:
            await repo.execute(
                "INSERT INTO wardrobe.outfit_item(outfit_id,garment_id,slot,position) "
                "VALUES (:id,:g,:slot,:p)",
                id=target,
                g=item.garment_id,
                slot=item.slot,
                p=item.position,
            )

    async def outfit_upsert(self, actor, body, key=None, target=None, version=None):
        nonblank(body.title)
        if len(body.title) > 200:
            raise ApiError(422, "VALIDATION_ERROR", "Title too long")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def mutate():
                if target:
                    row = await self.require_outfit(repo, actor, target, lock=True)
                    linked = await repo.one(
                        "SELECT id FROM wardrobe.outfit_session_event "
                        "WHERE payload->>'outfit_id'=:o LIMIT 1",
                        o=str(target),
                    )
                    if linked:
                        raise ApiError(409, "CONFLICT", "Session snapshots require VTON editing")
                    if row["version"] != version or row["status"] == "ARCHIVED":
                        raise ApiError(409, "CONFLICT", "Outfit changed or archived")
                elif body.status == "ARCHIVED":
                    raise ApiError(422, "VALIDATION_ERROR", "Cannot create an archived outfit")
                # Archiving preserves even references that have since been retired/revoked.
                if body.status != "ARCHIVED":
                    await self.validate_items(repo, actor, body.items, body.status)
                elif sorted((str(i.garment_id), i.slot, i.position) for i in body.items) != sorted(
                    (str(i.garment_id), i.slot, i.position)
                    for i in (await self.outfit_dto(repo, actor, row)).items
                ):
                    raise ApiError(409, "CONFLICT", "Archive must preserve existing items")
                identity = target or uuid4()
                if target:
                    payload = body.model_dump(mode="json", exclude_unset=True)
                    title = body.title if "title" in body.model_fields_set else row["title"]
                    status = body.status if "status" in body.model_fields_set else row["status"]
                    # Validate the effective saved state, even if the status was omitted.
                    if status != "ARCHIVED":
                        await self.validate_items(repo, actor, body.items, status)
                    await repo.execute(
                        "UPDATE wardrobe.outfit SET title=:title,status=CAST(:status AS "
                        "wardrobe.outfit_status),version=version+1,updated_at=now() WHERE id=:id",
                        id=target,
                        title=title,
                        status=status,
                    )
                    await self.replace_items(repo, target, body.items)
                else:
                    payload = body.model_dump(mode="json")
                    await self.insert_outfit(
                        repo, actor, identity, body.title, body.status, body.items
                    )
                await self.event(
                    repo,
                    actor,
                    "OutfitModified" if target else "OutfitSaved",
                    "outfit",
                    identity,
                    payload,
                )
                return (
                    await self.outfit_dto(
                        repo, actor, await self.require_outfit(repo, actor, identity)
                    )
                ).model_dump(mode="json")

            if target:
                return await mutate()
            return await idempotent(
                repo,
                actor.member_id,
                "outfit_create",
                key,
                body.model_dump(mode="json"),
                201,
                mutate,
            )

    async def recommend(self, actor, body, key):
        require_self(actor, body.member_id)
        if isinstance(body.limit, bool) or not 1 <= body.limit <= 20:
            raise ApiError(422, "VALIDATION_ERROR", "Recommendation limit must be 1..20")
        if body.theme not in {None, "CASUAL", "WORK", "FORMAL", "SPORT"}:
            raise ApiError(422, "VALIDATION_ERROR", "Unsupported theme")
        constraints = body.constraints
        if set(constraints) - {"excluded_garment_ids", "season", "max_items"}:
            raise ApiError(422, "VALIDATION_ERROR", "Unsupported constraint")
        excluded = constraints.get("excluded_garment_ids", [])
        if not isinstance(excluded, list) or len(excluded) > 200:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid exclusion list")
        try:
            excluded = {str(UUID(x)) for x in excluded if isinstance(x, str)}
            if len(excluded) != len(constraints.get("excluded_garment_ids", [])):
                raise ValueError("Invalid or duplicate IDs")
        except (ValueError, TypeError) as exc:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid exclusion IDs") from exc
        season = constraints.get("season")
        if season is not None and not isinstance(season, str):
            raise ApiError(422, "VALIDATION_ERROR", "Invalid season")
        maximum = constraints.get("max_items", 6)
        if (
            season not in {None, "SPRING", "SUMMER", "AUTUMN", "WINTER", "ALL"}
            or type(maximum) is not int
            or not 2 <= maximum <= 6
        ):
            raise ApiError(422, "VALIDATION_ERROR", "Invalid season/max_items")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def generate():
                snapshot = await self.require_context(repo, actor, body.context_snapshot_id)
                context = self.context_dto(snapshot)
                rows, total = await repo.garments(actor, dict(status="AVAILABLE"), 200, 0)
                care = await repo.all(
                    "SELECT garment_id FROM wardrobe.care_profile WHERE special_care"
                )
                forbidden = {c["garment_id"] for c in care}
                garments = [{**dict(r), "special_care": r["id"] in forbidden} for r in rows]
                at = context.captured_at
                history_rows = await repo.all(
                    "SELECT i.garment_id,count(*) AS n FROM wardrobe.wear_event w JOIN "
                    "wardrobe.outfit_item i ON i.outfit_id=w.outfit_id "
                    "JOIN wardrobe.outfit o ON o.id=w.outfit_id "
                    "WHERE w.member_id=:m AND w.items_snapshot IS NULL "
                    "AND w.cancelled_at IS NULL AND w.worn_at BETWEEN :since AND :at AND "
                    "w.confirmed_at<=:at AND o.updated_at<=w.worn_at GROUP BY i.garment_id",
                    m=actor.member_id,
                    at=at,
                    since=at - timedelta(days=7),
                )
                frozen_history = await repo.all(
                    "SELECT item->>'garment_id' AS garment_id,count(*) AS n "
                    "FROM wardrobe.wear_event w CROSS JOIN LATERAL "
                    "jsonb_array_elements(w.items_snapshot) item "
                    "WHERE w.member_id=:m AND w.cancelled_at IS NULL "
                    "AND w.worn_at BETWEEN :since AND :at AND w.confirmed_at<=:at "
                    "GROUP BY item->>'garment_id'",
                    m=actor.member_id,
                    at=at,
                    since=at - timedelta(days=7),
                )
                feedback = await repo.all(
                    "SELECT i.garment_id,sum(CASE WHEN f.feedback_type='REJECTED' THEN -1 "
                    "ELSE 1 END) AS n "
                    "FROM wardrobe.outfit_feedback f JOIN wardrobe.outfit o ON o.id=f.outfit_id "
                    "JOIN wardrobe.outfit_session s ON s.id=f.session_id JOIN "
                    "wardrobe.outfit_item i ON i.outfit_id=o.id "
                    "WHERE o.member_id=:m AND s.member_id=:m AND f.created_at<=:at "
                    "AND o.updated_at<=f.created_at "
                    "AND (f.feedback_type IN ('ACCEPTED','REJECTED') OR "
                    "(f.feedback_type='RATED' AND f.rating>=4)) GROUP BY i.garment_id",
                    m=actor.member_id,
                    at=at,
                )
                history = {str(r["garment_id"]): r["n"] for r in history_rows}
                for row in frozen_history:
                    identity = str(row["garment_id"])
                    history[identity] = history.get(identity, 0) + row["n"]
                preferences = {str(r["garment_id"]): r["n"] for r in feedback}
                schedule_theme = None
                local_day = at.astimezone(ZoneInfo(context.timezone)).date()
                for event in sorted(context.schedule, key=lambda event: event.starts_at):
                    if (
                        event.kind in {"CASUAL", "WORK", "FORMAL", "SPORT"}
                        and event.starts_at.astimezone(ZoneInfo(context.timezone)).date()
                        == local_day
                    ):
                        schedule_theme = event.kind
                        break
                ranked = rank_candidates(
                    garments,
                    temperature=context.weather.temperature_c,
                    season=season,
                    theme=body.theme or schedule_theme,
                    excluded=excluded,
                    max_items=maximum,
                    history=history,
                    preference=preferences,
                    limit=body.limit,
                )
                from app.schemas.sprint2 import OutfitItem

                candidates = []
                for candidate in ranked:
                    items = [
                        OutfitItem(garment_id=g["id"], slot=g["category"], position=0)
                        for g in candidate["items"]
                    ]
                    await self.validate_items(repo, actor, items, "SAVED", available=True)
                    identity = uuid4()
                    await self.insert_outfit(
                        repo, actor, identity, "Recommended Look", "DRAFT", items
                    )
                    candidate["reasons"].append(f"Context source: {context.source_mode}")
                    if not body.theme and schedule_theme:
                        candidate["reasons"].append(f"Snapshot schedule kind: {schedule_theme}")
                    candidates.append(
                        dict(
                            outfit=(
                                await self.outfit_dto(
                                    repo, actor, await self.require_outfit(repo, actor, identity)
                                )
                            ).model_dump(mode="json"),
                            score=candidate["score"],
                            reasons=candidate["reasons"],
                        )
                    )
                recommendation_id = uuid4()
                response = dict(
                    recommendation_id=str(recommendation_id),
                    context_snapshot_id=str(context.id),
                    candidates=candidates,
                    generated_at=utc_now().isoformat(),
                    fallback_used=bool(
                        not history
                        and not preferences
                        or context.missing_fields
                        or total > 200
                        or len(candidates) < body.limit
                    ),
                )
                await self.event(
                    repo,
                    actor,
                    "OutfitRecommended",
                    "recommendation",
                    recommendation_id,
                    {**response, "rule_version": RULE_VERSION, "eligible_pool_total": total},
                )
                return response

            return await idempotent(
                repo, actor.member_id, "recommend", key, body.model_dump(mode="json"), 201, generate
            )

    async def style_create(self, actor, body, key):
        require_self(actor, body.member_id)
        nonblank(body.title)
        if len(body.title) > 200:
            raise ApiError(422, "VALIDATION_ERROR", "Title too long")
        if body.source_url is not None:
            try:
                url = urlsplit(body.source_url)
                if (
                    len(body.source_url) > 2048
                    or url.scheme not in {"http", "https"}
                    or not url.hostname
                    or url.username
                    or url.password
                ):
                    raise ValueError("Invalid URL")
            except ValueError as exc:
                raise ApiError(
                    422, "VALIDATION_ERROR", "Use an HTTP(S) URL without credentials"
                ) from exc
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)

            async def create():
                image = None
                if body.image_asset_id is not None:
                    asset = await repo.one(
                        "SELECT id AS asset_id,asset_key,content_type FROM wardrobe.asset "
                        "WHERE id=:id AND household_id=:h AND "
                        "owner_id=:m "
                        "AND status='READY' AND kind='STYLE' AND retention_expires_at>now() "
                        "AND EXISTS "
                        "(SELECT 1 FROM wardrobe.member_settings WHERE member_id=:m AND "
                        "image_upload_consent)",
                        id=body.image_asset_id,
                        h=actor.household_id,
                        m=actor.member_id,
                    )
                    if asset is None:
                        raise ApiError(404, "NOT_FOUND", "Ready style asset not found")
                    image = signed_asset(self.settings, asset)
                identity = uuid4()
                await repo.execute(
                    "INSERT INTO "
                    "wardrobe.style_reference(id,member_id,source,source_url,"
                    "image_asset_id,title) VALUES "
                    "(:id,:member_id,:source,:source_url,:image_asset_id,:title)",
                    id=identity,
                    **body.model_dump(),
                )
                await self.event(
                    repo,
                    actor,
                    "StyleReferenceCreated",
                    "style",
                    identity,
                    body.model_dump(mode="json"),
                )
                row = await repo.one(
                    "SELECT * FROM wardrobe.style_reference WHERE id=:id", id=identity
                )
                return StyleReference(**row, image=image).model_dump(mode="json")

            return await idempotent(
                repo,
                actor.member_id,
                "style_create",
                key,
                body.model_dump(mode="json"),
                201,
                create,
            )

    async def style_list(self, actor, member_id, source, limit, offset):
        require_self(actor, member_id or actor.member_id)
        if source not in {None, "INSTAGRAM", "SHOPPING", "OTHER"}:
            raise ApiError(422, "VALIDATION_ERROR", "Invalid source filter")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await repo.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            where = " WHERE member_id=:m" + (" AND source=:source" if source else "")
            params = dict(m=actor.member_id, **(dict(source=source) if source else {}))
            total = await repo.one(
                "SELECT count(*) AS total FROM wardrobe.style_reference" + where, **params
            )
            rows = await repo.all(
                "SELECT s.id,s.member_id,s.source,s.source_url,s.title,s.created_at,"
                "CASE WHEN a.status='READY' AND a.retention_expires_at>now() AND "
                "ms.image_upload_consent THEN s.image_asset_id END AS image_asset_id, "
                "a.asset_key,a.content_type "
                "FROM wardrobe.style_reference s LEFT JOIN wardrobe.asset a ON "
                "a.id=s.image_asset_id AND a.owner_id=s.member_id AND a.kind='STYLE' "
                "LEFT JOIN wardrobe.member_settings ms ON ms.member_id=s.member_id"
                + where.replace("member_id=:m", "s.member_id=:m").replace(
                    "source=:source", "s.source=:source"
                )
                + " ORDER BY s.created_at,s.id LIMIT :limit OFFSET :offset",
                **params,
                limit=limit,
                offset=offset,
            )
            items = []
            for row in rows:
                data = dict(row)
                asset_key = data.pop("asset_key")
                content_type = data.pop("content_type")
                image = None
                if data["image_asset_id"]:
                    image = signed_asset(
                        self.settings,
                        dict(
                            asset_id=data["image_asset_id"],
                            asset_key=asset_key,
                            content_type=content_type,
                        ),
                    )
                items.append(StyleReference(**data, image=image))
            return dict(
                items=items,
                page=dict(limit=limit, offset=offset, total=total["total"]),
            )

    async def style_delete(self, actor, target):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT id FROM wardrobe.style_reference WHERE id=:id AND member_id=:m FOR UPDATE",
                id=target,
                m=actor.member_id,
            )
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Style reference not found")
            await repo.execute("DELETE FROM wardrobe.style_reference WHERE id=:id", id=target)
            await self.event(repo, actor, "StyleReferenceDeleted", "style", target, {})
