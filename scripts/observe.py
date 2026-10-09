"""Internal, read-only DB telemetry. Emits aggregate values without payloads or credentials."""

import asyncio
import json

from sqlalchemy import text

from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources


async def snapshot(resources):
    async with resources.database.sessions.begin() as session:
        result = await session.execute(
            text("""
SELECT json_build_object(
 'outbox_pending',(SELECT count(*) FROM wardrobe.domain_event_outbox WHERE status='PENDING'),
 'outbox_retrying',(SELECT count(*) FROM wardrobe.domain_event_outbox
    WHERE status='FAILED' AND attempts<5),
 'outbox_exhausted',(SELECT count(*) FROM wardrobe.domain_event_outbox
    WHERE status='FAILED' AND attempts>=5),
 'published',(SELECT count(*) FROM wardrobe.domain_event_outbox WHERE status='PUBLISHED'),
 'consumer_receipts',(SELECT count(*) FROM wardrobe.audit_log WHERE action='DOMAIN_EVENT_CONSUMED'),
 'published_unconsumed',(SELECT count(*) FROM wardrobe.domain_event_outbox e
    WHERE status='PUBLISHED' AND NOT EXISTS (SELECT 1 FROM wardrobe.audit_log a
     WHERE a.action='DOMAIN_EVENT_CONSUMED' AND a.details->>'event_id'=e.id::text)),
 'job_failed',(SELECT count(*) FROM wardrobe.job WHERE status IN ('FAILED','TIMED_OUT')),
 'job_queued',(SELECT count(*) FROM wardrobe.job WHERE status='QUEUED'),
 'job_running',(SELECT count(*) FROM wardrobe.job WHERE status='RUNNING'),
 'job_attempts',(SELECT coalesce(sum(attempt_count),0) FROM wardrobe.job),
 'vton_latency_seconds',(SELECT avg(extract(epoch FROM finished_at-started_at))
    FROM wardrobe.job WHERE kind='VTON' AND finished_at>=started_at),
 'card_latency_seconds',(SELECT avg(extract(epoch FROM finished_at-started_at))
    FROM wardrobe.job WHERE kind='CARD_RENDER' AND finished_at>=started_at),
 'stale_garment_states',(SELECT count(*) FROM wardrobe.garment_state s
    JOIN wardrobe.garment g ON g.id=s.garment_id WHERE g.retired_at IS NULL
      AND (s.last_seen_at IS NULL OR s.last_seen_at<now()-interval '24 hours')),
 'empty_recommendations',(SELECT count(*) FROM wardrobe.domain_event_outbox
    WHERE event_type='OutfitRecommended' AND payload->'candidates'='[]'::jsonb))
""")
        )
        return result.scalar_one()


async def main():
    resources = RuntimeResources(load_settings())
    try:
        print(json.dumps(await snapshot(resources), default=float))
    finally:
        await resources.close()


if __name__ == "__main__":
    asyncio.run(main())
