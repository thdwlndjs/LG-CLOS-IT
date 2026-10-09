"""Apply the authoritative 30-table SQL baseline in one Alembic transaction."""

from pathlib import Path

from alembic import op

from app.infrastructure.db.sql_scripts import read_transaction_statements

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None
BASELINE_SHA256 = "70bbf42ae0e70157ea90c7c2f8ab1c44a542b0f70d51f0bb67515a0296f09c2e"


def upgrade():
    statements = read_transaction_statements(
        Path(__file__).resolve().parents[1] / "baselines/0001_schema.sql",
        expected_sha256=BASELINE_SHA256,
    )
    for statement in statements:
        op.execute(statement)


def downgrade():
    raise RuntimeError("Baseline downgrade would delete data; restore a reviewed backup instead")
