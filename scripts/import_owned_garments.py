"""Import a private, fixed owned-item plan through the existing local API."""

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse
from uuid import NAMESPACE_URL, uuid5

import httpx
from dotenv import dotenv_values
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.schemas.sprint1 import GarmentUpsert  # noqa: E402

COMPOSE = ["docker", "compose", "--env-file", ".env", "-f", "infra/compose.yaml"]
IMAGE_HOSTS = {"image.msscdn.net", "tonywack.com", "m.lmood.co.kr"}
SEED_IDS = {f"40000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3)}


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(temporary, path)


def local_command(*args, input_text=None):
    result = subprocess.run(
        args,
        cwd=ROOT,
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode:
        raise RuntimeError(
            "Local database operation failed; inspect private diagnostics"
        )
    return result.stdout.strip()


def snapshot():
    return json.loads(
        local_command(
            *COMPOSE,
            "exec",
            "-T",
            "postgres",
            "sh",
            "-c",
            'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1',
            input_text="""SELECT json_build_object(
         'garments',(SELECT count(*) FROM wardrobe.garment),
         'active',(SELECT count(*) FROM wardrobe.garment WHERE retired_at IS NULL),
         'wear',(SELECT count(*) FROM wardrobe.wear_event),
         'care',(SELECT count(*) FROM wardrobe.care_event),
         'observations',(SELECT count(*) FROM wardrobe.garment_observation));""",
        )
    )


def backup():
    name = (
        "wardrobe-before-owned-import-"
        + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        + ".dump"
    )
    destination = ROOT / "test-results" / name
    local_command(
        *COMPOSE,
        "exec",
        "-T",
        "postgres",
        "sh",
        "-c",
        'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/' + name,
    )
    container = local_command(*COMPOSE, "ps", "-q", "postgres")
    local_command("docker", "cp", container + ":/tmp/" + name, str(destination))
    return {
        "file": name,
        "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
    }


def image(item, directory):
    url = item["image_url"]
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        for unused in range(5):
            parsed = urlparse(url)
            if (
                parsed.scheme != "https"
                or parsed.hostname not in IMAGE_HOSTS
                or parsed.username
            ):
                raise ValueError("Official HTTPS image host required")
            with client.stream("GET", url) as response:
                if response.is_redirect:
                    url = str(response.url.join(response.headers["location"]))
                    continue
                response.raise_for_status()
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > 10485760:
                        raise ValueError("Image exceeds upload contract")
                    chunks.append(chunk)
                data = b"".join(chunks)
                break
        else:
            raise ValueError("Image redirect chain is too long")
    with Image.open(io.BytesIO(data)) as decoded:
        if decoded.format not in {"PNG", "JPEG", "WEBP"} or max(decoded.size) > 4096:
            raise ValueError("Image format or dimensions violate upload contract")
        if getattr(decoded, "n_frames", 1) != 1:
            raise ValueError("Animated image is not supported")
        content_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[
            decoded.format
        ]
        dimensions = list(decoded.size)
        decoded.verify()
    with Image.open(io.BytesIO(data)) as decoded:
        decoded.load()
    checksum = hashlib.sha256(data).hexdigest()
    path = directory / (
        checksum
        + {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[
            content_type
        ]
    )
    path.write_bytes(data)
    return dict(
        file=path.name,
        content_type=content_type,
        bytes=len(data),
        dimensions=dimensions,
        sha256=checksum,
        source_url=url,
        origin="CATALOG_REFERENCE",
    )


def run(args):
    values = dotenv_values(ROOT / ".env")
    if (
        values.get("APP_ENV") != "local"
        or values.get("PUBLIC_DEPLOYMENT", "false").lower() == "true"
    ):
        raise RuntimeError("Private local import only")
    path = Path(args.plan).resolve()
    private = (ROOT / "data/imports").resolve()
    if not path.is_relative_to(private):
        raise ValueError("Plan must remain in the Git-excluded data/imports directory")
    plan = json.loads(path.read_text(encoding="utf-8"))
    body_list = [
        GarmentUpsert.model_validate(
            dict(owner_id=plan["owner_id"], device_id=plan["device_id"], **i["garment"])
        ).model_dump(mode="json")
        for i in plan["items"]
    ]
    identities = [
        digest([plan["owner_id"], plan["device_id"], i["source_key"], b["color"], 1])
        for i, b in zip(plan["items"], body_list, strict=True)
    ]
    if not body_list or len(set(identities)) != len(identities):
        raise ValueError("Empty plan or repeated physical-item identity")
    lock = path.with_suffix(".lock")
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    journal_path = path.with_suffix(".journal.json")
    cache = private / "images"
    try:
        journal = (
            json.loads(journal_path.read_text(encoding="utf-8"))
            if journal_path.exists()
            else {
                "plan_sha256": digest(plan),
                "items": {},
                "held": plan.get("held", []),
            }
        )
        cache.mkdir(exist_ok=True)
        if journal["plan_sha256"] != digest(plan):
            raise ValueError(
                "Plan changed; reconcile existing item identities before execution"
            )
        for identity, item in zip(identities, plan["items"], strict=True):
            entry = journal["items"].setdefault(
                identity,
                {
                    "source_key": item["source_key"],
                    "metadata": item.get("metadata", {}),
                    "quantity": 1,
                },
            )
            if args.with_images and "image" not in entry:
                entry["image"] = image(item, cache)
                save(journal_path, journal)
            if args.with_images:
                picture = entry["image"]
                cached = (cache / picture["file"]).resolve()
                if not cached.is_relative_to(cache.resolve()):
                    raise ValueError("Image cache path escaped private directory")
                raw = cached.read_bytes()
                if (
                    len(raw) != picture["bytes"]
                    or hashlib.sha256(raw).hexdigest() != picture["sha256"]
                ):
                    raise ValueError("Cached image differs from verified source")
        if not args.execute:
            save(journal_path, journal)
            print(
                json.dumps(
                    {
                        "mode": "prepared",
                        "items": len(body_list),
                        "held": len(journal["held"]),
                        "images_verified": sum(
                            "image" in e for e in journal["items"].values()
                        ),
                    }
                )
            )
            return
        local_command(
            "git", "ls-files", "--error-unmatch", "scripts/import_owned_garments.py"
        )
        if local_command("git", "status", "--porcelain", "--untracked-files=no"):
            raise ValueError("Commit tracked changes before database execution")
        revision = local_command("git", "rev-parse", "HEAD")
        remote = local_command("git", "ls-remote", "origin", "refs/heads/main").split()[
            0
        ]
        if revision != remote:
            raise ValueError("Push verified implementation before database execution")
        journal["implementation_revision"] = revision
        journal["remote_checked_at_utc"] = datetime.now(UTC).isoformat()
        save(journal_path, journal)
        if "backup" not in journal:
            journal["backup"] = backup()
            journal["before"] = snapshot()
            save(journal_path, journal)
        with httpx.Client(
            base_url="http://127.0.0.1:8000/api/v1", timeout=40
        ) as client:

            def api(method, route, body=None, key=None, version=None):
                headers = {"Idempotency-Key": str(key)} if key else {}
                if version:
                    headers["If-Match"] = str(version)
                response = client.request(method, route, json=body, headers=headers)
                if response.status_code >= 400:
                    raise RuntimeError(
                        f"API {method} {route.split('?')[0]} failed ({response.status_code})"
                    )
                return response.json() if response.content else None

            login = api("POST", "/integration/demo-login")
            client.headers["Authorization"] = "Bearer " + login["access_token"]
            try:
                if login["member"]["id"] != plan["owner_id"]:
                    raise ValueError("Plan owner does not match authenticated account")
                devices = api("GET", "/integration/devices")["items"]
                if plan["device_id"] not in {d["id"] for d in devices}:
                    raise ValueError("Plan device is not accessible")
                settings = api("GET", "/settings")
                if args.with_images and not settings["image_upload_consent"]:
                    if not args.grant_image_consent:
                        raise ValueError(
                            "Image consent is absent; no garments were registered"
                        )
                    api("PUT", "/settings", {**settings, "image_upload_consent": True})
                    journal["image_consent"] = (
                        "explicit user grant through settings API"
                    )
                    save(journal_path, journal)
                for identity, item, body in zip(
                    identities, plan["items"], body_list, strict=True
                ):
                    entry = journal["items"][identity]
                    if entry.get("garment_id"):
                        actual = api("GET", "/garments/" + entry["garment_id"])
                        for key in (
                            "owner_id",
                            "device_id",
                            "name",
                            "category",
                            "color",
                        ):
                            if actual[key] != body[key]:
                                raise ValueError("Registered garment differs from plan")
                        continue
                    if args.with_images:
                        picture = entry["image"]
                        if not entry.get("image_uploaded"):
                            entry.setdefault(
                                "intent_key",
                                str(uuid5(NAMESPACE_URL, identity + ":image-intent")),
                            )
                            save(journal_path, journal)
                            intent = api(
                                "POST",
                                "/assets/upload-intents",
                                {
                                    "file_name": picture["file"],
                                    "content_type": picture["content_type"],
                                    "size_bytes": picture["bytes"],
                                    "purpose": "GARMENT",
                                },
                                entry["intent_key"],
                            )
                            if entry.get("asset_id") not in {None, intent["asset_id"]}:
                                raise ValueError("Upload retry changed asset identity")
                            entry["asset_id"] = intent["asset_id"]
                            save(journal_path, journal)
                            target = urlparse(intent["upload_url"])
                            if (
                                target.scheme != "http"
                                or target.hostname not in {"localhost", "127.0.0.1"}
                                or target.port != 9000
                            ):
                                raise ValueError(
                                    "Local private storage target required"
                                )
                            httpx.put(
                                intent["upload_url"],
                                content=(cache / picture["file"]).read_bytes(),
                                headers=intent["required_headers"],
                                timeout=40,
                            ).raise_for_status()
                            entry["image_uploaded"] = True
                            save(journal_path, journal)
                        api(
                            "POST",
                            "/assets/" + entry["asset_id"] + "/finalize",
                            {"checksum_sha256": picture["sha256"]},
                            str(uuid5(NAMESPACE_URL, identity + ":finalize")),
                        )
                        body["image_asset_id"] = entry["asset_id"]
                    entry.setdefault(
                        "registration_key",
                        str(uuid5(NAMESPACE_URL, identity + ":garment")),
                    )
                    if "request" in entry and entry["request"] != body:
                        raise ValueError(
                            "Registration body changed after first attempt"
                        )
                    entry["request"] = body
                    save(journal_path, journal)
                    actual = api("POST", "/garments", body, entry["registration_key"])
                    entry["garment_id"] = actual["id"]
                    save(journal_path, journal)
                if args.replace_seed:
                    outfits = api("GET", "/outfits?limit=100")["items"]
                    for outfit in outfits:
                        if (
                            outfit["status"] == "SAVED"
                            and outfit["items"]
                            and {i["garment_id"] for i in outfit["items"]} <= SEED_IDS
                        ):
                            api(
                                "PATCH",
                                "/outfits/" + outfit["id"],
                                {
                                    "items": outfit["items"],
                                    "title": outfit["title"],
                                    "status": "ARCHIVED",
                                },
                                version=outfit["version"],
                            )
                    for row in api("GET", "/garments?limit=100")["items"]:
                        if row["id"] in SEED_IDS:
                            api(
                                "DELETE",
                                "/garments/" + row["id"],
                                version=row["version"],
                            )
                    journal["seed_cleanup"] = (
                        "3 known Seed IDs retired, saved Seed outfits archived; historical drafts retained"
                    )
                active = api("GET", "/garments?limit=100")["items"]
                for entry in journal["items"].values():
                    actual = api("GET", "/garments/" + entry["garment_id"])
                    assert (
                        actual["status"] == "UNKNOWN" and actual["location_id"] is None
                    )
                    if args.with_images:
                        assert actual["image"]["asset_id"] == entry["asset_id"]
                        data = httpx.get(actual["image"]["read_url"], timeout=20)
                        data.raise_for_status()
                        assert (
                            hashlib.sha256(data.content).hexdigest()
                            == entry["image"]["sha256"]
                        )
                if args.replace_seed:
                    assert not SEED_IDS & {i["id"] for i in active}
                journal["after"] = snapshot()
                for history in ("wear", "care", "observations"):
                    assert journal["after"][history] == journal["before"][history]
                journal["verified_at_utc"] = datetime.now(UTC).isoformat()
                save(journal_path, journal)
                print(
                    json.dumps(
                        {
                            "registered": len(journal["items"]),
                            "held": len(journal["held"]),
                            "active_garments": len(active),
                            "history_unchanged": True,
                        }
                    )
                )
            finally:
                api("POST", "/integration/logout")
    finally:
        lock.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--with-images", action="store_true")
    parser.add_argument("--grant-image-consent", action="store_true")
    parser.add_argument("--replace-seed", action="store_true")
    run(parser.parse_args())
