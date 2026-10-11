"""Add demo interests and item display bindings without modifying owned records."""

from alembic import op

revision = "0005_stage_b_data"
down_revision = "0004_device_integration"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE wardrobe.liked_item (
      id uuid PRIMARY KEY, household_id uuid NOT NULL REFERENCES wardrobe.household(id),
      member_id uuid NOT NULL REFERENCES wardrobe.member(id), product_id text NOT NULL,
      name text NOT NULL, category text NOT NULL, color text NOT NULL,
      image_asset_id uuid NOT NULL REFERENCES wardrobe.asset(id), metadata jsonb NOT NULL,
      UNIQUE(member_id,product_id))""")
    op.execute("""CREATE TABLE wardrobe.scene_placement (
      garment_id uuid PRIMARY KEY REFERENCES wardrobe.garment(id),
      source_location_id uuid NOT NULL REFERENCES wardrobe.storage_location(id),
      compartment_id uuid NOT NULL REFERENCES wardrobe.storage_location(id),
      geometry jsonb NOT NULL, namespace text NOT NULL)""")


def downgrade():
    op.execute("DROP TABLE wardrobe.scene_placement")
    op.execute("DROP TABLE wardrobe.liked_item")
