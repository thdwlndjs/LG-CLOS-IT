"""Approved Sprint 1 consent, sharing and asset retention contract."""

from alembic import op

revision = "0002_sprint1_contract"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

SQL = """
ALTER TABLE wardrobe.member_settings ADD COLUMN image_upload_consent boolean NOT NULL DEFAULT false;
ALTER TABLE wardrobe.asset ADD COLUMN upload_expires_at timestamptz;
ALTER TABLE wardrobe.asset ADD COLUMN retention_expires_at timestamptz;
CREATE TABLE wardrobe.consent_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES wardrobe.member(id),
 granted boolean NOT NULL,
 policy_version text NOT NULL DEFAULT 'sprint1-1.1',
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wardrobe.garment_share (
 garment_id uuid NOT NULL REFERENCES wardrobe.garment(id),
 member_id uuid NOT NULL REFERENCES wardrobe.member(id),
 household_id uuid NOT NULL REFERENCES wardrobe.household(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(garment_id,member_id),
 FOREIGN KEY(garment_id,household_id) REFERENCES wardrobe.garment(id,household_id),
 FOREIGN KEY(member_id,household_id) REFERENCES wardrobe.member(id,household_id)
);
"""


def upgrade():
    for statement in SQL.split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade():
    raise RuntimeError("Consent history must be preserved; use a reviewed forward migration")
