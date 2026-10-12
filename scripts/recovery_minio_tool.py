"""Acquire the official portable Windows binary without installing or starting it."""

import base64
import hashlib
import json
import time
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test-results/recovery-tools/minio-win-v1"
TAG = "RELEASE.2025-04-22T22-12-26Z"
NAME = f"minio.windows-amd64.{TAG}.exe"
BASE = f"https://github.com/minio/minio/releases/download/{TAG}/"
COMMIT = "0d7408fc9969caf07de6a8c3a84f9fbb10a6739e"
PUBLIC_KEY = "RWTx5Zr1tiHQLwG9keckT0c45M3AGeHD6IvimQHpyRywVWGbP1aVSGav"


def main() -> None:
    started = time.monotonic()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    sources = {}

    def download(url: str, name: str) -> Path:
        path = OUTPUT / name
        if path.exists():
            raise RuntimeError("Refuse to overwrite an existing tool artifact")
        with urllib.request.urlopen(url, timeout=15) as response, path.open("xb") as dest:
            while True:
                if time.monotonic() - started > 180:
                    raise TimeoutError("Overall download budget exhausted; no retry")
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                dest.write(chunk)
        sources[name] = url
        return path

    binary = download(BASE + NAME, NAME)
    published = download(BASE + NAME + ".sha256sum", NAME + ".sha256sum")
    signature = download(BASE + NAME + ".minisig", NAME + ".minisig")
    download(BASE + NAME + ".asc", NAME + ".asc")
    key_source = download(
        f"https://raw.githubusercontent.com/minio/minio/{COMMIT}/Dockerfile.release",
        "official-Dockerfile.release",
    )
    if PUBLIC_KEY not in key_source.read_text():
        raise ValueError("Pinned official source does not contain expected public key")
    sha = hashlib.sha256()
    prehashed = hashlib.blake2b(digest_size=64)
    with binary.open("rb") as source:
        while block := source.read(1024 * 1024):
            sha.update(block)
            prehashed.update(block)
    actual = sha.hexdigest()
    if actual != published.read_text().split()[0].lower():
        raise ValueError("Published SHA256 mismatch")
    lines = signature.read_text().splitlines()
    sig = base64.b64decode(lines[1])
    key = base64.b64decode(PUBLIC_KEY)
    if key[:2] != b"Ed" or sig[:2] != b"ED" or key[2:10] != sig[2:10]:
        raise ValueError("Unexpected Minisign algorithm or key ID")
    verifier = Ed25519PublicKey.from_public_bytes(key[10:])
    verifier.verify(sig[10:], prehashed.digest())
    comment = lines[2].removeprefix("trusted comment: ")
    verifier.verify(base64.b64decode(lines[3]), sig[10:] + comment.encode())
    result = {
        "tag": TAG, "commit": COMMIT, "binary": str(binary),
        "bytes": binary.stat().st_size, "sha256": actual,
        "published_sha256_match": True, "minisign_verified": True,
        "signature_method": "Ed25519 Blake2b prehash and global trusted-comment signature",
        "public_key": PUBLIC_KEY, "sources": sources,
        "service_started": False, "global_installation": False,
    }
    (OUTPUT / "verification.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
