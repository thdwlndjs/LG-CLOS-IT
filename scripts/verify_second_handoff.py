"""Real HTTP + DB + Redis + MinIO verification in an isolated disposable API/DB."""

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
(root / "test-results").mkdir(exist_ok=True)
Image.new("RGB", (240, 320), "#d5d9c7").save(
    root / "test-results/integration-fixture.png"
)
suffix = uuid4().hex
database = "wardrobe_test_" + suffix
container = "smart-wardrobe-second-handoff-verify-" + suffix
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
        "-e",
        "LED_OFF_SECONDS=2",
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
    command(
        "docker",
        "exec",
        container,
        "python",
        "/workspace/scripts/seed_integration_test.py",
    )
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
            "-e",
            "LED_OFF_SECONDS=2",
            "smart-wardrobe-api",
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

        browser_env = os.environ.copy()
        browser_env["WEB_API_TARGET"] = base
        browser_env["INTEGRATION_API"] = base
        browser_env["INTEGRATION_CONTAINER"] = container
        browser_env["WEB_PORT"] = "5174"
        outcome = subprocess.run(
            ["node", "test/second-handoff.mjs"],
            cwd=root / "web",
            env=browser_env,
            capture_output=True,
            encoding="utf-8",
            timeout=900,
        )
        (root / "test-results/second-handoff-browser.log").write_text(
            outcome.stdout + outcome.stderr, encoding="utf-8"
        )
        if outcome.returncode:
            raise RuntimeError(
                "Browser verification failed; see second-handoff-browser.log"
            )
        evidence["checks"]["browser"] = json.loads(
            (root / "test-results/second-handoff-browser-evidence.json").read_text(
                encoding="utf-8"
            )
        )
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
    (root / "test-results/second-handoff-live-evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )

print(json.dumps(evidence, ensure_ascii=False, indent=2))
