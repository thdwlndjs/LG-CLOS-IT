"""Wear snapshots and reversible care history without destructive backfill."""

from alembic import op

revision = "0003_sprint5_history_care"
down_revision = "0002_sprint1_contract"
branch_labels = None
depends_on = None

SQL = (
    "\nALTER TABLE wardrobe.wear_event ADD COLUMN items_snapshot jsonb;"
    "\nALTER TABLE wardrobe.wear_event ADD COLUMN cancelled_at "
    "timestamptz;\nALTER TABLE wardrobe.wear_event ADD COLUMN version "
    "integer NOT NULL DEFAULT 1 CHECK(version>0);\nALTER TABLE "
    "wardrobe.wear_event ADD CONSTRAINT ck_wear_snapshot "
    "CHECK(items_snapshot IS NULL OR "
    "jsonb_typeof(items_snapshot)='array');\nALTER TABLE "
    "wardrobe.care_profile ADD COLUMN version integer NOT NULL DEFAULT"
    " 1 CHECK(version>0);\nALTER TABLE wardrobe.care_schedule ADD "
    "COLUMN recurrence_days integer CHECK(recurrence_days BETWEEN 1 "
    "AND 365);\nALTER TABLE wardrobe.care_schedule ADD COLUMN "
    "recurrence_timezone text NOT NULL DEFAULT 'UTC';\nALTER TABLE "
    "wardrobe.care_schedule ADD COLUMN next_schedule_id uuid "
    "REFERENCES wardrobe.care_schedule(id);\nALTER TABLE "
    "wardrobe.care_schedule ADD COLUMN version integer NOT NULL "
    "DEFAULT 1 CHECK(version>0);\nALTER TABLE wardrobe.care_event ADD "
    "COLUMN outcome text NOT NULL DEFAULT 'SUCCESS' CHECK(outcome IN "
    "('SUCCESS','NOT_DONE'));\nALTER TABLE wardrobe.care_event ADD "
    "COLUMN cancelled_at timestamptz;\nALTER TABLE wardrobe.care_event "
    "DROP CONSTRAINT care_event_schedule_id_key;\nCREATE UNIQUE INDEX "
    "ux_care_success ON wardrobe.care_event(schedule_id) WHERE "
    "outcome='SUCCESS' AND cancelled_at IS NULL;\nCREATE UNIQUE INDEX "
    "ux_care_active_slot ON "
    "wardrobe.care_schedule(garment_id,care_type,scheduled_at) WHERE "
    "status='SCHEDULED';\n"
)


def upgrade():
    # Fail clearly rather than silently merging pre-existing duplicate schedules.
    for statement in SQL.split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade():
    raise RuntimeError("History must be preserved; use a reviewed forward migration")
