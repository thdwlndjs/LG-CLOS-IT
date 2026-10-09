from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings


def database_connect_args(settings: Settings):
    options = {"server_settings": {"timezone": "UTC"}, "timeout": 5}
    if settings.public_deployment:
        import ssl

        if settings.database_ca_file:
            from pathlib import Path

            options["ssl"] = ssl.create_default_context(cadata=Path(
                settings.database_ca_file
            ).read_text(encoding="ascii"))
        else:
            options["ssl"] = ssl.create_default_context()
    return options


class Database:
    def __init__(self, settings: Settings):
        self.engine = create_async_engine(
            settings.database_url.get_secret_value(), pool_pre_ping=True,
            connect_args=database_connect_args(settings),
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def close(self):
        await self.engine.dispose()

