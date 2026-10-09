from app.domain.recommendations import rank_candidates


def item(identity, category, status="AVAILABLE", care=False, seasons=None, tags=None):
    return dict(
        id=identity,
        category=category,
        status=status,
        special_care=care,
        season_tags=seasons or ["ALL"],
        attributes={"style_tags": tags or []},
    )


def rank(items, **kwargs):
    parameters = dict(
        temperature=18,
        season="SPRING",
        theme=None,
        excluded=set(),
        max_items=6,
        history={},
        preference={},
        limit=5,
    )
    return rank_candidates(items, **{**parameters, **kwargs})


def test_fixed_score_and_stable_tie_order():
    result = rank([item("b", "TOP"), item("a", "TOP"), item("c", "BOTTOM"), item("d", "SHOES")])
    assert [[g["id"] for g in r["items"]] for r in result] == [["a", "c", "d"], ["b", "c", "d"]]
    assert [r["score"] for r in result] == [70, 70]
    assert rank(
        list(reversed([item("a", "TOP"), item("c", "BOTTOM"), item("d", "SHOES")]))
    ) == rank([item("a", "TOP"), item("c", "BOTTOM"), item("d", "SHOES")])


def test_unavailable_and_care_never_recommended():
    for status in ("LAUNDRY", "CARE", "STORED", "UNKNOWN", "IN_USE", "RETIRED"):
        assert rank([item("a", "TOP", status), item("b", "BOTTOM")]) == []
    assert rank([item("a", "TOP", care=True), item("b", "BOTTOM")]) == []
    assert rank([item("a", "TOP"), item("b", "BOTTOM")], excluded={"a"}) == []


def test_history_preference_and_theme_scores_are_explained():
    result = rank(
        [item("a", "TOP", tags=["WORK"]), item("b", "BOTTOM")],
        theme="WORK",
        history={"a": 1},
        preference={"b": 1},
    )
    assert result[0]["score"] == 72  # 50 + season10 + weather10 + theme5 - wear5 + feedback2
    assert any("Confirmed recent wear" in r for r in result[0]["reasons"])
    assert any("Explicit past feedback" in r for r in result[0]["reasons"])


def test_unknown_weather_does_not_invent_temperature_and_dress_is_exclusive():
    result = rank([item("a", "DRESS"), item("b", "OUTER")], temperature=None, season=None)
    assert [g["id"] for g in result[0]["items"]] == ["a"]
    assert result[0]["score"] == 50
    assert not any("temperature" in r for r in result[0]["reasons"])


def test_cold_outer_and_pool_cap():
    result = rank([item("a", "TOP"), item("b", "BOTTOM"), item("c", "OUTER")], temperature=5)
    assert [g["id"] for g in result[0]["items"]] == ["a", "b", "c"]
    result = rank(
        [item(str(i).zfill(3), "TOP") for i in range(30)]
        + [item(str(i + 100).zfill(3), "BOTTOM") for i in range(30)],
        limit=20,
    )
    assert len(result) == 20


def test_accessory_candidates_and_hard_pool_cap():
    result = rank([item("a", "TOP"), item("b", "BOTTOM"), item("c", "ACCESSORY")])
    assert len(result) == 2
    assert any("c" in [g["id"] for g in candidate["items"]] for candidate in result)
    assert (
        len(
            rank(
                [item("a", "TOP"), item("b", "BOTTOM")]
                + [item(str(i).zfill(3), "ACCESSORY") for i in range(250)],
                limit=250,
            )
        )
        == 200
    )
