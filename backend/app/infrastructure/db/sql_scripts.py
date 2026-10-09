import hashlib
import re
from pathlib import Path

TOKEN = re.compile(
    r"--[^\n]*(?:\n|$)|/\*.*?\*/|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\""
    r"|(?P<dollar>\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$).*?(?P=dollar)|;|[^'\";$-]+|.",
    re.DOTALL,
)


def read_transaction_statements(path: Path, expected_sha256: str | None = None) -> list[str]:
    content = path.read_bytes()
    if expected_sha256 and hashlib.sha256(content).hexdigest() != expected_sha256:
        raise RuntimeError("Baseline SQL changed; create a new reviewed migration")
    statements, parts = [], []
    for match in TOKEN.finditer(content.decode("utf-8-sig")):
        token = match.group()
        if token.startswith(("--", "/*")):
            parts.append(" ")
        elif token == ";":
            statement = "".join(parts).strip()
            if statement:
                statements.append(statement)
            parts = []
        else:
            parts.append(token)
    if "".join(parts).strip():
        raise ValueError("SQL script must terminate every statement with a semicolon")
    if not statements or statements[0].upper() != "BEGIN" or statements[-1].upper() != "COMMIT":
        raise ValueError("Expected a BEGIN/COMMIT wrapped SQL script")
    # Alembic/SQLAlchemy own the transaction; no embedded COMMIT may escape it.
    result = statements[1:-1]
    if any(s.upper() in {"BEGIN", "COMMIT", "ROLLBACK"} for s in result):
        raise ValueError("Nested transaction control is not supported")
    return result

