from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.errors import ApiError


def timezone_for(name):
    try:
        return ZoneInfo(name)
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise ApiError(422, "VALIDATION_ERROR", "Invalid timezone") from error


def date_window(start, end, timezone, now):
    zone = timezone_for(timezone)
    end = end or now.astimezone(zone).date()
    try:
        start = start or end - timedelta(days=30)
        if end < start or (end - start).days > 365:
            raise ApiError(422, "VALIDATION_ERROR", "Date range must be 1..366 days")
        return (
            datetime.combine(start, time.min, zone).astimezone(UTC),
            datetime.combine(end + timedelta(days=1), time.min, zone).astimezone(UTC),
            zone,
        )
    except OverflowError as error:
        raise ApiError(422, "VALIDATION_ERROR", "Date range exceeds supported calendar") from error


def next_recurrence(due, completed, days, timezone):
    zone = timezone_for(timezone)
    try:
        local = due.astimezone(zone)
        # Jump by calendar days, then normalize nonexistent DST wall times through UTC.
        jumps = max(1, (completed.astimezone(zone).date() - local.date()).days // days)
    except OverflowError as error:
        raise ApiError(422, "VALIDATION_ERROR", "Recurrence exceeds supported calendar") from error
    for _ in range(3):
        try:
            proposed = local + timedelta(days=jumps * days)
            proposed = proposed.replace(fold=0).astimezone(UTC).astimezone(zone)
        except OverflowError as error:
            raise ApiError(
                422, "VALIDATION_ERROR", "Recurrence exceeds supported calendar"
            ) from error
        if proposed.astimezone(UTC) > completed.astimezone(UTC):
            return proposed.astimezone(UTC)
        jumps += 1
    raise ApiError(422, "VALIDATION_ERROR", "Recurrence could not be resolved")


def label_constraints(label):
    # Only explicit prohibitions; do not invent a material-specific washing temperature.
    result = {}
    text = label.upper() if label else ""
    if any(
        x in text
        for x in (
            "DO NOT WASH",
            "DRY CLEAN ONLY",
            "HAND WASH",
            "물세탁 금지",
            "드라이클리닝 전용",
            "손세탁",
        )
    ):
        result["machine_wash_allowed"] = False
    if any(x in text for x in ("DO NOT TUMBLE DRY", "건조기 사용 금지")):
        result["tumble_dry_allowed"] = False
    return result
