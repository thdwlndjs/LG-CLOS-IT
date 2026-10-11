"""Publish approved additive C wire contract without rewriting legacy paths/schemas."""

import hashlib
import json
import os

import yaml

from handoff_local import ROOT, test_environment

os.environ.update(test_environment())
from app.main import create_app  # noqa: E402

docs = ROOT / "docs"
spec_path = docs / "06_OPENAPI.yaml"
original = spec_path.read_text(encoding="utf-8")
source = yaml.safe_load(original)
generated = create_app().openapi()
prefix = "/api/v1/integration/vton-jobs"
paths = {p: m for p, m in generated["paths"].items() if p.startswith(prefix)}
schemas = {
    n: s
    for n, s in generated["components"]["schemas"].items()
    if n not in source["components"]["schemas"]
}
if not all(p in source["paths"] for p in paths):
    assert not any(p in source["paths"] for p in paths), (
        "Partial publication: inspect before editing"
    )
    addition = yaml.safe_dump(paths, allow_unicode=True, sort_keys=False)
    original = original.replace(
        "\ncomponents:\n",
        "\n"
        + "\n".join("  " + line for line in addition.splitlines())
        + "\ncomponents:\n",
        1,
    )
    assert source["components"].keys() and "    Login:" in original
    original += (
        "\n"
        + "\n".join(
            "    " + line
            for line in yaml.safe_dump(
                schemas, allow_unicode=True, sort_keys=False
            ).splitlines()
        )
        + "\n"
    )
    spec_path.write_text(original, encoding="utf-8", newline="\r\n")
    revision_path = docs / "CONTRACT_REVISION_1_7.json"
    revision = json.loads(revision_path.read_text(encoding="utf-8"))
    prior = revision["current_sha256"]["06_OPENAPI.yaml"]
    revision["current_sha256"]["06_OPENAPI.yaml"] = hashlib.sha256(
        spec_path.read_bytes()
    ).hexdigest()
    revision["amendments"].append(
        dict(
            id="2026-10-12-C1-C6-VTON",
            authorized_by="User C1-C6 execution approval; Mock is not real try-on quality",
            base_head="a1e439b",
            previous_current_sha256={"06_OPENAPI.yaml": prior},
            current_sha256={
                "06_OPENAPI.yaml": revision["current_sha256"]["06_OPENAPI.yaml"]
            },
            scope="Additive provenance-aware integration VTON routes and DTOs; no DB migration or D-G",
        )
    )
    revision_path.write_text(
        json.dumps(revision, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
published = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
for path, methods in paths.items():
    assert published["paths"][path] == methods
# Hashes include original newline bytes; .gitattributes fixes this contract to CRLF.
spec_path.write_text(
    spec_path.read_text(encoding="utf-8"), encoding="utf-8", newline="\r\n"
)
revision_path = docs / "CONTRACT_REVISION_1_7.json"
revision = json.loads(revision_path.read_text(encoding="utf-8"))
digest = hashlib.sha256(spec_path.read_bytes()).hexdigest()
revision["current_sha256"]["06_OPENAPI.yaml"] = digest
for amendment in revision["amendments"]:
    if amendment["id"] == "2026-10-12-C1-C6-VTON":
        amendment["current_sha256"]["06_OPENAPI.yaml"] = digest
revision_path.write_text(
    json.dumps(revision, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
)
print("Published three additive C operations; legacy contracts preserved")
