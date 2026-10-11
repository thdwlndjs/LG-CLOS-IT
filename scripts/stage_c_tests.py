"""Run integration gates with ignored isolated service credentials, never print them."""

import subprocess
import sys
from uuid import uuid4

from handoff_local import ROOT, test_environment

arguments = sys.argv[1:]
if not any(value.startswith("--basetemp") for value in arguments):
    arguments += [
        "--basetemp",
        str(ROOT / "test-results" / ("stage-c-pytest-" + uuid4().hex)),
    ]
result = subprocess.run(
    [sys.executable, "-m", "pytest", *arguments, "-p", "no:cacheprovider"],
    cwd=ROOT,
    env=test_environment(),
)
raise SystemExit(result.returncode)
