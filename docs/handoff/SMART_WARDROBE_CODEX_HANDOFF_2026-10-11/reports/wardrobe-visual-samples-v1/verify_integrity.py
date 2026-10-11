"""Read-only sample integrity checks; never edits raster images."""
import hashlib
import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE / "samples.json").read_text(encoding="utf-8"))
base = Image.open(HERE / "original-browser.png").convert("RGB")
result = Image.open(HERE / "wardrobe-composite.png").convert("RGB")
assert base.size == result.size == (1672, 941)
a, b = base.load(), result.load()
bounds = [s["bounds"] for s in manifest["samples"]]
outside_changes = 0
region_changes = {s["id"]: 0 for s in manifest["samples"]}
for y in range(941):
    for x in range(1672):
        if a[x, y] == b[x, y]:
            continue
        matching = [
            s["id"]
            for s in manifest["samples"]
            if s["bounds"][0] <= x < s["bounds"][0] + s["bounds"][2]
            and s["bounds"][1] <= y < s["bounds"][1] + s["bounds"][3]
        ]
        if not matching:
            outside_changes += 1
        for sample_id in matching:
            region_changes[sample_id] += 1
assert outside_changes == 0
assert all(n > 0 for n in region_changes.values())
reference = (HERE / manifest["reference"]).resolve()
reference_sha256 = hashlib.sha256(reference.read_bytes()).hexdigest()
assert reference_sha256 == "abc5cdf750a55f8054ddf1c8d77875d3c99d2006ebeffc2e211f169dbd521a26"
hashes = {
    s["id"]: hashlib.sha256((HERE / s["file"]).read_bytes()).hexdigest()
    for s in manifest["samples"]
}
output = {
    "status": "PASS",
    "reference_sha256": reference_sha256,
    "changed_pixels_outside_six_regions": outside_changes,
    "changed_pixels_by_region": region_changes,
    "generated_file_sha256": hashes,
    "limitations": "Position-specific rectangular patches; excludes neither every neighboring cloth pixel inside each region nor UI composite. No claim of isolated alpha assets or human visual approval.",
}
(HERE / "integrity.json").write_text(
    json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(output, ensure_ascii=False))
