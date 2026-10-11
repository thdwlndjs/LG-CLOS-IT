"""Register an imagegen atlas as an explicitly generated local derivative."""

import hashlib
import json
import shutil
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11"


def main():
    batch, raw = sys.argv[1:]
    manifest_path = PACKAGE / "templates/wardrobe_sprite_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    row = next(r for r in manifest["batches"] if r["batch"] == batch)
    source = Path(raw).resolve()
    generated = (Path.home() / ".codex/generated_images").resolve()
    if not source.is_relative_to(generated):
        raise RuntimeError("Not built-in generated image output")
    with Image.open(source) as image:
        if image.size != (1536, 1024) or "A" not in image.getbands():
            raise RuntimeError("Atlas dimensions/transparency incorrect")
        alpha = image.getchannel("A")
        if alpha.getextrema()[0] != 0:
            raise RuntimeError("No transparent pixels")
    destination = ROOT / "assets/wardrobe-scene-sprites" / f"{batch}-v1.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise RuntimeError("Preserve existing derivative; choose a new version")
    shutil.copyfile(source, destination)
    row.update(
        status="GENERATED_REVIEW_PENDING",
        local_atlas=destination.relative_to(ROOT).as_posix(),
        atlas_sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
        generation_tool="built-in image_gen",
        generation_source=str(source),
        source_rasters_modified=False,
    )
    for i, item in enumerate(row["items"]):
        item["cells"] = {
            "hanging": [i * 192, 0, 192, 512],
            "folded": [i * 192, 512, 192, 512],
        }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        f"{batch}: generated atlas preserved, {len(row['items'])} mappings pending visual review"
    )


if __name__ == "__main__":
    main()
