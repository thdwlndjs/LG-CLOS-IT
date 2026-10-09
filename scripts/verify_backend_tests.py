"""Run regression tests using the dedicated disposable PostgreSQL test instance."""

import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4

from dotenv import dotenv_values
from sqlalchemy.engine import URL

root = Path(__file__).resolve().parents[1]
values = dotenv_values(root / ".env")
environment = os.environ.copy()
environment["TEST_DATABASE_URL"] = URL.create(
    "postgresql+asyncpg", username="wardrobe_test", password=values["POSTGRES_PASSWORD"],
    host="postgres-test", database="wardrobe_test",
).render_as_string(hide_password=False)
name = "wardrobe-regression-" + uuid4().hex


def run(*args):
    result = subprocess.run(args, cwd=root, env=environment, capture_output=True,
                            encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(f"Container operation failed ({args[1]})")
    return result.stdout.strip()


started = False
try:
    run("docker", "run", "--rm", "-d", "--name", name,
        "--network", "smart-wardrobe_default", "--env-file", str(root / ".env"),
        "-e", "TEST_DATABASE_URL", "-e", "APP_ENV=test", "smart-wardrobe-api", "sleep", "infinity")
    started = True
    run("docker", "network", "connect", "smart-wardrobe_render-private", name)
    result = subprocess.run(
        ["docker", "exec", name, "python", "-m", "pytest", "tests", "-m", "integration",
         "-q", "-p", "no:cacheprovider", "--basetemp=/tmp/wardrobe-regression"],
        cwd=root, env=environment, capture_output=True, encoding="utf-8", errors="replace",
    )
    output = result.stdout + result.stderr
    for value in values.values():
        if value and len(value) >= 8:
            output = output.replace(value, "[REDACTED]")
    (root / "test-results/backend-integration-regression.log").write_text(output, encoding="utf-8")
    print(json.dumps(dict(exit_code=result.returncode, summary=output.splitlines()[-1:])))
    if result.returncode:
        raise RuntimeError("Regression tests failed; see sanitized evidence log")
finally:
    if started:
        run("docker", "stop", name)
