from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.domain.storage import constraints, plan, target_errors, units

NOW = datetime(2026, 10, 8, tzinfo=UTC)
SOURCE, DESTINATION = UUID(int=10), UUID(int=11)


def fixture(**patch):
    garment = dict(
        id=UUID(int=1),
        attributes={},
        care_constraints={},
        season_tags=["SPRING"],
        retired_at=None,
        status="AVAILABLE",
        location_id=SOURCE,
        location_confidence=0.98,
        last_seen_at=NOW,
        version=1,
        state_version=1,
        profile_version=0,
        **patch,
    )
    locations = [
        dict(id=SOURCE, attributes={}, location_type="WARDROBE", capacity_units=5),
        dict(id=DESTINATION, attributes={}, location_type="BOX", capacity_units=5),
    ]
    body = SimpleNamespace(mode="WEAR_PATTERN", season="SUMMER", dry_run=False)
    return garment, locations, body


def execute(garments, locations, body, occupancy=None, env=None, wear=None):
    return plan(
        garments,
        locations,
        occupancy or {SOURCE: len(garments), DESTINATION: 0},
        env or {},
        wear or {},
        body,
        NOW,
    )


def test_deterministic_explained_season_move_and_frozen_versions():
    garment, locations, body = fixture()
    result, snapshot = execute([garment], locations, body)
    assert result["status"] == "FEASIBLE"
    move = result["proposed_items"][0]
    assert move["destination_location_id"] == str(DESTINATION) and move["score"] == 90
    assert "CONFIRMED_WEAR_COUNT:0" in move["reasons"]
    assert snapshot[str(garment["id"])]["state_version"] == 1
    assert execute([garment], locations[::-1], body) == (result, snapshot)
    assert garment["location_id"] == SOURCE


def test_capacity_subset_is_conservative_and_order_independent():
    first, locations, body = fixture()
    second = {**first, "id": UUID(int=2)}
    locations[1]["capacity_units"] = 1
    result, _ = execute([second, first], locations, body)
    assert result["status"] == "PARTIAL" and len(result["proposed_items"]) == 1
    assert result["proposed_items"][0]["garment_id"] == str(first["id"])
    assert "CAPACITY_EXCEEDED" in result["blocked"][0]["reasons"]


@pytest.mark.parametrize(
    "patch,reason",
    [
        ({"location_id": None}, "LOCATION_UNCERTAIN"),
        ({"location_confidence": 0.79}, "LOCATION_UNCERTAIN"),
        ({"last_seen_at": NOW - timedelta(days=8)}, "LOCATION_STALE"),
        ({"last_seen_at": NOW + timedelta(seconds=1)}, "LOCATION_STALE"),
        ({"status": "IN_CARE"}, "GARMENT_UNAVAILABLE"),
        ({"retired_at": NOW}, "GARMENT_UNAVAILABLE"),
    ],
)
def test_uncertain_state_cannot_plan(patch, reason):
    garment, locations, body = fixture()
    garment.update(patch)
    assert reason in target_errors(garment, NOW)
    assert execute([garment], locations, body)[0]["proposed_items"] == []


def test_cold_start_neutral_season_and_confirmed_wear_priority():
    garment, locations, body = fixture()
    body.season = "ALL"
    assert execute([garment], locations, body)[0]["status"] == "NO_FEASIBLE_PLAN"
    body.season = "SUMMER"
    assert execute([garment], locations, body, wear={garment["id"]: 2})[0]["status"] == "NO_CHANGE"


@pytest.mark.parametrize("value", [True, 0, -1, 1.5, "1", 10001])
def test_storage_units_are_not_inferred_from_invalid_config(value):
    with pytest.raises(ValueError, match="INVALID_STORAGE_UNITS"):
        units({"attributes": {"storage_units": value}})


def test_environment_hard_constraint_and_missing_measurement():
    garment, locations, body = fixture()
    body.mode = "SPACE_ENVIRONMENT"
    garment["attributes"] = {"storage_constraints": {"max_humidity_pct": 50}}
    env = {
        SOURCE: dict(measured_at=NOW, humidity_pct=70, temperature_c=20),
        DESTINATION: dict(measured_at=NOW, humidity_pct=40, temperature_c=20),
    }
    assert execute([garment], locations, body, env=env)[0]["status"] == "FEASIBLE"
    env[DESTINATION]["measured_at"] = NOW - timedelta(hours=25)
    result, _ = execute([garment], locations, body, env=env)
    assert result["proposed_items"] == []
    assert "ENVIRONMENT_UNMEASURED" in result["blocked"][0]["reasons"]
    env[DESTINATION].update(measured_at=NOW, humidity_pct=float("nan"))
    assert execute([garment], locations, body, env=env)[0]["proposed_items"] == []


def test_profile_and_garment_constraints_intersect_without_invented_material_limits():
    garment, _, _ = fixture()
    garment["attributes"] = {
        "storage_constraints": {
            "allowed_location_types": ["BOX", "WARDROBE"],
            "max_humidity_pct": 60,
        }
    }
    garment["care_constraints"] = {
        "storage": {"allowed_location_types": ["BOX"], "max_humidity_pct": 50}
    }
    assert constraints(garment) == {"allowed_location_types": ["BOX"], "max_humidity_pct": 50}
    garment["care_constraints"]["storage"]["max_humidity_pct"] = float("nan")
    with pytest.raises(ValueError):
        constraints(garment)


def test_missing_capacity_and_unknown_space_diagnosed():
    garment, locations, body = fixture()
    locations[1]["capacity_units"] = None
    result, _ = execute([garment], locations, body)
    assert "CAPACITY_UNMEASURED" in result["blocked"][0]["reasons"]
    locations[1]["capacity_units"] = 5
    locations[1]["attributes"] = {"enabled": False}
    assert execute([garment], locations, body)[0]["proposed_items"] == []
