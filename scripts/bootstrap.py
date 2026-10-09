"""Create a private local .env without overwriting an existing configuration."""
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    path = ROOT / ".env"
    if path.exists():
        print("Existing .env preserved")
        return
    example = (ROOT / "infra/env.example").read_text(encoding="utf-8")
    replacements = {
        "CHANGE_ME_DB_PASSWORD": secrets.token_hex(24),
        "CHANGE_ME_STORAGE_ACCESS": "wardrobe_" + secrets.token_hex(8),
        "CHANGE_ME_STORAGE_SECRET": secrets.token_hex(24),
        "CHANGE_ME_MIN_32_CHARS": secrets.token_hex(32),
    }
    for placeholder, value in replacements.items():
        example = example.replace(placeholder, value)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(example)
    print("Created private .env; credentials were not printed")


if __name__ == "__main__":
    main()

