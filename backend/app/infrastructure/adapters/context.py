"""Explicit synthetic fixture; no live weather/calendar/holiday claims."""

from datetime import UTC


def collect_context(settings, mode, at):
    use_mock = mode == "MOCK" or settings.weather_provider == "MOCK"
    weather = (
        dict(temperature_c=18.0, humidity_pct=65.0, precipitation_mm=0.0, condition="CLOUDY")
        if use_mock
        else {}
    )
    missing = ["is_holiday", "location_label"]
    if not use_mock:
        missing += [
            "weather.temperature_c",
            "weather.humidity_pct",
            "weather.precipitation_mm",
            "weather.condition",
        ]
    calendar_mock = mode == "MOCK" or settings.calendar_provider == "MOCK"
    if not calendar_mock:
        missing.append("schedule")
    source_status = {}
    for name, mocked in (("weather", use_mock), ("schedule", calendar_mock), ("holiday", False)):
        source_status[name] = dict(
            source="SYNTHETIC_FIXTURE" if mocked else "UNCONFIGURED",
            observed_at=at.astimezone(UTC).isoformat() if mocked else None,
            freshness="FRESH" if mocked else "UNKNOWN",
            is_mock=mocked,
            missing_fields=(
                [x for x in missing if x.startswith(name)] if name != "holiday" else ["is_holiday"]
            ),
        )
    provenance = dict(missing_fields=missing, source_status=source_status)
    return weather, [], provenance, "MOCK" if use_mock and calendar_mock else "PARTIAL"
