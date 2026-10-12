"""Print a storage-only command for an independent Engine. Never execute Docker."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def plan(engine: str, env_file: str, independent: bool) -> list[str]:
    parsed = urlparse(engine)
    if (
        not independent
        or parsed.scheme != "ssh"
        or not parsed.hostname
        or parsed.hostname.lower() in {"localhost", "docker-desktop", "host.docker.internal"}
        or parsed.hostname.startswith(("127.", "192.168.65."))
        or parsed.hostname in {"::1", "0.0.0.0"}
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("An independently verified remote SSH Engine is required")
    env = Path(env_file).resolve()
    if not env.is_file() or not env.name.startswith(".env"):
        raise ValueError("Use an existing ignored .env file with private recovery credentials")
    return [
        "docker", "--host", engine, "compose", "--env-file", str(env),
        "-f", str(ROOT / "infra/compose.demo-recovery.yaml"),
        "--project-name", "wardrobe-recovery-demo", "up", "-d",
        "postgres", "minio", "redis",
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--independent-host-verified", action="store_true")
    args = parser.parse_args()
    print(json.dumps(plan(args.engine, args.env_file, args.independent_host_verified)))


if __name__ == "__main__":
    main()
