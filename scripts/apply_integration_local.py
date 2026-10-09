"""Back up the local Compose DB, migrate without data loss, and restart the API."""

import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from dotenv import dotenv_values

root = Path(__file__).resolve().parents[1]
values = dotenv_values(root / ".env")
if values.get("APP_ENV") != "local" or values.get("PUBLIC_DEPLOYMENT", "false").lower() == "true":
    raise RuntimeError("This command is restricted to the private local Compose environment")
compose = ["docker", "compose", "--env-file", ".env", "-f", "infra/compose.yaml"]
results = root / "test-results"
results.mkdir(exist_ok=True)
stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def run(*args, input_text=None):
    result = subprocess.run(args, cwd=root, input=input_text, capture_output=True,
                            encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(f"Local integration operation failed: exit {result.returncode}")
    return result.stdout.strip()


def snapshot():
    sql = """
SELECT json_build_object(
 'garments', (SELECT count(*) FROM wardrobe.garment),
 'garment_hash', (SELECT md5(coalesce(jsonb_agg(to_jsonb(g)-'device_id' ORDER BY id)::text,'')) FROM wardrobe.garment g),
 'state_hash', (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY garment_id)::text,'')) FROM wardrobe.garment_state s),
 'wear', (SELECT count(*) FROM wardrobe.wear_event),
 'outfits', (SELECT count(*) FROM wardrobe.outfit),
 'cards', (SELECT count(*) FROM wardrobe.outfit_card));
"""
    return json.loads(run(*compose, "exec", "-T", "postgres", "sh", "-c",
                          'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1',
                          input_text=sql))


run(*compose, "stop", "api", "worker")
before = snapshot()
backup_name = f"wardrobe-before-integration-{stamp}.dump"
run(*compose, "exec", "-T", "postgres", "sh", "-c",
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/' + backup_name)
postgres = run(*compose, "ps", "-q", "postgres")
backup = results / backup_name
run("docker", "cp", f"{postgres}:/tmp/{backup_name}", str(backup))
backup_hash = hashlib.sha256(backup.read_bytes()).hexdigest()
run(*compose, "run", "--rm", "--no-deps", "api", "python", "-m", "alembic", "upgrade", "head")
after = snapshot()
if before != after:
    raise RuntimeError("Existing garment/state or history changed; services remain stopped for review")
run("docker", "tag", "smart-wardrobe-api", "smart-wardrobe-worker")
run(*compose, "up", "-d", "--no-build", "--no-deps", "api", "worker")
evidence = dict(before=before, after=after, original_data_preserved=True,
                backup_file=backup_name, backup_sha256=backup_hash,
                migration="0004_device_integration", applied_at_utc=stamp)
(results / "integration-local-migration.json").write_text(
    json.dumps(evidence, indent=2), encoding="utf-8")
print(json.dumps(evidence))
