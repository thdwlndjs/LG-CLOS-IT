import pytest

from app.application.wardrobe_scene import approved_slot


@pytest.mark.parametrize(
    "patch",
    [
        {"approved": False},
        {"x": float("nan")},
        {"x": True},
        {"width": 0},
        {"x": 0.9},
        {"z_index": -1},
    ],
)
def test_unapproved_or_invalid_geometry_cannot_render(patch):
    assert (
        approved_slot(
            {
                "display_slot": {
                    "approved": True,
                    "x": 0.1,
                    "y": 0.2,
                    "width": 0.2,
                    "height": 0.3,
                    **patch,
                }
            }
        )
        is None
    )


def test_explicit_slot_only_no_inference():
    assert approved_slot({"name": "trench", "x": 0.1}) is None
    assert (
        approved_slot(
            {"display_slot": {"approved": True, "x": 0.1, "y": 0.2, "width": 0.2, "height": 0.3}}
        )["z_index"]
        == 0
    )
