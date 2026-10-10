"""Run real PostgreSQL regression exclusively against our disposable local services."""

import json
import subprocess
import sys

from handoff_local import ROOT, RUNTIME, test_environment

runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
args = sys.argv[1:] or [
    "backend/tests/unit",
    "backend/tests/integration",
    "backend/tests/e2e",
    "-q",
    "-p",
    "no:cacheprovider",
    "--basetemp",
    str(RUNTIME.parent / "pytest-tmp"),
]
result = subprocess.run(
    [sys.executable, "-m", "pytest", *args],
    cwd=ROOT,
    env=test_environment(),
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
)
output = result.stdout + result.stderr
for value in runtime.values():
    if isinstance(value, str):
        output = output.replace(value, "[REDACTED]")
(RUNTIME.parent / "pytest.log").write_text(output, encoding="utf-8")
print(output[-14000:])
sys.exit(result.returncode)
