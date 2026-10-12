"""Human-only offline approval. Never calls FitRoom or restores a consumed grant."""

import argparse
import asyncio
import sys
from datetime import timedelta
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.clock import utc_now
from app.core.config import load_settings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


async def authorize(args):
    settings = load_settings()
    if settings.app_env not in {"staging", "production"} or settings.auth_mode != "JWT":
        raise RuntimeError("Human approval is unavailable in development/test")
    if not settings.fitroom_status_read_unbilled_verified:
        raise RuntimeError("Verify status-query billing before authorizing generation")
    engine = create_async_engine(settings.database_url.get_secret_value())
    try:
        async with engine.begin() as c:
            row = (
                (
                    await c.execute(
                        text(
                            "UPDATE wardrobe.fitroom_request SET approved_at=now(),approved_by=:who,expires_at=:expiry "
                            "WHERE job_id=:j AND fingerprint=:f AND mode='LIVE' AND consumed_at IS NULL "
                            "AND approved_at IS NULL RETURNING member_id"
                        ),
                        dict(
                            j=UUID(args.job),
                            f=args.fingerprint,
                            who=args.approver,
                            expiry=utc_now() + timedelta(minutes=10),
                        ),
                    )
                )
                .mappings()
                .one_or_none()
            )
            if not row:
                raise RuntimeError(
                    "Review missing, changed, previously approved or consumed"
                )
            await c.execute(
                text(
                    "INSERT INTO wardrobe.fitroom_audit(member_id,job_id,action,details) "
                    "VALUES(:m,:j,'HUMAN_APPROVED','{\"maximum_attempts\":1}')"
                ),
                dict(m=row["member_id"], j=UUID(args.job)),
            )
        print(
            "One request approved for 10 minutes. No provider request sent. User must execute in UI."
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--job", required=True)
    p.add_argument("--fingerprint", required=True)
    p.add_argument("--approver", required=True)
    p.add_argument("--ack-budget-1", required=True, action="store_true")
    asyncio.run(authorize(p.parse_args()))
