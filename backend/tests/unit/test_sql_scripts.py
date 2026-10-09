import hashlib
import re

import pytest

from app.core.paths import DOCS_DIR
from app.infrastructure.db.sql_scripts import read_transaction_statements


def test_baseline_has_all_original_objects_and_no_embedded_commit():
    path = DOCS_DIR / "07_DATABASE_SCHEMA.sql"
    statements = read_transaction_statements(path)
    assert len([s for s in statements if s.startswith("CREATE TABLE ")]) == 32
    assert len([s for s in statements if s.startswith("CREATE TYPE ")]) == 10
    assert "SET LOCAL search_path = wardrobe, public" in statements
    assert not any(s in {"BEGIN", "COMMIT"} for s in statements)
    original = set(re.findall(r"CREATE TABLE (\w+)", path.read_text()))
    parsed = {re.match(r"CREATE TABLE (\w+)", s)[1] for s in statements
              if s.startswith("CREATE TABLE")}
    assert parsed == original


def test_seed_keeps_idempotency_and_never_creates_wear_records():
    statements = read_transaction_statements(DOCS_DIR / "07_DATABASE_SEED.sql")
    inserts = [s for s in statements if s.startswith("INSERT INTO")]
    assert inserts and all("ON CONFLICT" in s for s in inserts)
    assert not any("INSERT INTO wear_event" in s for s in inserts)


def test_parser_preserves_quoted_semicolons_comments_and_dollar_blocks(tmp_path):
    path = tmp_path / "quoted.sql"
    path.write_text("BEGIN; -- comment;\n SELECT 'it''s;a', $$b;c$$, \"semi;colon\"; COMMIT;",
                    encoding="utf-8")
    statements = read_transaction_statements(path)
    assert statements == ["SELECT 'it''s;a', $$b;c$$, \"semi;colon\""]


def test_baseline_hash_guard(tmp_path):
    path = tmp_path / "baseline.sql"
    path.write_text("BEGIN; SELECT 1; COMMIT;", encoding="utf-8")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert read_transaction_statements(path, digest) == ["SELECT 1"]
    path.write_text("BEGIN; SELECT 2; COMMIT;", encoding="utf-8")
    with pytest.raises(RuntimeError, match="Baseline SQL changed"):
        read_transaction_statements(path, digest)


@pytest.mark.parametrize("sql", [
    "SELECT 1;", "BEGIN; SELECT 1", "BEGIN; COMMIT; SELECT 1; COMMIT;"
])
def test_parser_refuses_unmanaged_transactions(tmp_path, sql):
    path = tmp_path / "invalid.sql"
    path.write_text(sql, encoding="utf-8")
    with pytest.raises(ValueError):
        read_transaction_statements(path)
