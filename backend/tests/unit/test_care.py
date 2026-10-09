from datetime import UTC, date, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.core.errors import ApiError
from app.domain.care import date_window, label_constraints, next_recurrence
from app.schemas.sprint5 import CareScheduleCreate


@pytest.mark.parametrize(
    ("due", "completed", "expected"),
    [
        (
            "2026-03-07T07:30:00+00:00",
            "2026-03-07T08:00:00+00:00",
            "2026-03-08T07:30:00+00:00",
        ),  # nonexistent 02:30 becomes 03:30
        (
            "2026-10-31T05:30:00+00:00",
            "2026-10-31T06:00:00+00:00",
            "2026-11-01T05:30:00+00:00",
        ),  # ambiguous 01:30 uses earlier fold
        ("2026-01-01T15:00:00+00:00", "2026-01-05T16:00:00+00:00", "2026-01-06T15:00:00+00:00"),
    ],
)
def test_calendar_recurrence_independent_wall_clock_examples(due, completed, expected):
    result = next_recurrence(
        datetime.fromisoformat(due), datetime.fromisoformat(completed), 1, "America/New_York"
    )
    assert result == datetime.fromisoformat(expected)


def test_local_window_inclusive_dates_and_dst():
    since, until, _ = date_window(
        date(2026, 3, 8), date(2026, 3, 8), "America/New_York", datetime.now(UTC)
    )
    assert since == datetime(2026, 3, 8, 5, tzinfo=UTC)
    assert until - since == timedelta(hours=23)
    since, until, _ = date_window(
        date(2026, 1, 2), date(2026, 1, 2), "Asia/Seoul", datetime.now(UTC)
    )
    assert since == datetime(2026, 1, 1, 15, tzinfo=UTC)
    assert until - since == timedelta(days=1)


@pytest.mark.parametrize(
    "start,end,zone",
    [
        (date(2026, 1, 2), date(2026, 1, 1), "UTC"),
        (date(2025, 1, 1), date(2026, 1, 2), "UTC"),
        (None, None, "Invalid/Zone"),
        (date.max, date.max, "UTC"),
        (None, date.min, "UTC"),
    ],
)
def test_invalid_history_windows(start, end, zone):
    with pytest.raises(ApiError):
        date_window(start, end, zone, datetime.now(UTC))


def test_explicit_label_prohibitions_only():
    assert label_constraints("DO NOT WASH; DO NOT TUMBLE DRY") == {
        "machine_wash_allowed": False,
        "tumble_dry_allowed": False,
    }
    assert label_constraints("Cotton 100%") == {}
    assert label_constraints(None) == {}
    assert label_constraints("물세탁 금지") == {"machine_wash_allowed": False}
    assert label_constraints("HAND WASH") == {"machine_wash_allowed": False}


def test_recurrence_calendar_overflow_is_validation_error():
    with pytest.raises(ApiError):
        next_recurrence(datetime.max.replace(tzinfo=UTC), datetime.now(UTC), 7, "UTC")


@pytest.mark.parametrize("at", [123, True, "2026-01-01T00:00:00"])
def test_timestamp_requires_iso_offset(at):
    with pytest.raises(ValidationError):
        CareScheduleCreate(
            garment_id="40000000-0000-4000-8000-000000000001", scheduled_at=at, care_type="WASH"
        )
