"""Provision one explicitly configured MEMBER for the existing cloud demo wardrobe."""

import argparse
import asyncio
import json
from pathlib import Path
import sys

from dotenv import dotenv_values
from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.core.config import load_settings  # noqa: E402
from app.infrastructure.db.session import Database  # noqa: E402


async def provision(env_file):
    values = dotenv_values(env_file)
    settings = load_settings(env_file)
    if settings.storage_provider == "SUPABASE" and not settings.database_ca_file:
        settings = settings.model_copy(update=dict(
            database_ca_file=str(ROOT / "infra/cloud/supabase-ca.crt")))
    database = Database(settings)
    try:
        async with database.sessions.begin() as session:
            # Explicit existing import account; never select an arbitrary owner/device.
            owner = (await session.execute(text(
                "SELECT m.id,m.household_id FROM wardrobe.member m "
                "JOIN wardrobe.account_credential c ON c.member_id=m.id "
                "WHERE c.login=:login AND c.enabled"
            ), dict(login=values["CLOUD_IMPORT_LOGIN"]))).mappings().one()
            devices = (await session.execute(text(
                "SELECT device_id FROM wardrobe.device_member "
                "WHERE member_id=:member AND household_id=:household"
            ), dict(member=owner["id"], household=owner["household_id"]))).scalars().all()
            if len(devices) != 1:
                raise ValueError("Existing account must have exactly one explicit wardrobe")
            demo = (await session.execute(text(
                "SELECT m.id,m.household_id,m.role,c.enabled FROM wardrobe.member m "
                "JOIN wardrobe.account_credential c ON c.member_id=m.id "
                "WHERE c.login='public-demo' FOR UPDATE"
            ))).mappings().first()
            created = demo is None
            if demo:
                if (demo["household_id"] != owner["household_id"]
                        or demo["role"] != "MEMBER" or not demo["enabled"]):
                    raise ValueError("Existing public demo account requires reconciliation")
                member = demo["id"]
            else:
                member = await session.scalar(text(
                    "INSERT INTO wardrobe.member(household_id,display_name,role) "
                    "VALUES (:household,'Public demo','MEMBER') RETURNING id"
                ), dict(household=owner["household_id"]))
                # No password login is possible with this deliberately invalid hash.
                await session.execute(text(
                    "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                    "VALUES (:member,'public-demo','button-only-no-password')"
                ), dict(member=member))
            await session.execute(text(
                "INSERT INTO wardrobe.device_member(device_id,member_id,household_id) "
                "VALUES (:device,:member,:household) ON CONFLICT DO NOTHING"
            ), dict(device=devices[0], member=member, household=owner["household_id"]))
            return dict(member_id=str(member), created=created, role="MEMBER")
    finally:
        await database.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.cloud")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(provision(args.env_file))))
