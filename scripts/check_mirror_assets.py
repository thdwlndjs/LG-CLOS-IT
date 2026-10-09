"""Compare the supplied scene, geometry and visual sources with the live copy."""

import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
reference = root / "docs/integration_sources/SmartCloset_TeamHandoff_20261009_131123_KST_7abae58"
live = root / "web/src/mirror/source"
pairs = [(path, live / path.relative_to(reference / "src"))
         for path in (reference / "src").rglob("*.css")]
pairs += [(reference / "src/PhotoWardrobeStage.tsx", live / "PhotoWardrobeStage.tsx"),
          (reference / "src/data/mirror-geometry.json", live / "data/mirror-geometry.json")]
pairs += [(path, root / "web/public" / path.relative_to(reference / "public"))
          for path in (reference / "public").rglob("*") if path.is_file()]
changed = [str(original.relative_to(reference)) for original, copy in pairs
           if not copy.exists() or hashlib.sha256(original.read_bytes()).digest()
           != hashlib.sha256(copy.read_bytes()).digest()]
evidence = dict(compared_files=len(pairs), changed_visual_files=changed,
                source="supplied team frontend", screenshot_verification="separate browser evidence")
(root / "test-results/mirror-visual-source-evidence.json").write_text(
    json.dumps(evidence, indent=2), encoding="utf-8")
print(json.dumps(evidence))
if changed:
    raise SystemExit("Visual source preservation check failed")
