import hashlib
import json

import pytest
import yaml

from app.core.paths import DOCS_DIR
from app.schemas.errors import Error, ErrorEnvelope

pytestmark = pytest.mark.contract


@pytest.fixture(scope="module")
def contract():
    return yaml.safe_load((DOCS_DIR / "06_OPENAPI.yaml").read_text(encoding="utf-8"))


def test_all_refs_resolve_and_fsd_inventory_is_covered(contract):
    def visit(value):
        if isinstance(value, dict):
            if "$ref" in value:
                assert value["$ref"].startswith("#/")
                target = contract
                for segment in value["$ref"][2:].split("/"):
                    target = target[segment.replace("~1", "/").replace("~0", "~")]
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(contract)
    covered = {
        fsd
        for methods in contract["paths"].values()
        for op in methods.values()
        for fsd in op["x-fsd-ids"]
    }
    assert len(covered) == 28
    operations = [
        op["operationId"] for methods in contract["paths"].values() for op in methods.values()
    ]
    assert len(operations) == len(set(operations))


def test_historical_baseline_is_frozen_and_current_revision_is_explicit(contract):
    from app.core.paths import PROJECT_ROOT

    baseline = PROJECT_ROOT / "backend/alembic/baselines/0001_schema.sql"
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == (
        "70bbf42ae0e70157ea90c7c2f8ab1c44a542b0f70d51f0bb67515a0296f09c2e"
    )
    assert hashlib.sha256((DOCS_DIR / "07_DATABASE_SEED.sql").read_bytes()).hexdigest() == (
        "a0cbd33d2461fe616ed4cfe0e2a81587ba571c7df9858bdf06612718bd1a6418"
    )
    assert contract["info"]["version"] == "1.7.0"
    previous = json.loads((DOCS_DIR / "CONTRACT_REVISION_1_1.json").read_text())
    for name, digest in previous["current_sha256"].items():
        archived = DOCS_DIR / "contracts/1.1" / name
        assert hashlib.sha256(archived.read_bytes()).hexdigest() == digest
    previous2 = json.loads((DOCS_DIR / "CONTRACT_REVISION_1_2.json").read_text())
    for name, digest in previous2["current_sha256"].items():
        assert (
            hashlib.sha256((DOCS_DIR / "contracts/1.2" / name).read_bytes()).hexdigest() == digest
        )
    previous3 = json.loads((DOCS_DIR / "CONTRACT_REVISION_1_3.json").read_text())
    for name, digest in previous3["current_sha256"].items():
        assert (
            hashlib.sha256((DOCS_DIR / "contracts/1.3" / name).read_bytes()).hexdigest() == digest
        )
    previous4 = json.loads((DOCS_DIR / "CONTRACT_REVISION_1_4.json").read_text())
    for name, digest in previous4["current_sha256"].items():
        assert (
            hashlib.sha256((DOCS_DIR / "contracts/1.4" / name).read_bytes()).hexdigest() == digest
        )
    previous5 = json.loads((DOCS_DIR / "CONTRACT_REVISION_1_5.json").read_text())
    for name, digest in previous5["current_sha256"].items():
        assert (
            hashlib.sha256((DOCS_DIR / "contracts/1.5" / name).read_bytes()).hexdigest() == digest
        )
    previous6 = json.loads((DOCS_DIR / "CONTRACT_REVISION_1_6.json").read_text())
    for name, digest in previous6["current_sha256"].items():
        assert (
            hashlib.sha256((DOCS_DIR / "contracts/1.6" / name).read_bytes()).hexdigest() == digest
        )
    revision = json.loads((DOCS_DIR / "CONTRACT_REVISION_1_7.json").read_text())
    assert len(revision["current_sha256"]) == 7
    for name, digest in revision["current_sha256"].items():
        assert hashlib.sha256((DOCS_DIR / name).read_bytes()).hexdigest() == digest


def test_error_dto_matches_source_wire_schema(contract):
    source = contract["components"]["schemas"]["Error"]
    actual = Error.model_json_schema()
    assert actual["required"] == source["required"]
    assert actual["additionalProperties"] == source["additionalProperties"]
    assert set(actual["properties"]) == set(source["properties"])
    for name in source["properties"]:
        assert actual["properties"][name]["type"] == source["properties"][name]["type"]
    assert ErrorEnvelope.model_json_schema()["required"] == ["error"]


def test_openapi_31_with_official_validator(contract):
    validator = pytest.importorskip(
        "openapi_spec_validator", reason="OpenAPI validator not installed"
    )
    validator.validate(contract)
