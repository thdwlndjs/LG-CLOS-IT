import asyncio
import json
import logging
from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.application.outbox import consume, envelope
from app.core.logging import JsonFormatter


def test_envelope_preserves_identity_without_invented_version():
    row = dict(
        id=UUID(int=1),
        aggregate_id=UUID(int=2),
        household_id=UUID(int=3),
        event_type="Changed",
        aggregate_type="garment",
        created_at=datetime.now(UTC),
        schema_version=1,
        correlation_id="request-id",
        payload={"reference": "fixture"},
    )
    message = envelope(row)
    assert message["event_id"] == str(row["id"]) and message["aggregate_version"] is None
    assert message["payload"] == row["payload"]
    row["payload"]["revision"] = 3
    assert envelope(row)["aggregate_version"] == 3


def test_structured_telemetry_allowlist_does_not_emit_private_details():
    row = logging.LogRecord("wardrobe", logging.INFO, "", 0, "job_event", (), None)
    row.job_id = "fixture-job"
    row.attempts = 2
    row.outcome = "FAILED"
    row.provider_mode = "MOCK"
    row.payload = {"secret": "private-person-image"}
    row.provider_exception = "private-provider-error"
    data = json.loads(JsonFormatter().format(row))
    assert data["job_id"] == "fixture-job" and data["provider_mode"] == "MOCK"
    assert data["attempts"] == 2 and data["outcome"] == "FAILED"
    assert "private" not in json.dumps(data)


def test_consumer_rejects_unknown_schema_and_invalid_identity_safely():
    for message in (
        {"schema_version": 2},
        {"schema_version": True},
        {"schema_version": 1, "event_id": "private-input"},
    ):
        with pytest.raises(ValueError) as exc:
            asyncio.run(consume(None, message))
        assert "private-input" not in str(exc.value)
