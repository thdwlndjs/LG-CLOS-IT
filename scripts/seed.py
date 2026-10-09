"""Apply the original non-production seed transaction without altering the SQL."""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import text  # noqa: E402

from app.core.config import load_settings  # noqa: E402
from app.infrastructure.db.session import Database  # noqa: E402
from app.infrastructure.db.sql_scripts import read_transaction_statements  # noqa: E402
from app.infrastructure.resources import BASELINE_REVISION  # noqa: E402


async def seed():
    settings = load_settings()
    if settings.app_env not in {"local", "test"} or settings.public_deployment:
        raise RuntimeError("Seed is permitted only in local/test private deployments")
    database = Database(settings)
    try:
        async with database.engine.begin() as connection:
            revision = await connection.scalar(text(
                "SELECT version_num FROM public.alembic_version"
            ))
            if revision != BASELINE_REVISION:
                raise RuntimeError("Run alembic upgrade head before seed")
            for statement in read_transaction_statements(ROOT / "docs/07_DATABASE_SEED.sql"):
                await connection.exec_driver_sql(statement)
    finally:
        await database.close()


if __name__ == "__main__":
    asyncio.run(seed())
    print("Demo seed transaction completed")
