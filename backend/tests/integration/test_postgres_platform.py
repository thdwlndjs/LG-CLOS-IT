"""Real DB integration: migration/seed replay, catalog, tenant FK and UoW rollback."""

import asyncio
import os
import re
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.application.common.uow import UnitOfWork
from app.core.paths import DOCS_DIR, PROJECT_ROOT
from app.infrastructure.db.models import Household, Member
from app.infrastructure.db.sql_scripts import read_transaction_statements

pytestmark = pytest.mark.integration


def test_real_postgres_baseline_and_seed():
    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("TEST_DATABASE_URL not set; real PostgreSQL integration was not run")
    pytest.importorskip("asyncpg", reason="asyncpg driver not installed")
    from alembic import command
    from alembic.config import Config

    url = make_url(dsn)
    if url.drivername != "postgresql+asyncpg" or url.database != "wardrobe_test":
        pytest.fail("Use the dedicated wardrobe_test instance from the test Compose profile")
    database_name = "wardrobe_test_" + uuid4().hex
    assert re.fullmatch(r"wardrobe_test_[0-9a-f]{32}", database_name)

    async def run():
        admin = create_async_engine(url, isolation_level="AUTOCOMMIT")
        engine = None
        created = False
        try:
            async with admin.connect() as connection:
                await connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')
                created = True
            engine = create_async_engine(url.set(database=database_name))
            cfg = Config(str(PROJECT_ROOT / "backend/alembic.ini"))

            def migrate(connection):
                cfg.attributes["connection"] = connection
                command.upgrade(cfg, "head")

            for _ in range(2):
                async with engine.begin() as connection:
                    await connection.run_sync(migrate)
            for _ in range(2):
                async with engine.begin() as connection:
                    for statement in read_transaction_statements(DOCS_DIR / "07_DATABASE_SEED.sql"):
                        await connection.exec_driver_sql(statement)
            async with engine.connect() as connection:
                names = set(
                    (
                        await connection.scalars(
                            text("SELECT tablename FROM pg_tables WHERE schemaname='wardrobe'")
                        )
                    ).all()
                )
                expected = set(
                    re.findall(
                        r"CREATE TABLE (\w+)", (DOCS_DIR / "07_DATABASE_SCHEMA.sql").read_text()
                    )
                )
                assert names == expected
                assert await connection.scalar(text("SELECT count(*) FROM wardrobe.member")) == 2
                assert await connection.scalar(text("SELECT count(*) FROM wardrobe.garment")) == 3
                assert (
                    await connection.scalar(text("SELECT count(*) FROM wardrobe.outfit_item")) == 3
                )
                assert (
                    await connection.scalar(text("SELECT count(*) FROM wardrobe.wear_event")) == 0
                )
                assert (
                    await connection.scalar(text("SELECT version_num FROM public.alembic_version"))
                    == "0003_sprint5_history_care"
                )
                enum_count = await connection.scalar(
                    text(
                        "SELECT count(*) FROM pg_type t "
                        "JOIN pg_namespace n ON n.oid=t.typnamespace "
                        "WHERE n.nspname='wardrobe' AND t.typtype='e'"
                    )
                )
                assert enum_count == 10

            sessions = async_sessionmaker(engine, expire_on_commit=False)
            with pytest.raises(RuntimeError, match="rollback"):
                async with UnitOfWork(sessions) as uow:
                    uow.session.add(Household(name="rollback-fixture"))
                    await uow.session.flush()
                    raise RuntimeError("rollback")
            async with sessions() as session:
                assert await session.scalar(text("SELECT count(*) FROM wardrobe.household")) == 1
                member = await session.get(Member, uuid4())
                assert member is None

            # Composite household FK forbids pairing an owner with another household.
            other_household = uuid4()
            async with engine.begin() as connection:
                await connection.execute(
                    text("INSERT INTO wardrobe.household(id,name) VALUES (:id,'Other Household')"),
                    {"id": other_household},
                )
            with pytest.raises(IntegrityError):
                async with engine.begin() as connection:
                    await connection.execute(
                        text(
                            "INSERT INTO wardrobe.garment(household_id,owner_id,category,color) "
                            "VALUES (:household,:owner,'TOP','RED')"
                        ),
                        {
                            "household": other_household,
                            "owner": "20000000-0000-4000-8000-000000000001",
                        },
                    )
            with pytest.raises(IntegrityError):
                async with engine.begin() as connection:
                    await connection.exec_driver_sql(
                        "UPDATE wardrobe.garment_state SET location_confidence=2"
                    )
        finally:
            if engine is not None:
                await engine.dispose()
            if created:
                async with admin.connect() as connection:
                    await connection.exec_driver_sql(
                        f'DROP DATABASE "{database_name}" WITH (FORCE)'
                    )
            await admin.dispose()

    asyncio.run(run())
