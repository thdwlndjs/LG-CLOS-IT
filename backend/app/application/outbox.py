import asyncio
import logging
from datetime import timedelta
from time import perf_counter
from uuid import NAMESPACE_URL, uuid5

from app.application.common.idempotency import canonical
from app.core.clock import utc_now
from app.infrastructure.db.sprint1_repository import Sprint1Repository

MAX_ATTEMPTS = 5
BATCH_SIZE = 10


def envelope(row):
    version = row["payload"].get("version", row["payload"].get("revision"))
    return dict(
        event_id=str(row["id"]),
        event_type=row["event_type"],
        aggregate_type=row["aggregate_type"],
        aggregate_id=str(row["aggregate_id"]),
        aggregate_version=version if type(version) is int and version > 0 else None,
        household_id=str(row["household_id"]) if row["household_id"] else None,
        occurred_at=row["created_at"].isoformat(),
        schema_version=row["schema_version"],
        correlation_id=row["correlation_id"],
        payload=row["payload"],
    )


async def dispatch(resources, publish):
    async with resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        rows = [
            dict(r)
            for r in await repo.all(
                "SELECT * FROM wardrobe.domain_event_outbox WHERE status IN ('PENDING','FAILED') "
                "AND attempts<:max AND next_attempt_at<=now() ORDER BY created_at,id "
                "LIMIT 10 FOR UPDATE SKIP LOCKED",
                max=MAX_ATTEMPTS,
            )
        ]
        for row in rows:
            row["attempts"] += 1
            await repo.execute(
                "UPDATE wardrobe.domain_event_outbox SET status='FAILED',attempts=attempts+1,"
                "next_attempt_at=:next,last_error='DELIVERY_UNCONFIRMED' WHERE id=:id",
                id=row["id"],
                next=utc_now() + timedelta(seconds=60),
            )
    for row in rows:
        started = perf_counter()
        try:
            await asyncio.wait_for(publish(envelope(row)), timeout=5)
            succeeded = True
        except Exception:
            succeeded = False
        async with resources.database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            await repo.execute(
                "UPDATE wardrobe.domain_event_outbox "
                "SET status=CAST(:status AS wardrobe.outbox_status),"
                "published_at=:published,next_attempt_at=:next,last_error=:error "
                "WHERE id=:id AND attempts=:attempt AND status='FAILED'",
                id=row["id"],
                attempt=row["attempts"],
                status="PUBLISHED" if succeeded else "FAILED",
                published=utc_now() if succeeded else None,
                next=utc_now() + timedelta(seconds=2 ** row["attempts"]),
                error=None if succeeded else "BROKER_PUBLISH_FAILED",
            )
        logging.getLogger("wardrobe").info(
            "outbox_dispatch",
            extra={
                "event_id": str(row["id"]),
                "correlation_id": row["correlation_id"],
                "attempts": row["attempts"],
                "outcome": "PUBLISHED" if succeeded else "FAILED",
                "duration_ms": round((perf_counter() - started) * 1000, 2),
            },
        )
    return len(rows)


async def consume(resources, message):
    from uuid import UUID

    if (
        not isinstance(message, dict)
        or type(message.get("schema_version")) is not int
        or message["schema_version"] != 1
    ):
        raise ValueError("Unsupported event envelope")
    try:
        identity = UUID(message["event_id"])
    except (ValueError, KeyError, AttributeError, TypeError):
        raise ValueError("Invalid event identity") from None
    async with resources.database.sessions.begin() as session:
        repo = Sprint1Repository(session)
        row = await repo.one("SELECT * FROM wardrobe.domain_event_outbox WHERE id=:id", id=identity)
        if row is None or canonical(envelope(row)) != canonical(message):
            raise ValueError("Event does not match committed source")
        inserted = await repo.one(
            "INSERT INTO wardrobe.audit_log(id,household_id,action,target_type,target_id,"
            "correlation_id,details) VALUES (:id,:h,'DOMAIN_EVENT_CONSUMED',:type,:target,:c,"
            "CAST(:details AS jsonb)) ON CONFLICT(id) DO NOTHING RETURNING id",
            id=uuid5(NAMESPACE_URL, "wardrobe:event:" + str(identity)),
            h=row["household_id"],
            type=row["aggregate_type"],
            target=row["aggregate_id"],
            c=row["correlation_id"],
            details=canonical(
                dict(
                    event_id=str(identity),
                    event_type=row["event_type"],
                    schema_version=row["schema_version"],
                )
            ),
        )
    logging.getLogger("wardrobe").info(
        "outbox_consume",
        extra={
            "event_id": str(identity),
            "correlation_id": row["correlation_id"],
            "outcome": "CONSUMED" if inserted else "DUPLICATE",
        },
    )
    return bool(inserted)
