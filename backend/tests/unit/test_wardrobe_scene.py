import pytest

from app.application.wardrobe_scene import approved_slot, scene_sprite


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


def test_scene_sprite_requires_same_source_and_accessible_ready_derivative():
    checksum = "a" * 64
    variant = {
        "source_sha256": checksum,
        "asset_id": "atlas",
        "mask": {"width": 1536, "height": 1024, "crop": [192, 0, 192, 700]},
    }
    metadata = {"checksum_sha256": checksum, "scene_sprites": {"hanging": variant}}
    assert scene_sprite(metadata, "hanging", {"atlas": {}}) == variant
    assert scene_sprite(metadata, "folded", {"atlas": {}}) is None
    assert scene_sprite(metadata, "hanging", {}) is None
    assert scene_sprite(dict(metadata, checksum_sha256="b" * 64), "hanging", {"atlas": {}}) is None
    variant["mask"]["crop"] = [1500, 0, 192, 700]
    assert scene_sprite(metadata, "hanging", {"atlas": {}}) is None
    variant["mask"]["crop"] = [0, float("nan"), 192, 700]
    assert scene_sprite(metadata, "hanging", {"atlas": {}}) is None
