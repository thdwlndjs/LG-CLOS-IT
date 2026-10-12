"""Durable single-attempt grants and append-only FitRoom audit trail."""

from alembic import op

revision = "0006_fitroom_budget"
down_revision = "0005_stage_b_data"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE wardrobe.fitroom_request (
      job_id uuid PRIMARY KEY REFERENCES wardrobe.job(id),
      member_id uuid NOT NULL REFERENCES wardrobe.member(id),
      fingerprint text NOT NULL, mode text NOT NULL CHECK(mode IN ('FIXTURE','LIVE')),
      approved_by text, approved_at timestamptz, expires_at timestamptz,
      consumed_at timestamptz, provider_job_id text,
      credits numeric NOT NULL DEFAULT 1 CHECK(credits=1),
      UNIQUE(member_id,fingerprint,mode),
      CHECK((approved_at IS NULL)=(approved_by IS NULL)))""")
    op.execute("""CREATE TABLE wardrobe.fitroom_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid NOT NULL REFERENCES wardrobe.member(id), job_id uuid,
      action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
      occurred_at timestamptz NOT NULL DEFAULT now())""")


def downgrade():
    op.execute("DROP TABLE wardrobe.fitroom_audit")
    op.execute("DROP TABLE wardrobe.fitroom_request")
