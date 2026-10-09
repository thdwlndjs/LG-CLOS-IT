"""Parameterized SQL against the unchanged physical schema; no schema creation."""

from sqlalchemy import text


class Sprint1Repository:
    def __init__(self, session):
        self.session = session

    async def one(self, sql, **params):
        result = await self.session.execute(text(sql), params)
        return result.mappings().one_or_none()

    async def all(self, sql, **params):
        result = await self.session.execute(text(sql), params)
        return result.mappings().all()

    async def execute(self, sql, **params):
        return await self.session.execute(text(sql), params)

    async def lock(self, identity):
        # Transaction-scoped lock serializes a logical identity even before a row exists.
        await self.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(:identity,0))", identity=identity
        )

    async def garment(self, actor, garment_id, lock=False):
        if lock:
            await self.lock("storage-household:" + str(actor.household_id))
            await self.one(
                "SELECT id FROM wardrobe.garment WHERE id=:id AND household_id=:household "
                "AND owner_id=:owner AND retired_at IS NULL FOR UPDATE",
                id=garment_id,
                household=actor.household_id,
                owner=actor.member_id,
            )
        permission = "g.owner_id=:owner AND " + READ_PERMISSION if lock else READ_PERMISSION
        return await self.one(
            GARMENT_SELECT + " WHERE g.id=:id AND g.household_id=:household "
            "AND " + permission + " AND g.retired_at IS NULL",
            id=garment_id,
            household=actor.household_id,
            owner=actor.member_id,
            device_scope=actor.personal_account,
        )

    async def garments(self, actor, filters, limit=None, offset=0):
        clauses = ["g.household_id=:household", READ_PERMISSION, "g.retired_at IS NULL"]
        params = {"household": actor.household_id, "owner": actor.member_id,
                  "device_scope": actor.personal_account}
        if filters.get("owner_id") is not None:
            clauses.append("g.owner_id=:filter_owner")
            params["filter_owner"] = filters["owner_id"]
        for key in ("category", "color"):
            if filters.get(key) is not None:
                clauses.append(f"g.{key}=:{key}")
                params[key] = filters[key]
        if filters.get("season") is not None:
            clauses.append(":season=ANY(g.season_tags)")
            params["season"] = filters["season"]
        if filters.get("status") is not None:
            clauses.append("coalesce(s.status::text,'UNKNOWN')=:status")
            params["status"] = filters["status"]
        if filters.get("garment_id") is not None:
            clauses.append("g.id=:garment_id")
            params["garment_id"] = filters["garment_id"]
        where = " WHERE " + " AND ".join(clauses)
        total = await self.one(
            "SELECT count(*) AS total FROM wardrobe.garment g "
            "LEFT JOIN wardrobe.garment_state s ON s.garment_id=g.id" + where,
            **params,
        )
        pagination = ""
        if limit is not None:
            pagination = " LIMIT :limit OFFSET :offset"
            params.update(limit=limit, offset=offset)
        rows = await self.all(
            GARMENT_SELECT + where + " ORDER BY g.created_at,g.id" + pagination, **params
        )
        return rows, total["total"]


# Join scope prevents a bad cross-household FK from exposing location/asset details.
READ_PERMISSION = """((NOT :device_scope AND (g.owner_id=:owner OR EXISTS
 (SELECT 1 FROM wardrobe.garment_share sh WHERE sh.garment_id=g.id
 AND sh.member_id=:owner AND sh.household_id=:household))) OR (:device_scope AND EXISTS
 (SELECT 1 FROM wardrobe.device_member dm
 JOIN wardrobe.account_credential ac ON ac.member_id=dm.member_id AND ac.enabled
 WHERE dm.device_id=g.device_id AND dm.member_id=:owner
 AND dm.household_id=:household)))"""

GARMENT_SELECT = """
SELECT g.*, coalesce(s.status::text,'UNKNOWN') AS status,
       CASE WHEN l.id IS NOT NULL THEN s.location_id END AS location_id,
       CASE WHEN l.id IS NOT NULL THEN s.location_confidence END AS location_confidence,
       s.last_seen_at, s.version AS state_version, l.name AS location_label,
       a.id AS asset_id, a.asset_key, a.content_type,
       (SELECT array_agg(sh.member_id ORDER BY sh.member_id) FROM wardrobe.garment_share sh
        WHERE sh.garment_id=g.id) AS shared_with_member_ids
FROM wardrobe.garment g
LEFT JOIN wardrobe.garment_state s ON s.garment_id=g.id
LEFT JOIN wardrobe.storage_location l ON l.id=s.location_id AND l.household_id=g.household_id
LEFT JOIN wardrobe.asset a ON a.id=g.image_asset_id AND a.household_id=g.household_id
    AND a.owner_id=g.owner_id AND a.status='READY'
    AND a.retention_expires_at > now()
    AND EXISTS (SELECT 1 FROM wardrobe.member_settings ms
                WHERE ms.member_id=a.owner_id AND ms.image_upload_consent)
"""
