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


def test_0003_preserves_legacy_records_and_matches_current_ddl():
    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("Dedicated real PostgreSQL required")
    url = make_url(dsn)
    assert url.database == "wardrobe_test"

    async def case():
        admin = create_async_engine(url, isolation_level="AUTOCOMMIT")
        names = ["wardrobe_test_" + uuid4().hex for _ in range(2)]
        engines = []
        created = []
        try:
            for name in names:
                async with admin.connect() as conn:
                    await conn.exec_driver_sql(f'CREATE DATABASE "{name}"')
                created.append(name)
                engines.append(create_async_engine(url.set(database=name)))
            cfg = Config(str(PROJECT_ROOT / "backend/alembic.ini"))

            def migrate(conn, target):
                cfg.attributes["connection"] = conn
                command.upgrade(cfg, target)

            async with engines[0].begin() as conn:
                await conn.run_sync(migrate, "0002_sprint1_contract")
                for stmt in read_transaction_statements(DOCS_DIR / "07_DATABASE_SEED.sql"):
                    await conn.exec_driver_sql(stmt)
                await conn.exec_driver_sql(
                    "INSERT INTO wardrobe.wear_event(member_id,outfit_id,worn_at,"
                    "confirmation_method) SELECT member_id,id,now(),'USER' FROM wardrobe.outfit"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO wardrobe.care_schedule(garment_id,scheduled_at,care_type,"
                    "created_by,status,completed_at) SELECT id,now(),'WASH',owner_id,"
                    "'COMPLETED',now() FROM wardrobe.garment LIMIT 1"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO wardrobe.care_event(garment_id,schedule_id,performed_by,"
                    "care_type,performed_at) SELECT garment_id,id,created_by,care_type,"
                    "completed_at FROM wardrobe.care_schedule"
                )
                before = (
                    await conn.execute(
                        text(
                            "SELECT id,member_id,outfit_id,worn_at,confirmed_at "
                            "FROM wardrobe.wear_event"
                        )
                    )
                ).all()
                await conn.run_sync(migrate, "head")
                await conn.run_sync(migrate, "head")
                after = (
                    await conn.execute(
                        text(
                            "SELECT id,member_id,outfit_id,worn_at,confirmed_at "
                            "FROM wardrobe.wear_event"
                        )
                    )
                ).all()
                assert before == after and len(after) == 1
                assert (
                    await conn.scalar(text("SELECT items_snapshot FROM wardrobe.wear_event"))
                    is None
                )
                assert (
                    await conn.scalar(text("SELECT outcome FROM wardrobe.care_event")) == "SUCCESS"
                )
                assert (
                    await conn.scalar(text("SELECT cancelled_at FROM wardrobe.care_event")) is None
                )
            async with engines[1].begin() as conn:
                for stmt in read_transaction_statements(DOCS_DIR / "07_DATABASE_SCHEMA.sql"):
                    await conn.exec_driver_sql(stmt)
            catalogs = []
            for engine in engines:
                async with engine.connect() as conn:
                    columns = (
                        await conn.execute(
                            text(
                                "SELECT table_name,column_name,data_type,"
                                "is_nullable,column_default "
                                "FROM information_schema.columns WHERE table_schema='wardrobe' "
                                "ORDER BY table_name,ordinal_position"
                            )
                        )
                    ).all()
                    indexes = (
                        await conn.execute(
                            text(
                                "SELECT tablename,indexname,indexdef FROM pg_indexes "
                                "WHERE schemaname='wardrobe' ORDER BY tablename,indexname"
                            )
                        )
                    ).all()
                    catalogs.append((columns, indexes))
            assert catalogs[0] == catalogs[1]
        finally:
            for engine in engines:
                await engine.dispose()
            for name in created:
                async with admin.connect() as conn:
                    await conn.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
            await admin.dispose()

    asyncio.run(case())
