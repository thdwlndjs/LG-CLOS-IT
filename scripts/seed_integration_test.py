"""Synthetic provisioning restricted to the disposable verification database."""

import asyncio
import json
import secrets
from pathlib import Path
from uuid import UUID

from app.core.config import load_settings
from app.core.passwords import hash_password
from app.infrastructure.db.session import Database
from app.infrastructure.db.sprint1_repository import Sprint1Repository


async def main():
    settings = load_settings()
    if settings.app_env != "test" or not settings.database_url.get_secret_value().rsplit(
        "/", 1)[-1].startswith("wardrobe_test_"):
        raise RuntimeError("Dedicated disposable test DB required")
    password, credential = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    database = Database(settings)
    try:
        async with database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            device = await repo.one("SELECT id FROM wardrobe.device WHERE household_id=:h",
                                   h=UUID("10000000-0000-4000-8000-000000000001"))
            for i in (1, 2):
                await repo.execute(
                    "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                    "VALUES(:m,:login,:hash)", m=UUID(f"20000000-0000-4000-8000-{i:012d}"),
                    login=f"integration-{i}", hash=hash_password(password),
                )
            for i, kind in ((1, "HOME"), (2, "STORE"), (3, "HOME")):
                await repo.execute(
                    "INSERT INTO wardrobe.access_station(id,name,kind,device_id,credential_hash) "
                    "VALUES(:id,:name,:kind,:device,:hash)",
                    id=UUID(f"90000000-0000-4000-8000-{i:012d}"), name=f"Test {kind} {i}",
                    kind=kind, device=device["id"] if kind == "HOME" else None,
                    hash=hash_password(credential),
                )
            locations = await repo.all(
                "SELECT id FROM wardrobe.storage_location WHERE household_id=:h ORDER BY id",
                h=UUID("10000000-0000-4000-8000-000000000001"),
            )
            # Explicit synthetic location bindings, never production backfill.
            anchors = ["L1_RAIL_01", "L1_RAIL_02"]
            for location, anchor in zip(locations, anchors, strict=False):
                await repo.execute(
                    "INSERT INTO wardrobe.lighting_zone(location_id,device_id,anchor_id) "
                    "VALUES(:location,:device,:anchor)", location=location["id"],
                    device=device["id"], anchor=anchor,
                )
            fixture = dict(password=password, credential=credential, device_id=str(device["id"]),
                           locations=[str(location["id"]) for location in locations])
            path = Path("/tmp/integration-test-credentials.json")
            path.write_text(json.dumps(fixture))
            path.chmod(0o600)
    finally:
        await database.close()


if __name__ == "__main__":
    asyncio.run(main())
