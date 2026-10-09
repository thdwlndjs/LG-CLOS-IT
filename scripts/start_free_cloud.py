"""Single free web instance: FastAPI + DB-backed jobs + loopback-only renderer."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx

from start_cloud import configure, private_bucket


def main():
    source = dict(os.environ)
    if source.get("STORAGE_PROVIDER") != "SUPABASE":
        raise ValueError("Free cloud entry requires external private Supabase storage")
    source["RENDERER_HOSTPORT"] = "127.0.0.1:3000"
    values = configure(source)
    values.update(WORKER_EXECUTION="INLINE", DECART_MAX_CONCURRENCY="1")
    values.setdefault("DATABASE_CA_FILE", str(
        Path(__file__).resolve().parents[1] / "infra/cloud/supabase-ca.crt"
    ))
    os.environ.update(values)
    private_bucket()
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
    root = Path(__file__).resolve().parents[1]
    renderer = subprocess.Popen(
        ["node", "src/server.mjs"], cwd=root / "renderer",
        env=dict(os.environ, RENDERER_BIND_HOST="127.0.0.1", RENDERER_PORT="3000"),
    )
    api = None
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True
        if api and api.poll() is None:
            api.terminate()
        if renderer.poll() is None:
            renderer.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        for attempt in range(30):
            if stopping or renderer.poll() is not None:
                raise RuntimeError("Renderer stopped before readiness")
            try:
                with httpx.Client(timeout=8, trust_env=False) as client:
                    response = client.get("http://127.0.0.1:3000/health/ready")
                    response.raise_for_status()
                break
            except httpx.HTTPError:
                if attempt == 29:
                    raise RuntimeError("Renderer did not become ready") from None
                time.sleep(1)
        api = subprocess.Popen([
            sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory",
            "--host", "0.0.0.0", "--port", os.getenv("PORT", "10000"),
            "--no-access-log", "--workers", "1",
        ])
        while not stopping:
            if renderer.poll() is not None or api.poll() is not None:
                raise RuntimeError("Required cloud process exited")
            time.sleep(1)
    finally:
        stop(None, None)
        for process in (api, renderer):
            if process:
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    main()
