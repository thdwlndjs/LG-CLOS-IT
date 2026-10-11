from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.poc_vton import UnifiedVtonRequest


def body(slots=("TOP", "BOTTOM"), kinds=("OWNED", "OWNED")):
    return dict(
        client_context_id=uuid4(),
        draft_id="draft",
        draft_revision=0,
        person_asset_id=uuid4(),
        items=[
            dict(kind=k, id=uuid4(), slot=s, expected_asset_id=uuid4())
            for s, k in zip(slots, kinds, strict=True)
        ],
    )


@pytest.mark.parametrize("kinds", [("OWNED", "OWNED"), ("LIKED", "LIKED"), ("OWNED", "LIKED")])
def test_provenance_combinations(kinds):
    assert len(UnifiedVtonRequest(**body(kinds=kinds)).items) == 2


@pytest.mark.parametrize(
    "slots", [("TOP",), ("TOP", "TOP"), ("DRESS", "TOP"), ("BAG", "BOTTOM"), ("HAT", "BOTTOM")]
)
def test_invalid_slots(slots):
    with pytest.raises(ValidationError):
        UnifiedVtonRequest(**body(slots, ("OWNED",) * len(slots)))


def test_dress_and_full_six():
    assert len(UnifiedVtonRequest(**body(("DRESS",), ("LIKED",))).items) == 1
    slots = ("TOP", "BOTTOM", "OUTER", "SHOES", "ACCESSORY")
    assert len(UnifiedVtonRequest(**body(slots, ("OWNED",) * 5)).items) == 5


def test_duplicate_identity_and_position():
    value = body()
    value["items"][1]["id"] = value["items"][0]["id"]
    with pytest.raises(ValidationError):
        UnifiedVtonRequest(**value)
    value["items"][1]["kind"] = "LIKED"
    assert UnifiedVtonRequest(**value)
    value["items"][1]["position"] = 1
    with pytest.raises(ValidationError):
        UnifiedVtonRequest(**value)
