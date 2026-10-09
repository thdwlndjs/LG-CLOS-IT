"""Provision existing principals and verified slot mappings; no demo passwords."""

import argparse
import asyncio
import getpass
import json
from uuid import UUID

from app.core.config import load_settings
from app.core.passwords import hash_password
from app.infrastructure.db.session import Database
from app.infrastructure.db.sprint1_repository import Sprint1Repository


async def provision(args):
    settings = load_settings()
    if settings.app_env not in {"local", "test"} or settings.public_deployment:
        raise RuntimeError("Provisioning is restricted to private development")
    database = Database(settings)
    try:
        async with database.sessions.begin() as session:
            repo = Sprint1Repository(session)
            if args.command == "list":
                for table, columns in (
                    ("member", "id,household_id,display_name"),
                    ("device", "id,household_id,name"),
                    ("storage_location", "id,household_id,name"),
                    ("access_station", "id,name,kind,device_id,enabled"),
                ):
                    rows = await repo.all(f"SELECT {columns} FROM wardrobe.{table} ORDER BY id")
                    print(json.dumps({table: [dict(r) for r in rows]}, default=str))
            elif args.command == "link":
                valid = await repo.one(
                    "SELECT d.household_id FROM wardrobe.device d JOIN wardrobe.member m "
                    "ON m.household_id=d.household_id WHERE d.id=:device AND m.id=:member",
                    device=args.device, member=args.member,
                )
                if not valid:
                    raise ValueError("Member and device must belong to the same household")
                await repo.execute(
                    "INSERT INTO wardrobe.device_member(device_id,member_id,household_id) "
                    "VALUES(:d,:m,:h) ON CONFLICT DO NOTHING",
                    d=args.device, m=args.member, h=valid["household_id"],
                )
            elif args.command == "account":
                secret = getpass.getpass("Account password (12+ characters): ")
                encoded = await asyncio.to_thread(hash_password, secret)
                await repo.execute(
                    "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                    "VALUES(:member,:login,:password) ON CONFLICT(member_id) DO UPDATE SET "
                    "login=excluded.login,password_hash=excluded.password_hash,enabled=true",
                    member=args.member, login=args.login.strip().casefold(), password=encoded,
                )
            elif args.command == "station":
                secret = getpass.getpass("Station credential (12+ characters): ")
                encoded = await asyncio.to_thread(hash_password, secret)
                row = await repo.one(
                    "INSERT INTO wardrobe.access_station(name,kind,device_id,credential_hash) "
                    "VALUES(:name,:kind,:device,:credential) RETURNING id",
                    name=args.name, kind=args.kind, device=args.device, credential=encoded,
                )
                print(f"Station ID: {row['id']}")
            elif args.command == "zone":
                # Caller explicitly attests physical location; never infer from garment names.
                location = await repo.one(
                    "SELECT l.id FROM wardrobe.storage_location l JOIN wardrobe.device d "
                    "ON d.household_id=l.household_id WHERE l.id=:location AND d.id=:device",
                    location=args.location, device=args.device,
                )
                if not location:
                    raise ValueError("Location and device must belong to the same household")
                await repo.execute(
                    "INSERT INTO wardrobe.lighting_zone(location_id,device_id,anchor_id) "
                    "VALUES(:location,:device,:anchor)",
                    location=args.location, device=args.device, anchor=args.anchor,
                )
    finally:
        await database.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    link = commands.add_parser("link")
    link.add_argument("--member", required=True, type=UUID)
    link.add_argument("--device", required=True, type=UUID)
    account = commands.add_parser("account")
    account.add_argument("--member", required=True, type=UUID)
    account.add_argument("--login", required=True)
    station = commands.add_parser("station")
    station.add_argument("--name", required=True)
    station.add_argument("--kind", required=True, choices=["HOME", "STORE"])
    station.add_argument("--device", type=UUID)
    zone = commands.add_parser("zone")
    zone.add_argument("--location", required=True, type=UUID)
    zone.add_argument("--device", required=True, type=UUID)
    zone.add_argument("--anchor", required=True)
    args = parser.parse_args()
    if args.command == "account" and not 1 <= len(args.login.strip()) <= 200:
        parser.error("Account login must contain 1..200 characters")
    if args.command == "zone" and not args.anchor.strip():
        parser.error("Explicit verified anchor required")
    if args.command == "station" and args.kind == "HOME" and args.device is None:
        parser.error("HOME requires --device")
    if args.command == "station" and args.kind == "STORE" and args.device is not None:
        parser.error("STORE cannot bind a HOME device")
    asyncio.run(provision(args))


if __name__ == "__main__":
    main()
