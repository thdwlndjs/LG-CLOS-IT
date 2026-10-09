"""Compare generated routes/DTOs, rather than serving the original spec as evidence."""

import pytest

from app.api.v1.sprint1 import source_contract
from app.main import create_app

pytestmark = pytest.mark.contract


def normalized(value):
    if isinstance(value, list):
        return [normalized(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {
        key: (
            {name: normalized(schema) for name, schema in item.items()}
            if key == "properties"
            else normalized(item)
        )
        for key, item in value.items()
        if key not in {"title", "description", "default", "examples"}
    }
    if "const" in result:
        result["enum"] = [result.pop("const")]
    return result


def test_schema_normalization_preserves_business_title_field():
    schema = {"title": "Metadata", "properties": {"title": {"type": "string"}}}
    assert normalized(schema) == {"properties": {"title": {"type": "string"}}}
    assert normalized(schema) != normalized({"properties": {}})


def test_generated_sprint1_operations_and_components_match_source(settings):
    generated = create_app(settings).openapi()
    source = source_contract()
    assert generated["info"]["version"] == source["info"]["version"]
    assert sum(len(methods) for methods in generated["paths"].values()) == 52
    for path, methods in generated["paths"].items():
        for method, actual in methods.items():
            expected = source["paths"][path][method]
            assert actual["operationId"] == expected["operationId"]
            assert actual["x-fsd-ids"] == expected["x-fsd-ids"]
            assert actual.get("security", []) == expected.get("security", source["security"])
            assert set(actual["responses"]) == set(expected["responses"])
            for code, response in actual["responses"].items():
                assert normalized(response.get("content")) == normalized(
                    expected["responses"][code].get("content")
                )
            assert normalized(actual.get("requestBody")) == normalized(expected.get("requestBody"))
            ap = {(p["in"], p["name"]): p for p in actual.get("parameters", [])}
            ep = {(p["in"], p["name"]): p for p in expected.get("parameters", [])}
            assert set(ap) == set(ep)
            for identity, parameter in ap.items():
                actual_schema = normalized(parameter["schema"])
                expected_schema = normalized(ep[identity]["schema"])
                if not ep[identity]["required"] and "anyOf" in actual_schema:
                    # Optional query omission is represented as nullable by FastAPI/Pydantic.
                    actual_schema = next(
                        branch for branch in actual_schema["anyOf"] if branch.get("type") != "null"
                    )
                assert parameter["required"] == ep[identity]["required"]
                assert actual_schema == expected_schema
    for name, schema in generated["components"]["schemas"].items():
        assert name in source["components"]["schemas"], name
        assert normalized(schema) == normalized(source["components"]["schemas"][name]), name
