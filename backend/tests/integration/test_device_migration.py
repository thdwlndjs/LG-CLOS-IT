import asyncio
import os
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.paths import DOCS_DIR, PROJECT_ROOT
from app.infrastructure.db.sql_scripts import read_transaction_statements

pytestmark = pytest.mark.integration


def test_device_backfill_preserves_every_existing_garment_column():
    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("Dedicated real PostgreSQL required")
    url = make_url(dsn)
    assert url.database == "wardrobe_test" and url.host == "postgres-test"
    name = "wardrobe_test_" + uuid4().hex

    async def run():
        admin = create_async_engine(url, isolation_level="AUTOCOMMIT")
        engine = None
        try:
            async with admin.connect() as connection:
                await connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
            engine = create_async_engine(url.set(database=name))
            cfg = Config(str(PROJECT_ROOT / "backend/alembic.ini"))

            def migrate(connection, target):
                cfg.attributes["connection"] = connection
                command.upgrade(cfg, target)

            async with engine.begin() as connection:
                await connection.run_sync(migrate, "0003_sprint5_history_care")
                for statement in read_transaction_statements(DOCS_DIR / "07_DATABASE_SEED.sql"):
                    await connection.exec_driver_sql(statement)
                before = (await connection.execute(text(
                    "SELECT to_jsonb(g) FROM wardrobe.garment g ORDER BY id"))).scalars().all()
                states = (await connection.execute(text(
                    "SELECT to_jsonb(s) FROM wardrobe.garment_state s ORDER BY garment_id"
                ))).scalars().all()
                await connection.run_sync(migrate, "head")
                await connection.run_sync(migrate, "head")
                after = (await connection.execute(text(
                    "SELECT to_jsonb(g)-'device_id' FROM wardrobe.garment g ORDER BY id"
                ))).scalars().all()
                assert before == after and len(after) == 3
                assert states == (await connection.execute(text(
                    "SELECT to_jsonb(s) FROM wardrobe.garment_state s ORDER BY garment_id"
                ))).scalars().all()
                assert await connection.scalar(text(
                    "SELECT count(DISTINCT device_id) FROM wardrobe.garment")) == 1
                assert await connection.scalar(text(
                    "SELECT count(*) FROM wardrobe.device_member")) == 2
                assert await connection.scalar(text(
                    "SELECT count(*) FROM wardrobe.lighting_zone")) == 0
        finally:
            if engine:
                await engine.dispose()
            async with admin.connect() as connection:
                await connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            await admin.dispose()

    asyncio.run(run())
