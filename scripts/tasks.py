"""Makefile-equivalent commands for Windows without make."""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ["docker", "compose", "--env-file", ".env", "-f", "infra/compose.yaml"]


def main():
    commands = {
        "bootstrap": [sys.executable, "scripts/bootstrap.py"],
        "up": COMPOSE + ["up", "-d", "--build", "postgres", "redis", "minio", "storage-init",
                         "renderer", "api", "worker"],
        "migrate": COMPOSE + ["exec", "-T", "api", "python", "-m", "alembic", "upgrade", "head"],
        "seed": COMPOSE + ["exec", "-T", "api", "python", "/workspace/scripts/seed.py"],
        "smoke": [sys.executable, "scripts/smoke.py"],
        "smoke-sprint1": [sys.executable, "scripts/smoke_sprint1.py"],
        "test-e2e-sprint1": [sys.executable, "scripts/verify_sprint1.py"],
        "smoke-sprint2": [sys.executable, "scripts/smoke_sprint2.py"],
        "test-e2e-sprint2": [sys.executable, "scripts/verify_sprint2.py"],
        "smoke-sprint3": [sys.executable, "scripts/smoke_sprint3.py"],
        "test-e2e-sprint3": [sys.executable, "scripts/verify_sprint3.py"],
        "smoke-sprint4": [sys.executable, "scripts/smoke_sprint4.py"],
        "test-e2e-sprint4": [sys.executable, "scripts/verify_sprint4.py"],
        "smoke-sprint5": [sys.executable, "scripts/smoke_sprint5.py"],
        "test-e2e-sprint5": [sys.executable, "scripts/verify_sprint5.py"],
        "smoke-sprint6": [sys.executable, "scripts/smoke_sprint6.py"],
        "test-e2e-sprint6": [sys.executable, "scripts/verify_sprint6.py"],
        "smoke-sprint7": [sys.executable, "scripts/smoke_sprint7.py"],
        "test-e2e-sprint7": [sys.executable, "scripts/verify_sprint7.py"],
        "observe": COMPOSE + ["exec", "-T", "api", "python", "/workspace/scripts/observe.py"],
        "test-e2e-mock": COMPOSE + ["--profile", "test", "run", "--rm", "tests",
                                    "python", "-m", "pytest", "tests/e2e", "-q"],
        "test-unit": COMPOSE + ["run", "--rm", "--no-deps", "api", "python", "-m", "pytest",
                                "tests/unit", "-q"],
        "test-contract": COMPOSE + ["run", "--rm", "--no-deps", "api", "python", "-m", "pytest",
                                    "tests/contract", "-q"],
        "test-integration": COMPOSE + ["--profile", "test", "run", "--rm", "tests"],
        "lint": COMPOSE + ["run", "--rm", "--no-deps", "api", "python", "-m", "ruff", "check",
                           "/workspace/backend", "/workspace/scripts"],
        "down": COMPOSE + ["--profile", "test", "down"],
    }
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task", choices=list(commands))
    task = parser.parse_args().task
    raise SystemExit(subprocess.call(commands[task], cwd=ROOT))


if __name__ == "__main__":
    main()
