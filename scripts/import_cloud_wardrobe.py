"""Explicit, private cloud provisioning/import. No seed or local journal transfer."""

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse
from uuid import NAMESPACE_URL, uuid5

import httpx
from dotenv import dotenv_values
from sqlalchemy import text

from import_owned_garments import ROOT, digest, image, save

sys.path.insert(0, str(ROOT / "backend"))
from app.core.config import load_settings  # noqa: E402
from app.core.passwords import hash_password  # noqa: E402
from app.infrastructure.db.session import Database  # noqa: E402
from app.schemas.sprint1 import GarmentUpsert  # noqa: E402


def private_path(value, directory):
    path = Path(value).resolve()
    if not path.is_relative_to((ROOT / directory).resolve()):
        raise ValueError("File must remain in the specified Git-excluded directory")
    return path


def command(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Private command failed; inspect local diagnostics")
    return result.stdout.strip()


def backup(values):
    target = urlparse(values["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://"))
    name = "cloud-before-import-" + digest(values["SUPABASE_URL"])[:12] + ".dump"
    path = ROOT / "test-results" / name
    if path.exists():
        raise ValueError("Existing backup requires explicit reconciliation")
    env = ROOT / "test-results/cloud-backup.env"
    env.write_text("\n".join(k + "=" + str(v) for k, v in dict(
        PGHOST=target.hostname, PGPORT=target.port or 5432,
        PGUSER=unquote(target.username), PGPASSWORD=unquote(target.password),
        PGDATABASE=target.path.lstrip("/"), PGSSLMODE="verify-full",
        PGSSLROOTCERT="/ca/supabase-ca.crt",
    ).items()), encoding="utf-8")
    command("docker", "run", "--rm", "--env-file", str(env),
            "--mount", f"type=bind,source={ROOT / 'test-results'},target=/backup",
            "--mount", f"type=bind,source={ROOT / 'infra/cloud'},target=/ca,readonly",
            "postgres:17-alpine", "pg_dump", "-Fc", "-f", "/backup/" + name)
    return dict(file=name, sha256=hashlib.sha256(path.read_bytes()).hexdigest())


async def provision(values):
    database = Database(load_settings(ROOT / ".env.cloud"))
    try:
        async with database.sessions.begin() as session:
            row = (await session.execute(text(
                "SELECT m.id,m.household_id FROM wardrobe.account_credential c "
                "JOIN wardrobe.member m ON m.id=c.member_id WHERE c.login=:login"
            ), dict(login=values["CLOUD_IMPORT_LOGIN"]))).mappings().first()
            if not row:
                household = await session.scalar(text(
                    "INSERT INTO wardrobe.household(name) VALUES('My wardrobe') RETURNING id"
                ))
                member = await session.scalar(text(
                    "INSERT INTO wardrobe.member(household_id,display_name,role) "
                    "VALUES(:h,'Wardrobe owner','OWNER') RETURNING id"
                ), dict(h=household))
                password = await asyncio.to_thread(hash_password, values["CLOUD_IMPORT_PASSWORD"])
                await session.execute(text(
                    "INSERT INTO wardrobe.account_credential(member_id,login,password_hash) "
                    "VALUES(:m,:login,:password)"
                ), dict(m=member, login=values["CLOUD_IMPORT_LOGIN"], password=password))
            else:
                member, household = row["id"], row["household_id"]
            devices = (await session.execute(text(
                "SELECT device_id FROM wardrobe.device_member WHERE member_id=:m"
            ), dict(m=member))).scalars().all()
            if len(devices) != 1:
                raise ValueError("Cloud account must have exactly one explicit device")
            return str(member), str(devices[0])
    finally:
        await database.close()


def run(args):
    values = dotenv_values(ROOT / ".env.cloud")
    os.environ.update({k: v for k, v in values.items() if v is not None})
    os.environ["DATABASE_CA_FILE"] = str(ROOT / "infra/cloud/supabase-ca.crt")
    settings = load_settings(ROOT / ".env.cloud")
    origin = urlparse(values["API_PUBLIC_ORIGIN"])
    if (not settings.public_deployment or settings.app_env != "staging"
            or settings.storage_provider != "SUPABASE" or origin.scheme != "https"
            or not (origin.hostname or "").endswith(".onrender.com")
            or origin.username or origin.port or origin.path not in {"", "/"}
            or origin.query or origin.fragment):
        raise ValueError("Explicit staging Render/Supabase target required")
    revision = command("git", "rev-parse", "HEAD")
    if (command("git", "status", "--porcelain", "--untracked-files=no")
            or command("git", "ls-remote", "origin", "refs/heads/main").split()[0] != revision):
        raise ValueError("Commit and push implementation before cloud writes")
    source = private_path(args.plan, "data/imports")
    plan = json.loads(source.read_text(encoding="utf-8"))
    path = private_path(args.journal, "data/imports")
    if path == source.with_suffix(".journal.json"):
        raise ValueError("Do not reuse the local import journal")
    fingerprint = digest([plan, values["SUPABASE_URL"], values["CLOUD_IMPORT_LOGIN"]])
    lock = path.with_suffix(".lock")
    os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
    try:
        journal = json.loads(path.read_text()) if path.exists() else dict(
            fingerprint=fingerprint, items={}, held_count=len(plan.get("held", []))
        )
        if journal["fingerprint"] != fingerprint:
            raise ValueError("Cloud target or source plan changed")
        if not journal.get("backup"):
            journal["backup"] = backup(values)
            save(path, journal)
        owner, device = asyncio.run(provision(values))
        journal.update(owner_id=owner, device_id=device, implementation_revision=revision)
        save(path, journal)
        cache = ROOT / "data/imports/images"
        with httpx.Client(base_url=values["API_PUBLIC_ORIGIN"] + "/api/v1", timeout=60,
                          follow_redirects=False, trust_env=False) as client:
            def api(method, route, body=None, key=None):
                response = client.request(method, route, json=body,
                    headers={"Idempotency-Key": str(key)} if key else {})
                if response.status_code >= 400:
                    raise RuntimeError(f"Cloud API {method} {route} failed: {response.status_code}")
                return response.json() if response.content else None

            login = api("POST", "/integration/login", dict(
                login=values["CLOUD_IMPORT_LOGIN"], password=values["CLOUD_IMPORT_PASSWORD"]))
            client.headers["Authorization"] = "Bearer " + login["access_token"]
            try:
                assert login["member"]["id"] == owner
                assert device in {d["id"] for d in api("GET", "/integration/devices")["items"]}
                before = api("GET", "/garments?limit=100")["items"]
                preferences = api("GET", "/settings")
                if not preferences["image_upload_consent"]:
                    if not args.grant_image_consent:
                        raise ValueError("Explicit image consent required")
                    api("PUT", "/settings", {**preferences, "image_upload_consent": True})
                for item in plan["items"]:
                    body = GarmentUpsert.model_validate(dict(
                        owner_id=owner, device_id=device, **item["garment"]
                    )).model_dump(mode="json")
                    identity = digest([owner, device, item["source_key"], body["color"], 1])
                    entry = journal["items"].setdefault(identity, {})
                    if not entry.get("image"):
                        entry["image"] = image(item, cache)
                        save(path, journal)
                    picture = entry["image"]
                    cached = (cache / picture["file"]).resolve()
                    if not cached.is_relative_to(cache.resolve()):
                        raise ValueError("Private image cache path required")
                    raw = cached.read_bytes()
                    if hashlib.sha256(raw).hexdigest() != picture["sha256"]:
                        raise ValueError("Image checksum mismatch")
                    if not entry.get("garment_id"):
                        intent = api("POST", "/assets/upload-intents", dict(
                            file_name=picture["file"], content_type=picture["content_type"],
                            size_bytes=len(raw), purpose="GARMENT"
                        ), uuid5(NAMESPACE_URL, identity + ":cloud-upload"))
                        target = urlparse(intent["upload_url"])
                        expected = urlparse(settings.storage_endpoint)
                        if (target.scheme != "https" or target.hostname != expected.hostname
                                or target.username or target.port
                                or not target.path.startswith(expected.path + "/")):
                            raise ValueError("Upload URL does not match private Supabase S3")
                        httpx.put(intent["upload_url"], content=raw,
                                  headers=intent["required_headers"], timeout=60,
                                  trust_env=False).raise_for_status()
                        api("POST", "/assets/" + intent["asset_id"] + "/finalize",
                            dict(checksum_sha256=picture["sha256"]),
                            uuid5(NAMESPACE_URL, identity + ":cloud-finalize"))
                        body["image_asset_id"] = intent["asset_id"]
                        entry["garment_id"] = api("POST", "/garments", body,
                            uuid5(NAMESPACE_URL, identity + ":cloud-garment"))["id"]
                        save(path, journal)
                    actual = api("GET", "/garments/" + entry["garment_id"])
                    for field in ("owner_id", "device_id", "name", "category", "color"):
                        if actual[field] != body[field]:
                            raise ValueError("Existing cloud garment differs from approved plan")
                    if actual["status"] != "UNKNOWN" or actual.get("location_id"):
                        raise ValueError("Unverified location/status was invented")
                    if actual.get("last_seen_at") or actual.get("location_confidence") is not None:
                        raise ValueError("Unverified observation was invented")
                    photo = actual.get("image")
                    if not photo:
                        raise ValueError("Cloud garment image missing")
                    downloaded = httpx.get(photo["read_url"], timeout=60, trust_env=False)
                    downloaded.raise_for_status()
                    if hashlib.sha256(downloaded.content).hexdigest() != picture["sha256"]:
                        raise ValueError("Stored cloud image differs from source")
                after = api("GET", "/garments?limit=100")["items"]
                journal["verified_count"] = len(journal["items"])
                journal["created_this_run"] = len(after) - len(before)
                save(path, journal)
                print(json.dumps(dict(verified=len(journal["items"]),
                    created_this_run=journal["created_this_run"], held=journal["held_count"])))
            finally:
                api("POST", "/integration/logout")
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--journal", required=True)
    parser.add_argument("--grant-image-consent", action="store_true")
    run(parser.parse_args())
