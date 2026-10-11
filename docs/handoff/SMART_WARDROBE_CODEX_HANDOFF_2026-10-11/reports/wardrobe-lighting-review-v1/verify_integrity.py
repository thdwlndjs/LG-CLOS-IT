"""Read-only PNG comparisons, not an image editor or visual quality score."""
import hashlib
import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
spec = json.loads((HERE / "lighting.json").read_text(encoding="utf-8"))
base_path = (HERE / spec["base"]).resolve()
base = Image.open(base_path).convert("RGB")
assert base.size == (spec["width"], spec["height"])
assert Image.open(HERE / "baseline.png").convert("RGB").tobytes() == base.tobytes()
for name in ("auto-off.png", "unknown-location.png"):
    assert Image.open(HERE / name).convert("RGB").tobytes() == base.tobytes()


def brightness(image, bounds):
    x, y, width, height = bounds
    pixels = image.load()
    values = [
        0.2126 * pixels[i, j][0]
        + 0.7152 * pixels[i, j][1]
        + 0.0722 * pixels[i, j][2]
        for j in range(y, y + height)
        for i in range(x, x + width)
    ]
    return round(sum(values) / len(values), 4)


def contains(bounds, x, y):
    bx, by, width, height = bounds
    return bx <= x < bx + width and by <= y < by + height


checks = []
for variant in spec["variants"]:
    selected = Image.open(HERE / (variant["id"] + "-selected.png")).convert("RGB")
    assert selected.size == base.size
    before = brightness(base, variant["detail"])
    after = brightness(selected, variant["detail"])
    assert after > before, f"{variant['id']} surface did not brighten"
    neighbor = None
    if "sector_bounds" in variant:
        neighbor_before = brightness(base, variant["neighbor_bounds"])
        neighbor_after = brightness(selected, variant["neighbor_bounds"])
        assert neighbor_after < neighbor_before, "Same-rail neighbor was illuminated"
        silhouette = Image.open(HERE / (variant["id"] + "-silhouette-mask.png")).convert("RGBA")
        alpha = silhouette.getchannel("A").load()
        sector_part = next(p for p in spec["compartments"] if p["id"] == variant["id"])
        px, py, pw, ph = sector_part["bounds"]
        bp, sp = base.load(), selected.load()
        bright_outside_sector = sum(
            sum(sp[x, y]) > sum(bp[x, y])
            for y in range(py, py + ph)
            for x in range(px, px + pw)
            if alpha[x, y] == 0
        )
        assert bright_outside_sector == 0, "Brightened outside garment/hanger silhouette"
        hanger_probe = (264, 146, 3, 8) if variant["id"] == "A" else (515, 146, 4, 8)
        hanger_before = brightness(base, hanger_probe)
        hanger_after = brightness(selected, hanger_probe)
        assert hanger_after > hanger_before, "Selected hanger did not brighten"
        neighbor = {
            "same_rail_neighbor_luminance_before": neighbor_before,
            "same_rail_neighbor_luminance_after": neighbor_after,
            "brightened_pixels_outside_selected_sector": bright_outside_sector,
            "mask_type": "cloth silhouette + wooden hanger + metal hook",
            "hanger_luminance_before": hanger_before,
            "hanger_luminance_after": hanger_after,
        }
    dimmed = []
    for part in spec["compartments"]:
        if part["id"] != variant["id"]:
            mean_before = brightness(base, part["bounds"])
            mean_after = brightness(selected, part["bounds"])
            assert mean_after < mean_before, f"{part['id']} did not dim"
            dimmed.append(part["id"])
    a, b = base.load(), selected.load()
    outside = sum(
        a[x, y] != b[x, y]
        for y in range(base.height)
        for x in range(base.width)
        if not any(contains(part["bounds"], x, y) for part in spec["compartments"])
    )
    assert outside == 0, "Changed cabinet frame, mirror, floor or outside compartment"
    checks.append(
        {
            "selected": variant["id"],
            "cloth_mean_luminance_before": before,
            "cloth_mean_luminance_after": after,
            "hanger_sector_check": neighbor,
            "unselected_compartments_dimmed": dimmed,
            "outside_compartments_changed_pixels": outside,
        }
    )
result = {
    "status": "PASS",
    "approved_base_sha256": hashlib.sha256(base_path.read_bytes()).hexdigest(),
    "checks": checks,
    "auto_off_and_unknown_restore_approved_base_exactly": True,
    "generated_sha256": {
        v["id"]: hashlib.sha256((HERE / v["file"]).read_bytes()).hexdigest()
        for v in spec["variants"]
    },
    "limitation": "Mean PNG luminance checks only, not lux, physical fabric fidelity, product-level E2E, or user visual approval.",
}
(HERE / "integrity.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(result, ensure_ascii=False))
