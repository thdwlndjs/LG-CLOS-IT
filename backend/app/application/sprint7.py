import asyncio
import logging
from datetime import UTC, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.application.common.authorization import require_self
from app.application.sprint6 import Sprint6
from app.core.clock import utc_now
from app.core.errors import ApiError
from app.infrastructure.db.sprint1_repository import Sprint1Repository
from app.schemas.sprint1 import Member
from app.schemas.sprint2 import OutfitCandidate
from app.schemas.sprint7 import HomeDashboard


class Sprint7(Sprint6):
    async def isolated(self, name, callback, empty):
        try:
            return await asyncio.wait_for(callback(), timeout=3)
        except Exception:
            logging.getLogger("wardrobe").warning(
                "home_source_unavailable", extra={"source": name, "outcome": "UNAVAILABLE"}
            )
            return empty, "UNAVAILABLE"

    async def home(self, actor, member_id, at, timezone):
        require_self(actor, member_id or actor.member_id)
        now = utc_now()
        at = at or now
        if at.tzinfo is None or at.utcoffset() is None or at > now:
            raise ApiError(422, "VALIDATION_ERROR", "Non-future timestamp with offset required")
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT m.id,m.household_id,m.display_name,m.role,s.timezone "
                "FROM wardrobe.member m LEFT JOIN wardrobe.member_settings s ON s.member_id=m.id "
                "WHERE m.id=:m AND m.household_id=:h",
                m=actor.member_id,
                h=actor.household_id,
            )
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Member not found")
        timezone = timezone or row["timezone"] or "UTC"
        try:
            zone = ZoneInfo(timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ApiError(422, "VALIDATION_ERROR", "Valid IANA timezone required") from None
        day = at.astimezone(zone).date()
        start = datetime.combine(day, time.min, zone).astimezone(UTC)
        end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC)
        context, context_status = await self.isolated(
            "context", lambda: self.home_context(actor, start, at), None
        )
        results = await asyncio.gather(
            self.isolated(
                "recommendations", lambda: self.home_outfits(actor, context, start, at), []
            ),
            self.isolated("care", lambda: self.home_care(actor, end, at), []),
            self.isolated("storage", lambda: self.home_storage(actor, at), []),
        )
        status = dict(context=context_status)
        for name, result in zip(("recommendations", "care", "storage"), results, strict=True):
            status[name] = result[1]
        return HomeDashboard(
            member=Member(**{k: row[k] for k in ("id", "household_id", "display_name", "role")}),
            today_context=context,
            today_outfits=results[0][0],
            care_alerts=results[1][0],
            storage_alerts=results[2][0],
            updated_at=utc_now(),
            at=at,
            timezone=timezone,
            partial=any(v in ("STALE", "UNAVAILABLE", "TRUNCATED") for v in status.values())
            or context is None
            or bool(context.missing_fields),
            source_status=status,
        )

    async def home_context(self, actor, start, at):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT * FROM wardrobe.context_snapshot WHERE member_id=:m "
                "AND captured_at<=:at AND captured_at>=:old "
                "ORDER BY captured_at DESC,id DESC LIMIT 1",
                m=actor.member_id,
                at=at,
                old=at - timedelta(days=7),
            )
            if not row:
                return None, "EMPTY"
            context = self.context_dto(row)
            stale = row["captured_at"] < start
            if stale:
                context.source_status = {
                    name: value.model_copy(update={"freshness": "STALE"})
                    for name, value in context.source_status.items()
                }
                if context.source_mode != "MOCK":
                    context.source_mode = "CACHED"
            return context, "STALE" if stale else "FRESH"

    async def home_outfits(self, actor, context, start, at):
        if context is None:
            return [], "EMPTY"
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            row = await repo.one(
                "SELECT payload FROM wardrobe.domain_event_outbox WHERE household_id=:h "
                "AND event_type='OutfitRecommended' AND payload->>'context_snapshot_id'=:c "
                "AND created_at>=:start AND created_at<=:at "
                "ORDER BY created_at DESC,id DESC LIMIT 1",
                h=actor.household_id,
                c=str(context.id),
                start=start,
                at=at,
            )
            if not row:
                return [], "EMPTY"
            candidates = []
            stale = False
            raw = row["payload"]["candidates"]
            for value in raw[:5]:
                stored = value["outfit"]
                current = await self.require_outfit(repo, actor, UUID(stored["id"]))
                outfit = await self.outfit_dto(repo, actor, current)
                if outfit.version != stored["version"] or not outfit.try_on_ready:
                    stale = True
                    continue
                candidates.append(
                    OutfitCandidate(outfit=outfit, score=value["score"], reasons=value["reasons"])
                )
            return candidates, "TRUNCATED" if len(raw) > 5 else "STALE" if stale else "FRESH"

    async def home_care(self, actor, end, at):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            rows = await repo.all(
                "SELECT s.* FROM wardrobe.care_schedule s "
                "JOIN wardrobe.garment g ON g.id=s.garment_id "
                "WHERE g.household_id=:h AND g.owner_id=:m AND g.retired_at IS NULL "
                "AND s.status='SCHEDULED' AND s.scheduled_at<:end "
                "ORDER BY s.scheduled_at,s.id LIMIT 21",
                h=actor.household_id,
                m=actor.member_id,
                end=end,
            )
            values = [await self.schedule_dto(repo, r) for r in rows[:20]]
            for value in values:
                value.status = "OVERDUE" if value.scheduled_at < at else "SCHEDULED"
            return values, "TRUNCATED" if len(rows) > 20 else "FRESH"

    async def home_storage(self, actor, at):
        async with self.sessions.begin() as session:
            repo = Sprint1Repository(session)
            rows = await repo.all(
                "SELECT * FROM wardrobe.storage_action WHERE household_id=:h AND requested_by=:m "
                "AND status IN ('PROPOSED','APPROVED','IN_PROGRESS','AWAITING_CONFIRMATION') "
                "AND (expires_at IS NULL OR expires_at>:at) ORDER BY created_at,id LIMIT 21",
                h=actor.household_id,
                m=actor.member_id,
                at=max(at, utc_now()),
            )
            return [await self.action_dto(repo, r) for r in rows[:20]], "TRUNCATED" if len(
                rows
            ) > 20 else "FRESH"
