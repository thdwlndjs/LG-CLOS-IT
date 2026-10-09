"""Bounded, deterministic rule engine. No LLM, inference of wear, or provider calls."""

from itertools import chain, product

RULE_VERSION = "sprint2-rules-v1"
SLOTS = ("TOP", "BOTTOM", "DRESS", "SHOES", "OUTER", "ACCESSORY")


def rank_candidates(
    garments, *, temperature, season, theme, excluded, max_items, history, preference, limit
):
    groups = {slot: [] for slot in SLOTS}
    for garment in sorted(garments, key=lambda g: str(g["id"])):
        if (
            garment["status"] != "AVAILABLE"
            or garment.get("special_care")
            or str(garment["id"]) in excluded
            or garment["category"] not in groups
        ):
            continue
        groups[garment["category"]].append(garment)
    bases = chain(product(groups["TOP"], groups["BOTTOM"]), ((g,) for g in groups["DRESS"]))
    raw = []
    # The pool cap limits combinatorial cost. The stable ID order is part of the policy.
    for base in bases:
        for shoes in groups["SHOES"] or [None]:
            for outer in (
                [None] + groups["OUTER"] if temperature is not None and temperature < 15 else [None]
            ):
                for accessory in [None] + groups["ACCESSORY"]:
                    items = (
                        list(base)
                        + ([shoes] if shoes else [])
                        + ([outer] if outer else [])
                        + ([accessory] if accessory else [])
                    )
                    if len(items) > max_items:
                        continue
                    score = 50.0
                    reasons = ["Available accessible garments", "Rule-based cold-start baseline"]
                    if season:
                        fit = sum(
                            season in g["season_tags"] or "ALL" in g["season_tags"] for g in items
                        )
                        score += 10 * fit / len(items)
                        reasons.append(f"Explicit season fit: {fit}/{len(items)}")
                    if temperature is not None:
                        score += 10 if (temperature >= 15 or outer) else 0
                        reasons.append(f"Snapshot temperature: {temperature:g} C")
                    if theme:
                        fit = sum(
                            theme in g.get("attributes", {}).get("style_tags", []) for g in items
                        )
                        score += 10 * fit / len(items)
                        reasons.append(f"Explicit theme {theme} match: {fit}/{len(items)}")
                    recent = sum(history.get(str(g["id"]), 0) for g in items)
                    positive = sum(preference.get(str(g["id"]), 0) for g in items)
                    score += max(-10, min(10, positive * 2)) - min(20, recent * 5)
                    if recent:
                        reasons.append(f"Confirmed recent wear penalty: {recent}")
                    if positive:
                        reasons.append(f"Explicit past feedback: {positive}")
                    raw.append(dict(items=items, score=round(score, 4), reasons=reasons))
                    if len(raw) == 200:
                        break
                if len(raw) == 200:
                    break
            if len(raw) == 200:
                break
        if len(raw) == 200:
            break
    selected = []
    while raw and len(selected) < limit:

        def key(candidate):
            ids = {str(g["id"]) for g in candidate["items"]}
            overlap = max(
                (len(ids & {str(g["id"]) for g in s["items"]}) / len(ids) for s in selected),
                default=0,
            )
            return -(candidate["score"] - overlap * 10), tuple(sorted(ids))

        winner = min(raw, key=key)
        raw.remove(winner)
        winner["reasons"].append(f"Stable diversity selection; {RULE_VERSION}")
        selected.append(winner)
    return selected
