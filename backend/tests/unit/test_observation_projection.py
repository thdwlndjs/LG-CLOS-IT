from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.domain.observations import projection_decision
from app.schemas.sprint1 import ObservationRequest


@pytest.mark.parametrize(
    "age,confidence,same_location,expected",
    [
        (-1, 1, False, "retain"),
        (0, 1, True, "retain"),
        (0, 1, False, "conflict"),
        (1, 0.1, False, "retain"),
        (1, 0.9, False, "replace"),
    ],
)
def test_late_low_confidence_and_conflicting_observations(age, confidence, same_location, expected):
    now = datetime.now(UTC)
    location = uuid4()
    body = ObservationRequest(
        garment_id=uuid4(),
        sensor_type="MOCK",
        confidence=confidence,
        observed_at=now + timedelta(seconds=age),
        source_id="fixture",
        location_id=location if same_location else uuid4(),
    )
    assert projection_decision(now, 0.8, location, body) == expected


def test_observation_requires_timezone():
    with pytest.raises(ValueError, match="timezone"):
        ObservationRequest(
            garment_id=uuid4(),
            sensor_type="MOCK",
            confidence=0.8,
            observed_at=datetime.now(),
            source_id="fixture",
        )
