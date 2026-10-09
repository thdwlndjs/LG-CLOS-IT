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
container = "smart-wardrobe-sprint7-verify-" + suffix
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
worker_started = False
worker = container + "-worker"
env["WORKER_QUEUE"] = "sprint7_" + suffix


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
        home_response = client.get("/api/v1/home?timezone=Asia/Seoul")
        assert home_response.status_code == 200, home_response.text
        dashboard = home_response.json()
        assert dashboard["today_context"]["id"] == context["id"]
        assert dashboard["today_outfits"] == result["candidates"]
        assert dashboard["today_context"]["source_mode"] == "MOCK"
        assert (
            client.get(
                "/api/v1/home?member_id=20000000-0000-4000-8000-000000000002"
            ).status_code
            == 403
        )
        evidence["checks"]["home_context_recommendation_provenance_scope"] = "passed"

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
        assert (
            client.put(
                "/api/v1/settings", json={**changed, "image_upload_consent": True}
            ).status_code
            == 200
        )

        def upload_vton(purpose):
            intent = client.post(
                "/api/v1/assets/upload-intents",
                json=dict(
                    file_name="vton.png",
                    content_type="image/png",
                    size_bytes=len(data),
                    purpose=purpose,
                ),
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
                "/api/v1/assets/" + upload["asset_id"] + "/finalize",
                json=dict(checksum_sha256=hashlib.sha256(data).hexdigest()),
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert finalized.status_code == 201
            return upload["asset_id"]

        person = upload_vton("PERSON_VTON")
        garment_image = upload_vton("GARMENT")
        for garment in client.get("/api/v1/garments").json()["items"]:
            attached = client.patch(
                "/api/v1/garments/" + garment["id"],
                json=dict(
                    owner_id=owner,
                    category=garment["category"],
                    color=garment["color"],
                    image_asset_id=garment_image,
                ),
                headers={"If-Match": str(garment["version"])},
            )
            assert attached.status_code == 200

        refreshed = client.post(
            "/api/v1/outfit-recommendations",
            json=recommend_body,
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert refreshed.status_code == 201, refreshed.text
        source = refreshed.json()["candidates"][0]["outfit"]["id"]
        manual = client.post(
            "/api/v1/outfits",
            json=dict(items=outfit["items"], title="Manual selection", status="SAVED"),
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert manual.status_code == 201, manual.text
        manual_session = client.post(
            "/api/v1/vton-sessions",
            headers={"Idempotency-Key": str(uuid4())},
            json=dict(
                member_id=owner,
                source_screen="OUTFIT_EDITOR",
                outfit_id=manual.json()["id"],
            ),
        )
        assert manual_session.status_code == 201, manual_session.text
        assert manual_session.json()["items"] == manual.json()["items"]
        evidence["checks"]["manual_outfit_to_common_vton_initial_values"] = "passed"

        headers = {"Idempotency-Key": str(uuid4())}
        session_body = dict(
            member_id=owner,
            source_screen="MY_OUTFITS",
            outfit_id=source,
            context_snapshot_id=context["id"],
            person_asset_id=person,
        )
        created_session = client.post(
            "/api/v1/vton-sessions", json=session_body, headers=headers
        )
        assert created_session.status_code == 201
        session = created_session.json()
        assert (
            session["vton_available"]
            and session["outfit_id"] != source
            and session["source_outfit_id"] == source
        )
        assert (
            client.post(
                "/api/v1/vton-sessions", json=session_body, headers=headers
            ).json()
            == session
        )
        evidence["checks"]["vton_session_binding_clone_replay"] = "passed"
        command(
            "docker",
            "run",
            "--rm",
            "-d",
            "--name",
            worker,
            "--network",
            network,
            "--env-file",
            str(root / ".env"),
            "-e",
            "DATABASE_URL",
            "-e",
            "WORKER_QUEUE",
            "-e",
            "APP_ENV=test",
            "smart-wardrobe-worker",
            "python",
            "-m",
            "celery",
            "-A",
            "app.workers.celery_app:celery_app",
            "worker",
            "--pool=solo",
            "--concurrency=1",
            "--loglevel=WARNING",
            "--beat",
            "--schedule=/tmp/sprint7-verify-beat",
        )
        worker_started = True
        command("docker", "network", "connect", "smart-wardrobe_render-private", worker)

        def submit_job(session, headers=None):
            response = client.post(
                "/api/v1/vton-jobs",
                json=dict(
                    session_id=session["id"],
                    expected_revision=session["revision"],
                    outfit_id=session["outfit_id"],
                    person_asset_id=person,
                ),
                headers=headers or {"Idempotency-Key": str(uuid4())},
            )
            assert response.status_code == 202
            return response.json()

        def wait_job(identity):
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                response = client.get("/api/v1/jobs/" + identity)
                assert response.status_code == 200
                job = response.json()
                if job["status"] == "SUCCEEDED":
                    return job
                assert job["status"] not in {"FAILED", "TIMED_OUT", "CANCELLED"}
                time.sleep(0.2)
            raise AssertionError("Real Celery VTON completion timeout")

        headers = {"Idempotency-Key": str(uuid4())}
        accepted = submit_job(session, headers)
        assert submit_job(session, headers) == accepted
        job = wait_job(accepted["job_id"])
        assert (
            job["provider_mode"] == "MOCK"
            and job["is_current"]
            and job["attempt_count"] == 1
        )
        with httpx.Client(timeout=10) as storage:
            result_bytes = storage.get(job["result_asset"]["read_url"]).content
            with Image.open(io.BytesIO(result_bytes)) as result:
                assert result.size == (320, 240) and result.format == "PNG"
            assert (
                storage.get(job["result_asset"]["read_url"].split("?")[0]).status_code
                == 403
            )
        assert (
            client.get("/api/v1/vton-sessions/" + session["id"]).json()[
                "current_result_job_id"
            ]
            == job["id"]
        )
        evidence["checks"]["real_celery_async_mock_png_private"] = "passed"
        modified = client.patch(
            "/api/v1/vton-sessions/" + session["id"] + "/outfit",
            json=dict(expected_revision=0, items=session["items"][:2]),
        )
        assert modified.status_code == 200
        current = modified.json()
        assert current["revision"] == 1 and current["current_result_job_id"] is None
        assert client.get("/api/v1/jobs/" + job["id"]).json()["stale"]
        assert (
            client.patch(
                "/api/v1/vton-sessions/" + session["id"] + "/outfit",
                json=dict(expected_revision=0, items=session["items"]),
            ).status_code
            == 409
        )
        replacement = wait_job(submit_job(current)["job_id"])
        assert (
            client.get("/api/v1/vton-sessions/" + session["id"]).json()[
                "current_result_job_id"
            ]
            == replacement["id"]
        )
        evidence["checks"]["revision_stale_result_isolation_new_result"] = "passed"
        command("docker", "pause", worker)
        try:
            cancelled = submit_job(current)
            cancelled_response = client.post(
                "/api/v1/jobs/" + cancelled["job_id"] + "/cancel",
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert (
                cancelled_response.status_code == 201
                and cancelled_response.json()["status"] == "CANCELLED"
            )
        finally:
            command("docker", "unpause", worker)
        assert (
            client.post(
                "/api/v1/vton-jobs",
                json=dict(
                    session_id=current["id"],
                    expected_revision=1,
                    outfit_id=current["outfit_id"],
                    person_asset_id=person,
                    provider="DECART",
                ),
                headers={"Idempotency-Key": str(uuid4())},
            ).status_code
            == 503
        )
        evidence["checks"]["queued_cancel_and_explicit_live_unavailable"] = "passed"
        headers = {"Idempotency-Key": str(uuid4())}
        end_body = dict(
            expected_revision=1, final_outfit_id=current["outfit_id"], save_outfit=True
        )
        ended = client.post(
            "/api/v1/vton-sessions/" + current["id"] + "/end",
            json=end_body,
            headers=headers,
        )
        assert ended.status_code == 201 and ended.json()["status"] == "ENDED"
        assert len(ended.json()["final_items_snapshot"]) == 2
        assert ended.json()["card_entry_payload"]["outfit_id"] == current["outfit_id"]
        assert (
            client.post(
                "/api/v1/vton-sessions/" + current["id"] + "/end",
                json=end_body,
                headers=headers,
            ).json()
            == ended.json()
        )
        assert (
            client.get("/api/v1/outfits/" + current["outfit_id"]).json()["status"]
            == "SAVED"
        )
        # Real asynchronous React/Chromium card pipeline after VTON final selection.
        draft_headers = {"Idempotency-Key": str(uuid4())}
        card_body = dict(outfit_id=current["outfit_id"], template_id="minimal-v1")
        card_response = client.post(
            "/api/v1/cards/drafts", json=card_body, headers=draft_headers
        )
        assert card_response.status_code == 201
        assert (
            client.post(
                "/api/v1/cards/drafts", json=card_body, headers=draft_headers
            ).json()
            == card_response.json()
        )
        card = card_response.json()
        for output_format in ("PNG", "WEBP"):
            render_response = client.post(
                "/api/v1/card-render-jobs",
                json=dict(card_id=card["id"], output_format=output_format),
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert render_response.status_code == 202
            rendered = wait_job(render_response.json()["job_id"])
            assert (
                rendered["kind"] == "CARD_RENDER" and rendered["card_id"] == card["id"]
            )
            with httpx.Client(timeout=10) as storage:
                result = storage.get(rendered["result_asset"]["read_url"])
                assert result.status_code == 200
                with Image.open(io.BytesIO(result.content)) as image:
                    assert image.size == (1080, 1350) and image.format == output_format
                    image.load()
                (
                    root / f"test-results/sprint7-card-preview.{output_format.lower()}"
                ).write_bytes(result.content)
            assert client.get("/api/v1/cards/" + card["id"]).json()["status"] == "READY"
        evidence["checks"]["card_real_celery_chromium_png_webp_private_storage"] = (
            "passed"
        )
        save_headers = {"Idempotency-Key": str(uuid4())}
        save_body = dict(visibility="SHAREABLE", reuse_outfit=True)
        saved = client.post(
            "/api/v1/cards/" + card["id"] + "/save",
            json=save_body,
            headers=save_headers,
        )
        assert saved.status_code == 201
        assert (
            client.post(
                "/api/v1/cards/" + card["id"] + "/save",
                json=save_body,
                headers=save_headers,
            ).json()
            == saved.json()
        )
        assert saved.json()["linked_outfit_id"] == current["outfit_id"]
        share_path = saved.json()["share_url"]
        public = client.get(share_path, headers={"Authorization": ""})
        assert public.status_code == 200 and public.content == result.content
        assert public.headers["cache-control"] == "no-store"
        assert client.get("/api/v1/cards").json()["page"]["total"] == 1
        evidence["checks"]["card_explicit_share_save_idempotency_reuse"] = "passed"
        assert (
            client.post(
                "/api/v1/cards/" + card["id"] + "/save",
                json=dict(visibility="PRIVATE"),
                headers={"Idempotency-Key": str(uuid4())},
            ).status_code
            == 201
        )
        assert client.get(share_path).status_code == 404
        evidence["checks"]["card_private_revokes_share"] = "passed"
        counts = command(
            "docker",
            "exec",
            "smart-wardrobe-postgres-test-1",
            "psql",
            "-U",
            "wardrobe_test",
            "-d",
            database,
            "-At",
            "-c",
            "SELECT json_build_object('wear',(SELECT count(*) FROM wardrobe.wear_event),"
            "'feedback',(SELECT count(*) FROM wardrobe.outfit_feedback),"
            "'mock_results',(SELECT count(*) FROM wardrobe.asset "
            "WHERE kind='VTON_RESULT' AND metadata->>'is_mock'='true'))",
        )
        counts = json.loads(counts)
        assert counts == dict(wear=0, feedback=1, mock_results=2)
        evidence["isolated_database_counts"] = counts

        # Actual HTTP Sprint 5 flow; no direct inserts can manufacture successful events.
        def post(path, body, headers=None):
            return client.post(
                "/api/v1" + path,
                json=body,
                headers=headers or {"Idempotency-Key": str(uuid4())},
            )

        history = client.get("/api/v1/history?kind=OUTFIT_SELECTION").json()
        assert history["page"]["total"] == 1
        assert client.get("/api/v1/history?kind=WEAR").json()["page"]["total"] == 0
        evidence["checks"]["session_selection_is_not_wear"] = "passed"
        wear_body = dict(
            member_id=owner,
            outfit_id=current["outfit_id"],
            session_id=current["id"],
            confirmation_method="USER",
            worn_at=datetime.now(UTC).isoformat(),
        )
        wear_headers = {"Idempotency-Key": str(uuid4())}
        wear = post("/wear-confirmations", wear_body, wear_headers)
        assert wear.status_code == 201, wear.text
        assert (
            post("/wear-confirmations", wear_body, wear_headers).json() == wear.json()
        )
        assert post("/wear-confirmations", wear_body).status_code == 409
        assert wear.json()["items_snapshot"] == ended.json()["final_items_snapshot"]
        assert (
            client.get("/api/v1/history?kind=WEAR").json()["items"][0]["status"]
            == "CONFIRMED"
        )
        evidence["checks"]["explicit_wear_snapshot_idempotency_session_dedupe"] = (
            "passed"
        )
        canceled = post(
            "/wear-confirmations/" + wear.json()["id"] + "/cancel",
            dict(expected_version=1, reason="Acceptance cancellation"),
        )
        assert canceled.status_code == 201
        assert (
            client.get("/api/v1/history?kind=WEAR").json()["items"][0]["status"]
            == "CANCELLED"
        )
        evidence["checks"]["wear_cancel_preserves_history"] = "passed"
        garment_id = current["items"][0]["garment_id"]
        guide_url = "/api/v1/garments/" + garment_id
        guide = client.get(guide_url + "/care-guide")
        assert guide.status_code == 200
        profile = client.put(
            guide_url + "/care-profile",
            headers={"Idempotency-Key": str(uuid4())},
            json=dict(
                expected_version=guide.json()["profile_version"],
                care_group="USER_REVIEW",
                instructions=["Check manufacturer label"],
                constraints={},
            ),
        )
        assert profile.status_code == 200
        assert (
            client.get(guide_url + "/care-guide").json()["profile_version"]
            == profile.json()["profile_version"]
        )
        evidence["checks"]["care_guide_editable_profile"] = "passed"
        schedule_body = dict(
            garment_id=garment_id,
            scheduled_at=datetime.now(UTC).isoformat(),
            care_type="WASH",
            recurrence_days=7,
            timezone="Asia/Seoul",
        )
        schedule_headers = {"Idempotency-Key": str(uuid4())}
        schedule_response = post("/care-schedules", schedule_body, schedule_headers)
        assert schedule_response.status_code == 201, schedule_response.text
        schedule = schedule_response.json()
        assert (
            post("/care-schedules", schedule_body, schedule_headers).json() == schedule
        )
        assert post("/care-schedules", schedule_body).status_code == 409
        edit = client.patch(
            "/api/v1/care-schedules/" + schedule["id"],
            headers={"Idempotency-Key": str(uuid4())},
            json={
                **{k: v for k, v in schedule_body.items() if k != "garment_id"},
                "expected_version": 1,
                "status": "SCHEDULED",
                "notes": "User plan",
            },
        )
        assert edit.status_code == 200, edit.text
        evidence["checks"]["care_schedule_create_edit_dedupe"] = "passed"
        complete_url = "/care-schedules/" + schedule["id"] + "/complete"
        missed = post(
            complete_url,
            dict(
                completed_at=datetime.now(UTC).isoformat(),
                expected_version=2,
                outcome="NOT_DONE",
            ),
        )
        assert missed.status_code == 201 and missed.json()["next_schedule_id"] is None
        assert missed.json()["completed_at"] is None
        completed_body = dict(
            completed_at=datetime.now(UTC).isoformat(), expected_version=3
        )
        completed_headers = {"Idempotency-Key": str(uuid4())}
        completed = post(complete_url, completed_body, completed_headers)
        assert completed.status_code == 201, completed.text
        done = completed.json()
        assert done["status"] == "COMPLETED" and done["next_schedule_id"]
        assert post(complete_url, completed_body, completed_headers).json() == done
        assert post(complete_url, completed_body).status_code == 409
        assert {
            r["status"] for r in client.get("/api/v1/history?kind=CARE").json()["items"]
        } == {"NOT_DONE", "COMPLETED"}
        evidence["checks"]["care_not_done_success_recurrence_atomic_idempotency"] = (
            "passed"
        )
        cancel = post(
            "/care-schedules/" + schedule["id"] + "/completion/cancel",
            dict(expected_version=4, reason="Corrected completion"),
        )
        assert cancel.status_code == 201 and cancel.json()["next_due_at"] is None
        assert {
            r["status"] for r in client.get("/api/v1/history?kind=CARE").json()["items"]
        } == {"NOT_DONE", "CANCELLED"}
        evidence["checks"]["care_completion_cancel_preserves_events_cancels_next"] = (
            "passed"
        )
        assert client.get("/api/v1/history?timezone=Invalid/Zone").status_code == 422
        assert (
            client.get(
                "/api/v1/care-schedules?from=2025-01-01&to=2026-01-02"
            ).status_code
            == 422
        )
        assert (
            post(
                "/wear-confirmations",
                {**wear_body, "confirmation_method": "SENSOR_VERIFIED"},
            ).status_code
            == 503
        )
        evidence["checks"]["history_filters_sensor_unavailable"] = "passed"
        evidence["sprint5_database_counts"] = json.loads(
            command(
                "docker",
                "exec",
                "smart-wardrobe-postgres-test-1",
                "psql",
                "-U",
                "wardrobe_test",
                "-d",
                database,
                "-At",
                "-c",
                "SELECT json_build_object('wear',(SELECT count(*) FROM wardrobe.wear_event),"
                "'cancelled_wear',(SELECT count(*) FROM wardrobe.wear_event "
                "WHERE cancelled_at IS NOT NULL),"
                "'care_events',(SELECT count(*) FROM wardrobe.care_event),"
                "'cancelled_schedules',(SELECT count(*) FROM wardrobe.care_schedule "
                "WHERE status='CANCELLED'))",
            )
        )
        assert evidence["sprint5_database_counts"] == dict(
            wear=1, cancelled_wear=1, care_events=2, cancelled_schedules=2
        )
        assert client.put("/api/v1/settings", json=changed).status_code == 200
        with httpx.Client(timeout=10) as storage:
            assert (
                storage.get(replacement["result_asset"]["read_url"]).status_code == 404
            )
        assert (
            client.get("/api/v1/jobs/" + replacement["id"]).json()["result_asset"]
            is None
        )
        evidence["checks"]["final_snapshot_feedback_no_wear_result_revoke"] = "passed"

        def fixture_sql(sql):
            return command(
                "docker",
                "exec",
                "smart-wardrobe-postgres-test-1",
                "psql",
                "-U",
                "wardrobe_test",
                "-d",
                database,
                "-At",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                sql,
            )

        top = "40000000-0000-4000-8000-000000000001"
        bottom = "40000000-0000-4000-8000-000000000002"
        source = "30000000-0000-4000-8000-000000000001"
        destination = "30000000-0000-4000-8000-000000000002"
        fixture_sql(
            "UPDATE wardrobe.garment SET season_tags=ARRAY['SPRING'] "
            f"WHERE id IN ('{top}','{bottom}')"
        )
        request = dict(
            household_id=login_body["household_id"],
            member_id=owner,
            mode="WEAR_PATTERN",
            season="SUMMER",
            garment_ids=[top, bottom],
        )
        submit_headers = {"Idempotency-Key": str(uuid4())}
        queued = post("/storage-optimization-jobs", request, submit_headers)
        assert queued.status_code == 202, queued.text
        assert (
            post("/storage-optimization-jobs", request, submit_headers).json()
            == queued.json()
        )
        assert (
            post(
                "/storage-optimization-jobs",
                {**request, "dry_run": True},
                submit_headers,
            ).status_code
            == 409
        )
        storage_job = wait_job(queued.json()["job_id"])
        result = storage_job["storage_result"]
        assert storage_job["kind"] == "STORAGE_OPTIMIZATION"
        assert result["status"] == "FEASIBLE" and len(result["proposed_items"]) == 2
        action_id = result["action_ids"][0]
        action = client.get("/api/v1/storage-actions/" + action_id).json()
        assert (
            action["status"] == "PROPOSED"
            and action["rules_version"] == "storage-greedy-v1"
        )
        assert (
            client.get("/api/v1/storage-actions?status=PROPOSED").json()["page"][
                "total"
            ]
            == 1
        )
        evidence["checks"]["storage_real_celery_versioned_season_plan_idempotency"] = (
            "passed"
        )
        before = fixture_sql(
            "SELECT json_agg(json_build_object('id',garment_id,'location',location_id,"
            "'version',version) ORDER BY garment_id) FROM wardrobe.garment_state"
        )
        approve_headers = {"Idempotency-Key": str(uuid4())}
        decision_path = "/storage-actions/" + action_id + "/decision"
        approval_body = dict(expected_version=1, decision="APPROVE")
        approved = post(decision_path, approval_body, approve_headers)
        assert approved.status_code == 201, approved.text
        assert (
            post(decision_path, approval_body, approve_headers).json()
            == approved.json()
        )
        after = fixture_sql(
            "SELECT json_agg(json_build_object('id',garment_id,'location',location_id,"
            "'version',version) ORDER BY garment_id) FROM wardrobe.garment_state"
        )
        assert before == after
        evidence["checks"]["storage_approval_does_not_move"] = "passed"
        confirm_path = "/storage-actions/" + action_id + "/confirm"
        actual = dict(
            garment_id=top,
            confirmed=True,
            observed_location_id=destination,
            observed_at=datetime.now(UTC).isoformat(),
            confirmation_method="USER",
        )
        confirmation_headers = {"Idempotency-Key": str(uuid4())}
        confirm_body = dict(expected_version=2, items=[actual])
        partial = post(confirm_path, confirm_body, confirmation_headers)
        assert partial.status_code == 201, partial.text
        assert partial.json()["status"] == "AWAITING_CONFIRMATION"
        assert (
            post(confirm_path, confirm_body, confirmation_headers).json()
            == partial.json()
        )
        assert (
            post(confirm_path, dict(expected_version=3, items=[actual])).status_code
            == 409
        )
        assert (
            fixture_sql(
                f"SELECT location_id FROM wardrobe.garment_state WHERE garment_id='{top}'"
            )
            == destination
        )
        assert (
            fixture_sql(
                f"SELECT location_id FROM wardrobe.garment_state WHERE garment_id='{bottom}'"
            )
            == source
        )
        evidence["checks"]["storage_actual_partial_confirm_atomic_replay"] = "passed"
        failed = post(
            confirm_path,
            dict(
                expected_version=3,
                items=[
                    dict(
                        garment_id=bottom,
                        confirmed=False,
                        failure_reason="Movement not performed",
                    )
                ],
            ),
        )
        assert failed.status_code == 201 and failed.json()["status"] == "FAILED"
        assert (
            fixture_sql(
                f"SELECT location_id FROM wardrobe.garment_state WHERE garment_id='{bottom}'"
            )
            == source
        )
        evidence["checks"]["storage_partial_failure_preserves_unmoved_location"] = (
            "passed"
        )
        queued = post(
            "/storage-optimization-jobs", {**request, "garment_ids": [bottom]}
        )
        action_id = wait_job(queued.json()["job_id"])["storage_result"]["action_ids"][0]
        approved = post("/storage-actions/" + action_id + "/decision", approval_body)
        assert approved.status_code == 201
        completed = post(
            "/storage-actions/" + action_id + "/confirm",
            dict(
                expected_version=2,
                items=[
                    {
                        **actual,
                        "garment_id": bottom,
                        "observed_at": datetime.now(UTC).isoformat(),
                    }
                ],
            ),
        )
        assert (
            completed.status_code == 201 and completed.json()["status"] == "COMPLETED"
        )
        evidence["checks"]["storage_full_completion_updates_actual_location"] = "passed"
        dry_job = post(
            "/storage-optimization-jobs",
            {**request, "dry_run": True, "season": "SPRING"},
        )
        dry = wait_job(dry_job.json()["job_id"])["storage_result"]
        assert (
            dry["dry_run"] and not dry["action_ids"] and len(dry["proposed_items"]) == 2
        )
        evidence["checks"]["storage_dry_run_has_no_action_or_movement"] = "passed"
        environment_job = post(
            "/storage-optimization-jobs", {**request, "mode": "SPACE_ENVIRONMENT"}
        )
        unavailable = wait_job(environment_job.json()["job_id"])["storage_result"]
        assert (
            unavailable["status"] == "NO_FEASIBLE_PLAN"
            and not unavailable["action_ids"]
        )
        assert all(
            "ENVIRONMENT_UNMEASURED" in row["reasons"] for row in unavailable["blocked"]
        )
        evidence["checks"]["storage_missing_environment_is_explicitly_infeasible"] = (
            "passed"
        )
        sensor = post(
            "/storage-actions/" + action_id + "/confirm",
            dict(
                expected_version=3,
                items=[{**actual, "confirmation_method": "SENSOR_VERIFIED"}],
            ),
        )
        assert sensor.status_code == 503
        evidence["checks"]["storage_unverified_sensor_rejected"] = "passed"
        evidence["sprint6_database_counts"] = json.loads(
            fixture_sql(
                "SELECT json_build_object('actions',(SELECT count(*) FROM wardrobe.storage_action),"
                "'items',(SELECT count(*) FROM wardrobe.storage_action_item),"
                "'completed',(SELECT count(*) FROM wardrobe.storage_action_item "
                "WHERE status='COMPLETED'),"
                "'failed',(SELECT count(*) FROM wardrobe.storage_action_item "
                "WHERE status='FAILED'),"
                "'movement_observations',(SELECT count(*) FROM wardrobe.garment_observation "
                "WHERE sensor_id LIKE 'storage-action:%'),"
                "'wear',(SELECT count(*) FROM wardrobe.wear_event))"
            )
        )
        assert evidence["sprint6_database_counts"] == dict(
            actions=2, items=3, completed=2, failed=1, movement_observations=2, wear=1
        )
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            counts = json.loads(
                fixture_sql(
                    "SELECT json_build_object('unpublished',(SELECT count(*) "
                    "FROM wardrobe.domain_event_outbox "
                    "WHERE status<>'PUBLISHED'),'published',(SELECT count(*) "
                    "FROM wardrobe.domain_event_outbox "
                    "WHERE status='PUBLISHED'),'receipts',(SELECT count(*) FROM wardrobe.audit_log "
                    "WHERE action='DOMAIN_EVENT_CONSUMED'))"
                )
            )
            if (
                counts["unpublished"] == 0
                and counts["published"] == counts["receipts"]
                and counts["published"] > 0
            ):
                break
            time.sleep(0.2)
        else:
            raise AssertionError("Outbox delivery/receipt timeout")
        evidence["outbox_delivery"] = counts
        duplicate_code = """
import asyncio,json
from sqlalchemy import text
from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources
from app.application.outbox import envelope
from app.workers.celery_app import celery_app
async def run():
 r=RuntimeResources(load_settings())
 try:
  async with r.database.sessions.begin() as s:
   query='SELECT * FROM wardrobe.domain_event_outbox ORDER BY created_at,id LIMIT 1'
   row=(await s.execute(text(query))).mappings().one()
   message=envelope(row)
  task=celery_app.send_task('wardrobe.consume_event',args=[message],
                           argsrepr='[<internal event envelope>]',retry=False)
  print(json.dumps({'task_id':task.id,'event_id':message['event_id']}))
 finally:await r.close()
asyncio.run(run())
"""
        duplicate = json.loads(
            command("docker", "exec", worker, "python", "-c", duplicate_code)
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            outcome = json.loads(
                command(
                    "docker",
                    "exec",
                    worker,
                    "python",
                    "-c",
                    "import json; from app.workers.celery_app import celery_app; "
                    "r=celery_app.AsyncResult('" + duplicate["task_id"] + "'); "
                    "print(json.dumps({'ready':r.ready(),"
                    "'result':r.result if r.ready() else None}))",
                )
            )
            if outcome["ready"]:
                break
            time.sleep(0.2)
        assert outcome["result"] == dict(
            event_id=duplicate["event_id"], duplicate=True
        ), outcome
        assert (
            int(
                fixture_sql(
                    "SELECT count(*) FROM wardrobe.audit_log WHERE action='DOMAIN_EVENT_CONSUMED'"
                )
            )
            == counts["receipts"]
        )
        evidence["checks"]["outbox_actual_celery_delivery_receipt_and_duplicate"] = (
            "passed"
        )
        evidence["duplicate_delivery"] = outcome["result"]
        telemetry = json.loads(
            command(
                "docker", "exec", container, "python", "/workspace/scripts/observe.py"
            )
        )
        assert (
            telemetry["outbox_pending"]
            == telemetry["outbox_retrying"]
            == telemetry["outbox_exhausted"]
            == 0
        )
        assert (
            telemetry["published"]
            == telemetry["consumer_receipts"]
            == counts["published"]
        )
        assert (
            telemetry["published_unconsumed"] == 0
            and telemetry["job_running"] == telemetry["job_queued"] == 0
        )
        evidence["telemetry"] = telemetry
        evidence["checks"]["internal_read_only_aggregate_observability"] = "passed"
        document = client.get("/openapi.json")
        assert document.status_code == 200
        assert sum(len(methods) for methods in document.json()["paths"].values()) == 52
        assert client.get("/docs").status_code == 200
        evidence["checks"]["openapi_swagger"] = "passed"
        for path in ("/health/live", "/health/ready"):
            assert client.get(path).status_code == 200
    evidence["verified_at_utc"] = datetime.now(UTC).isoformat()
finally:
    if worker_started:
        command("docker", "stop", worker)
    if started:
        purge = """
import asyncio
from sqlalchemy import text
from app.core.config import load_settings
from app.infrastructure.resources import RuntimeResources
from app.application.assets import cleanup_assets
async def run():
 settings=load_settings()
 assert settings.database_url.get_secret_value().rsplit('/',1)[-1].startswith('wardrobe_test_')
 resources=RuntimeResources(settings)
 try:
  async with resources.database.sessions.begin() as session:
   await session.execute(text("UPDATE wardrobe.asset SET status='DELETED'"))
  await cleanup_assets(settings,resources.database.sessions,resources.storage)
  await resources.redis.delete("QUEUE_PLACEHOLDER")
 finally:
  await resources.close()
asyncio.run(run())
""".replace("QUEUE_PLACEHOLDER", env["WORKER_QUEUE"])
        command("docker", "exec", container, "python", "-c", purge)
    if started:
        command("docker", "stop", container)
    if created:
        psql(f'DROP DATABASE "{database}" WITH (FORCE)')
    evidence["isolated_resources_removed"] = True
    (root / "test-results/sprint7-live-evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )

assert len(evidence["checks"]) == 39
print(json.dumps(evidence, ensure_ascii=False, indent=2))
