"""Versioned deterministic rules; no physical movement or invented sensor values."""

import math
from datetime import timedelta

RULES_VERSION = "storage-greedy-v1"
MIN_CONFIDENCE = 0.8
STATE_MAX_AGE = timedelta(days=7)
ENV_MAX_AGE = timedelta(hours=24)


def units(garment):
    if not isinstance(garment["attributes"], dict):
        raise ValueError("INVALID_STORAGE_UNITS")
    value = garment["attributes"].get("storage_units", 1)
    if type(value) is not int or not 1 <= value <= 10000:
        raise ValueError("INVALID_STORAGE_UNITS")
    return value


def constraints(garment):
    if not isinstance(garment["attributes"], dict) or not isinstance(
        garment.get("care_constraints", {}), dict
    ):
        raise ValueError("INVALID_STORAGE_CONSTRAINTS")
    result = {}
    for raw in (
        garment["attributes"].get("storage_constraints", {}),
        garment.get("care_constraints", {}).get("storage", {}),
    ):
        if not isinstance(raw, dict) or set(raw) - {
            "allowed_location_types",
            "max_humidity_pct",
            "min_temperature_c",
            "max_temperature_c",
        }:
            raise ValueError("INVALID_STORAGE_CONSTRAINTS")
        for name, value in raw.items():
            if name == "allowed_location_types":
                if (
                    not isinstance(value, list)
                    or not value
                    or any(not isinstance(x, str) or not x for x in value)
                ):
                    raise ValueError("INVALID_STORAGE_CONSTRAINTS")
                result[name] = sorted(set(value) & set(result.get(name, value)))
                continue
            if type(value) not in (float, int) or not math.isfinite(value):
                raise ValueError("INVALID_STORAGE_CONSTRAINTS")
            if name == "max_humidity_pct" and not 0 <= value <= 100:
                raise ValueError("INVALID_STORAGE_CONSTRAINTS")
            if name in result:
                value = (
                    max(value, result[name])
                    if name == "min_temperature_c"
                    else min(value, result[name])
                )
            result[name] = value
    if result.get("min_temperature_c", -math.inf) > result.get("max_temperature_c", math.inf):
        raise ValueError("CONFLICTING_STORAGE_CONSTRAINTS")
    return result


def location_tier(location):
    raw = location["attributes"]
    if not isinstance(raw, dict):
        return None
    if type(raw.get("enabled", True)) is not bool or not raw.get("enabled", True):
        return None
    value = raw.get(
        "accessibility", {"WARDROBE": "ACCESSIBLE", "BOX": "ARCHIVE"}.get(location["location_type"])
    )
    return value if value in ("ACCESSIBLE", "ARCHIVE") else None


def placement_errors(garment, location, occupied, environment, now, mode, extra_units=0):
    errors = []
    capacity = location["capacity_units"]
    if location_tier(location) is None:
        errors.append("SPACE_UNAVAILABLE")
    if capacity is None:
        errors.append("CAPACITY_UNMEASURED")
    elif occupied is None:
        errors.append("OCCUPANCY_UNCERTAIN")
    elif occupied + extra_units > capacity:
        errors.append("CAPACITY_EXCEEDED")
    try:
        rules = constraints(garment)
    except ValueError as error:
        return errors + [str(error)]
    allowed = rules.get("allowed_location_types")
    if allowed is not None and location["location_type"] not in allowed:
        errors.append("LOCATION_TYPE_FORBIDDEN")
    needs_environment = mode == "SPACE_ENVIRONMENT" or any(
        k != "allowed_location_types" for k in rules
    )
    fresh = environment is not None and now - ENV_MAX_AGE <= environment["measured_at"] <= now
    if needs_environment and not fresh:
        errors.append("ENVIRONMENT_UNMEASURED")
    elif fresh:
        for name, field, operation in (
            ("max_humidity_pct", "humidity_pct", lambda value, bound: value > bound),
            ("min_temperature_c", "temperature_c", lambda value, bound: value < bound),
            ("max_temperature_c", "temperature_c", lambda value, bound: value > bound),
        ):
            if name in rules:
                value = environment[field]
                if value is None or not math.isfinite(value):
                    errors.append("ENVIRONMENT_UNMEASURED")
                elif operation(value, rules[name]):
                    errors.append(name.upper() + "_VIOLATED")
        if mode == "SPACE_ENVIRONMENT" and (
            any(
                environment[field] is None or not math.isfinite(environment[field])
                for field in ("humidity_pct", "temperature_c")
            )
        ):
            errors.append("ENVIRONMENT_UNMEASURED")
    return sorted(set(errors))


def target_errors(garment, now):
    if garment["retired_at"] or garment["status"] not in ("AVAILABLE", "STORED"):
        return ["GARMENT_UNAVAILABLE"]
    if (
        not garment["location_id"]
        or garment["location_confidence"] is None
        or garment["location_confidence"] < MIN_CONFIDENCE
    ):
        return ["LOCATION_UNCERTAIN"]
    if not garment["last_seen_at"] or not now - STATE_MAX_AGE <= garment["last_seen_at"] <= now:
        return ["LOCATION_STALE"]
    try:
        units(garment)
        constraints(garment)
    except ValueError as error:
        return [str(error)]
    return []


def plan(garments, locations, occupancy, environments, wear, body, now):
    moves = []
    blocked = []
    snapshots = {}
    location_map = {location["id"]: location for location in locations}
    reserved = dict(occupancy)
    for garment in sorted(garments, key=lambda g: str(g["id"])):
        identity = garment["id"]
        errors = target_errors(garment, now)
        source = location_map.get(garment["location_id"])
        if source is None:
            errors.append("SOURCE_SPACE_UNKNOWN")
        if errors:
            blocked.append(dict(garment_id=str(identity), reasons=sorted(set(errors))))
            continue
        count = wear.get(identity, 0)
        tags = garment["season_tags"]
        if body.mode == "WEAR_PATTERN" and body.season == "ALL" and count == 0:
            blocked.append(dict(garment_id=str(identity), reasons=["INSUFFICIENT_WEAR_HISTORY"]))
            continue
        desired = (
            "ACCESSIBLE"
            if count >= 2 or not tags or "ALL" in tags or body.season in tags
            else "ARCHIVE"
        )
        reasons = [f"CONFIRMED_WEAR_COUNT:{count}", f"REQUESTED_SEASON:{body.season}"]
        if count == 0:
            reasons.append("INSUFFICIENT_WEAR_HISTORY")
        size = units(garment)

        def score(location, garment=garment, desired=desired):
            failures = placement_errors(
                garment,
                location,
                reserved.get(location["id"]),
                environments.get(location["id"]),
                now,
                body.mode,
            )
            if failures:
                return -100.0
            if body.mode == "WEAR_PATTERN":
                return 100.0 if location_tier(location) == desired else 0.0
            return 0.0

        current = score(source)
        candidates = []
        violations = set()
        for location in locations:
            if location["id"] == source["id"]:
                continue
            errors = placement_errors(
                garment,
                location,
                reserved.get(location["id"]),
                environments.get(location["id"]),
                now,
                body.mode,
                size,
            )
            if errors:
                violations.update(errors)
                continue
            benefit = score(location) - current - 10.0
            if benefit > 0:
                candidates.append((benefit, str(location["id"]), location))
        if not candidates:
            current_errors = placement_errors(
                garment,
                source,
                reserved.get(source["id"]),
                environments.get(source["id"]),
                now,
                body.mode,
            )
            wrong_tier = body.mode == "WEAR_PATTERN" and location_tier(source) != desired
            if current_errors or wrong_tier:
                blocked.append(
                    dict(
                        garment_id=str(identity),
                        reasons=sorted(
                            set(current_errors) | violations | {"NO_FEASIBLE_DESTINATION"}
                        ),
                    )
                )
            continue
        benefit, _, destination = sorted(candidates, key=lambda item: (-item[0], item[1]))[0]
        reserved[destination["id"]] += size
        # Never credit an unconfirmed departure to another move's available space.
        move = dict(
            garment_id=str(identity),
            source_location_id=str(source["id"]),
            destination_location_id=str(destination["id"]),
            score=benefit,
            reasons=reasons + ["HARD_CONSTRAINTS_SATISFIED", "MOVEMENT_COST:10"],
        )
        moves.append(move)
        snapshots[str(identity)] = dict(
            garment_version=garment["version"],
            state_version=garment["state_version"],
            profile_version=garment["profile_version"],
            storage_units=size,
            source_location_id=str(source["id"]),
            score=benefit,
            reasons=move["reasons"],
        )
    status = (
        "PARTIAL"
        if moves and blocked
        else "FEASIBLE"
        if moves
        else "NO_FEASIBLE_PLAN"
        if blocked or not garments
        else "NO_CHANGE"
    )
    return dict(
        status=status,
        feasible=status != "NO_FEASIBLE_PLAN",
        dry_run=body.dry_run,
        rules_version=RULES_VERSION,
        snapshot_at=now.isoformat(),
        action_ids=[],
        proposed_items=moves,
        blocked=blocked,
        diagnostics=[status],
    ), snapshots
