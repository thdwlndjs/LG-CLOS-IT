import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import load_settings
from app.infrastructure.db.session import database_connect_args


def run_on_connection(connection):
    context.configure(connection=connection, target_metadata=None,
                      version_table_schema="public", compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_online():
    settings = load_settings()
    engine = create_async_engine(settings.database_url.get_secret_value(),
                                 poolclass=pool.NullPool,
                                 connect_args=database_connect_args(settings))
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_on_connection)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    context.configure(url="postgresql://", target_metadata=None, literal_binds=True,
                      version_table_schema="public")
    with context.begin_transaction():
        context.run_migrations()
elif context.config.attributes.get("connection") is not None:
    run_on_connection(context.config.attributes["connection"])
else:
    asyncio.run(run_online())

