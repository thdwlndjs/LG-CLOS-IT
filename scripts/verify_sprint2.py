"""Real HTTP + DB + Redis + MinIO verification in an isolated disposable API/DB."""

import hashlib
import io
import json
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import dotenv_values
from PIL import Image
from sqlalchemy.engine import URL

root = Path(__file__).resolve().parents[1]
suffix = uuid4().hex
database = "wardrobe_test_" + suffix
container = "smart-wardrobe-sprint2-verify-" + suffix
assert database.startswith("wardrobe_test_") and len(suffix) == 32
evidence = {"database": database, "container": container, "checks": {}}
env = os.environ.copy()
secrets = dotenv_values(root / ".env")
env["DATABASE_URL"] = URL.create(
    "postgresql+asyncpg",
    username="wardrobe_test",
    password=secrets["POSTGRES_PASSWORD"],
    host="postgres-test",
    port=5432,
    database=database,
).render_as_string(hide_password=False)
created = False
started = False


def command(*args):
    result = subprocess.run(
        args, cwd=root, env=env, capture_output=True, encoding="utf-8"
    )
    if result.returncode:
        # Do not include arbitrary command output/URLs/credentials in diagnostics.
        raise RuntimeError(
            f"Command failed: {args[0]} {args[1]}, exit={result.returncode}"
        )
    return result.stdout.strip()


def psql(sql):
    return command(
        "docker",
        "compose",
        "--env-file",
        ".env",
        "-f",
        "infra/compose.yaml",
        "exec",
        "-T",
        "postgres-test",
        "psql",
        "-U",
        "wardrobe_test",
        "-d",
        "wardrobe_test",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
    )


try:
    psql(f'CREATE DATABASE "{database}"')
    created = True
    network_data = json.loads(
        command(
            "docker",
            "inspect",
            "--format",
            "{{json .NetworkSettings.Networks}}",
            "smart-wardrobe-postgres-test-1",
        )
    )
    assert len(network_data) == 1
    network = next(iter(network_data))
    command(
        "docker",
        "run",
        "--rm",
        "-d",
        "--name",
        container,
        "--network",
        network,
        "--env-file",
        str(root / ".env"),
        "-e",
        "DATABASE_URL",
        "-e",
        "APP_ENV=test",
        "-p",
        "127.0.0.1::8000",
        "smart-wardrobe-api",
    )
    started = True
    command("docker", "network", "connect", "smart-wardrobe_render-private", container)
    binding = json.loads(
        command(
            "docker",
            "inspect",
            "--format",
            '{{json (index .NetworkSettings.Ports "8000/tcp")}}',
            container,
        )
    )[0]
    assert binding["HostIp"] == "127.0.0.1"
    base = "http://127.0.0.1:" + binding["HostPort"]
    evidence["host_binding"] = binding
    command("docker", "exec", container, "python", "-m", "alembic", "upgrade", "head")
    command("docker", "exec", container, "python", "/workspace/scripts/seed.py")
    with httpx.Client(base_url=base, timeout=10) as client:
        for _attempt in range(30):
            try:
                response = client.get("/health/ready")
                if response.status_code == 200:
                    break
            except httpx.TransportError:
                pass
            time.sleep(0.5)
        else:
            raise RuntimeError("Isolated API did not become ready")
        assert response.json()["checks"] == {
            "database": "ok",
            "redis": "ok",
            "storage": "ok",
            "renderer": "ok",
        }
        evidence["checks"]["readiness"] = response.json()
        owner = "20000000-0000-4000-8000-000000000001"
        login_body = {
            "household_id": "10000000-0000-4000-8000-000000000001",
            "member_id": owner,
            "demo_mode": True,
        }
        key = {"Idempotency-Key": str(uuid4())}
        login = client.post("/api/v1/sessions", json=login_body, headers=key)
        assert login.status_code == 201
        assert (
            client.post("/api/v1/sessions", json=login_body, headers=key).json()
            == login.json()
        )
        client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
        evidence["checks"]["session_start_and_replay"] = "passed"
        listing = client.get("/api/v1/garments")
        assert listing.status_code == 200 and listing.json()["page"]["total"] == 3
        payload = {"owner_id": owner, "category": "VERIFY", "color": "BLUE"}
        key = {"Idempotency-Key": str(uuid4())}
        registered = client.post("/api/v1/garments", json=payload, headers=key)
        assert registered.status_code == 201
        item = registered.json()
        assert item["location_id"] is None and item["location_confidence"] is None
        assert client.post("/api/v1/garments", json=payload, headers=key).json() == item
        gid = item["id"]
        assert client.get("/api/v1/garments/" + gid).json() == item
        modified = client.patch(
            "/api/v1/garments/" + gid,
            json={**payload, "color": "RED"},
            headers={"If-Match": "1"},
        )
        assert modified.status_code == 200 and modified.json()["version"] == 2
        assert (
            client.patch(
                "/api/v1/garments/" + gid, json=payload, headers={"If-Match": "1"}
            ).status_code
            == 409
        )
        located = client.post("/api/v1/garments/locate", json={"garment_id": gid})
        assert (
            located.status_code == 201
            and located.json()["items"][0]["location_id"] is None
        )
        observation = client.post(
            "/api/v1/garment-observations",
            json={
                "garment_id": gid,
                "location_id": "30000000-0000-4000-8000-000000000001",
                "sensor_type": "MOCK",
                "confidence": 0.75,
                "observed_at": datetime.now(UTC).isoformat(),
                "source_id": "live-http-fixture",
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert observation.status_code == 201 and observation.json()["state_updated"]
        located = client.post("/api/v1/garments/locate", json={"garment_id": gid})
        assert located.json()["items"][0]["location_label"] == "Main Wardrobe"
        assert located.json()["items"][0]["confidence"] == 0.75
        evidence["checks"]["garment_create_read_update_locate_observe"] = "passed"
        current = client.get("/api/v1/settings")
        assert current.status_code == 200
        changed = {**current.json(), "timezone": "UTC", "notifications_enabled": False}
        assert client.put("/api/v1/settings", json=changed).json() == changed
        assert client.get("/api/v1/settings").json() == changed
        evidence["checks"]["settings_get_put"] = "passed"
        consent = {**changed, "image_upload_consent": True}
        assert client.put("/api/v1/settings", json=consent).status_code == 200
        output = io.BytesIO()
        Image.new("RGB", (8, 8), "blue").save(output, "PNG")
        data = output.getvalue()
        intent = client.post(
            "/api/v1/assets/upload-intents",
            json={
                "file_name": "fixture.png",
                "content_type": "image/png",
                "size_bytes": len(data),
                "purpose": "GARMENT",
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert intent.status_code == 201
        upload = intent.json()
        with httpx.Client(timeout=10) as storage:
            assert (
                storage.put(
                    upload["upload_url"],
                    content=data,
                    headers=upload["required_headers"],
                ).status_code
                == 200
            )
            finalized = client.post(
                f"/api/v1/assets/{upload['asset_id']}/finalize",
                json={"checksum_sha256": hashlib.sha256(data).hexdigest()},
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert finalized.status_code == 201
            asset = finalized.json()
            assert storage.get(asset["read_url"]).content == data
            assert storage.get(asset["read_url"].split("?")[0]).status_code == 403
            attached = client.patch(
                "/api/v1/garments/" + gid,
                json={
                    **payload,
                    "image_asset_id": asset["asset_id"],
                    "shared_with_member_ids": ["20000000-0000-4000-8000-000000000002"],
                },
                headers={"If-Match": str(observation.json()["garment"]["version"])},
            )
            assert attached.status_code == 200
            version = attached.json()["version"]
            owner_auth = client.headers["Authorization"]
            family = client.post(
                "/api/v1/sessions",
                json={
                    **login_body,
                    "member_id": "20000000-0000-4000-8000-000000000002",
                },
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert family.status_code == 201
            client.headers["Authorization"] = "Bearer " + family.json()["access_token"]
            detail = client.get("/api/v1/garments/" + gid)
            assert detail.status_code == 200
            assert storage.get(detail.json()["image"]["read_url"]).content == data
            assert (
                client.delete(
                    "/api/v1/garments/" + gid, headers={"If-Match": str(version)}
                ).status_code
                == 404
            )
            client.headers["Authorization"] = owner_auth
            assert client.put("/api/v1/settings", json=changed).status_code == 200
            assert storage.get(asset["read_url"]).status_code == 404
        history = client.get("/api/v1/settings/consent-history").json()["items"]
        assert [item["granted"] for item in history] == [True, False]
        evidence["checks"][
            "image_signed_put_finalize_get_anonymous_deny_revoke_delete"
        ] = "passed"
        assert (
            client.delete(
                "/api/v1/garments/" + gid, headers={"If-Match": str(version)}
            ).status_code
            == 200
        )
        assert client.get("/api/v1/garments/" + gid).status_code == 404
        client.headers["Authorization"] = "Bearer " + family.json()["access_token"]
        assert client.get("/api/v1/garments/" + gid).status_code == 404
        client.headers["Authorization"] = owner_auth
        evidence["checks"]["shared_read_owner_write_and_soft_delete"] = "passed"
        context_body = dict(
            member_id=login_body["member_id"], timezone="Asia/Seoul", mode="MOCK"
        )
        headers = {"Idempotency-Key": str(uuid4())}
        captured = client.post(
            "/api/v1/context-snapshots", json=context_body, headers=headers
        )
        assert captured.status_code == 201
        context = captured.json()
        assert context["source_mode"] == "MOCK" and context["is_holiday"] is None
        assert context["source_status"]["weather"]["is_mock"]
        assert (
            client.post(
                "/api/v1/context-snapshots", json=context_body, headers=headers
            ).json()
            == context
        )
        assert (
            client.get("/api/v1/context-snapshots/" + context["id"]).json() == context
        )
        evidence["checks"]["context_immutable_provenance_idempotency"] = "passed"
        recommend_body = dict(
            member_id=login_body["member_id"],
            context_snapshot_id=context["id"],
            constraints={"season": "SPRING"},
            limit=5,
        )
        headers = {"Idempotency-Key": str(uuid4())}
        recommended = client.post(
            "/api/v1/outfit-recommendations", json=recommend_body, headers=headers
        )
        assert recommended.status_code == 201
        result = recommended.json()
        assert len(result["candidates"]) == 1 and result["candidates"][0]["score"] == 70
        assert (
            client.post(
                "/api/v1/outfit-recommendations", json=recommend_body, headers=headers
            ).json()
            == result
        )
        outfit = result["candidates"][0]["outfit"]
        assert client.get("/api/v1/outfits/" + outfit["id"]).status_code == 200
        evidence["checks"]["recommend_fixed_score_trace_replay"] = "passed"
        body = dict(items=outfit["items"], title="Saved live look", status="SAVED")
        saved = client.patch(
            "/api/v1/outfits/" + outfit["id"], json=body, headers={"If-Match": "1"}
        )
        assert saved.status_code == 200 and saved.json()["version"] == 2
        assert (
            client.patch(
                "/api/v1/outfits/" + outfit["id"], json=body, headers={"If-Match": "1"}
            ).status_code
            == 409
        )
        archived = client.patch(
            "/api/v1/outfits/" + outfit["id"],
            json={**body, "status": "ARCHIVED"},
            headers={"If-Match": "2"},
        )
        assert archived.status_code == 200 and not archived.json()["try_on_ready"]
        evidence["checks"]["outfit_save_version_conflict_archive"] = "passed"
        assert (
            client.put(
                "/api/v1/settings", json={**changed, "image_upload_consent": True}
            ).status_code
            == 200
        )
        with httpx.Client(timeout=10) as storage:
            intent = client.post(
                "/api/v1/assets/upload-intents",
                json=dict(
                    file_name="style.png",
                    content_type="image/png",
                    size_bytes=len(data),
                    purpose="STYLE",
                ),
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert intent.status_code == 201
            upload = intent.json()
            assert (
                storage.put(
                    upload["upload_url"],
                    content=data,
                    headers=upload["required_headers"],
                ).status_code
                == 200
            )
            final = client.post(
                "/api/v1/assets/" + upload["asset_id"] + "/finalize",
                json={"checksum_sha256": hashlib.sha256(data).hexdigest()},
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert final.status_code == 201
            style = client.post(
                "/api/v1/style-references",
                json=dict(
                    member_id=login_body["member_id"],
                    source="OTHER",
                    title="Live reference",
                    source_url="https://example.com/style",
                    image_asset_id=upload["asset_id"],
                ),
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert style.status_code == 201
            listed = client.get("/api/v1/style-references?source=OTHER").json()["items"]
            assert (
                len(listed) == 1
                and storage.get(listed[0]["image"]["read_url"]).content == data
            )
            assert (
                storage.get(listed[0]["image"]["read_url"].split("?")[0]).status_code
                == 403
            )
            assert client.put("/api/v1/settings", json=changed).status_code == 200
            assert storage.get(listed[0]["image"]["read_url"]).status_code == 404
            assert (
                client.get("/api/v1/style-references").json()["items"][0]["image"]
                is None
            )
            assert (
                client.delete(
                    "/api/v1/style-references/" + style.json()["id"]
                ).status_code
                == 204
            )
        evidence["checks"]["style_actual_signed_upload_download_revoke_delete"] = (
            "passed"
        )
        document = client.get("/openapi.json")
        assert document.status_code == 200
        assert sum(len(methods) for methods in document.json()["paths"].values()) == 52
        assert client.get("/docs").status_code == 200
        evidence["checks"]["openapi_swagger"] = "passed"
        for path in ("/health/live", "/health/ready"):
            assert client.get(path).status_code == 200
    evidence["verified_at_utc"] = datetime.now(UTC).isoformat()
finally:
    if started:
        command("docker", "stop", container)
    if created:
        psql(f'DROP DATABASE "{database}" WITH (FORCE)')
    evidence["isolated_resources_removed"] = True
    (root / "test-results/sprint2-live-evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )

assert len(evidence["checks"]) == 11
print(json.dumps(evidence, ensure_ascii=False, indent=2))
