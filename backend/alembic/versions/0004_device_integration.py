"""Add physical wardrobe access without replacing ownership or legacy scopes."""

from alembic import op

revision = "0004_device_integration"
down_revision = "0003_sprint5_history_care"
branch_labels = None
depends_on = None


def upgrade():
    statements = [
        """CREATE TABLE wardrobe.device (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          household_id uuid NOT NULL REFERENCES wardrobe.household(id),
          name text NOT NULL CHECK(length(btrim(name))>0),
          UNIQUE(id,household_id))""",
        """CREATE TABLE wardrobe.device_member (
          device_id uuid NOT NULL, member_id uuid NOT NULL, household_id uuid NOT NULL,
          PRIMARY KEY(device_id,member_id),
          FOREIGN KEY(device_id,household_id) REFERENCES wardrobe.device(id,household_id),
          FOREIGN KEY(member_id,household_id) REFERENCES wardrobe.member(id,household_id))""",
        """CREATE TABLE wardrobe.account_credential (
          member_id uuid PRIMARY KEY REFERENCES wardrobe.member(id),
          login text NOT NULL UNIQUE CHECK(length(btrim(login))>0),
          password_hash text NOT NULL, enabled boolean NOT NULL DEFAULT true)""",
        """CREATE TABLE wardrobe.access_station (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
          kind text NOT NULL CHECK(kind IN ('HOME','STORE')),
          device_id uuid REFERENCES wardrobe.device(id), credential_hash text NOT NULL,
          enabled boolean NOT NULL DEFAULT true,
          CHECK(kind<>'HOME' OR device_id IS NOT NULL))""",
        "ALTER TABLE wardrobe.garment ADD COLUMN device_id uuid",
        """INSERT INTO wardrobe.device(household_id,name)
          SELECT id,'Existing household wardrobe' FROM wardrobe.household""",
        """INSERT INTO wardrobe.device_member(device_id,member_id,household_id)
          SELECT d.id,m.id,m.household_id FROM wardrobe.member m
          JOIN wardrobe.device d ON d.household_id=m.household_id""",
        """UPDATE wardrobe.garment g SET device_id=d.id
          FROM wardrobe.device d WHERE d.household_id=g.household_id""",
        """ALTER TABLE wardrobe.garment ADD CONSTRAINT garment_device_household_fk
          FOREIGN KEY(device_id,household_id) REFERENCES wardrobe.device(id,household_id)""",
        "CREATE INDEX garment_device_idx ON wardrobe.garment(device_id)",
        """CREATE FUNCTION wardrobe.initial_household_device() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN
            INSERT INTO wardrobe.device(household_id,name) VALUES(NEW.id,'Household wardrobe');
            RETURN NEW; END $$""",
        """CREATE TRIGGER initial_household_device AFTER INSERT ON wardrobe.household
          FOR EACH ROW EXECUTE FUNCTION wardrobe.initial_household_device()""",
        """CREATE FUNCTION wardrobe.initial_member_device() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN
            INSERT INTO wardrobe.device_member(device_id,member_id,household_id)
            SELECT id,NEW.id,NEW.household_id FROM wardrobe.device
            WHERE household_id=NEW.household_id
            AND (SELECT count(*) FROM wardrobe.device WHERE household_id=NEW.household_id)=1;
            RETURN NEW; END $$""",
        """CREATE TRIGGER initial_member_device AFTER INSERT ON wardrobe.member
          FOR EACH ROW EXECUTE FUNCTION wardrobe.initial_member_device()""",
        """CREATE FUNCTION wardrobe.initial_garment_device() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.device_id IS NULL AND
            (SELECT count(*) FROM wardrobe.device WHERE household_id=NEW.household_id)=1 THEN
              SELECT id INTO NEW.device_id FROM wardrobe.device
              WHERE household_id=NEW.household_id;
            END IF; RETURN NEW; END $$""",
        """CREATE TRIGGER initial_garment_device BEFORE INSERT ON wardrobe.garment
          FOR EACH ROW EXECUTE FUNCTION wardrobe.initial_garment_device()""",
        """CREATE TABLE wardrobe.shopping_import (
          member_id uuid NOT NULL REFERENCES wardrobe.member(id),
          provider text NOT NULL CHECK(provider='MOCK'), external_item_id text NOT NULL,
          unit integer NOT NULL CHECK(unit>0),
          garment_id uuid NOT NULL UNIQUE REFERENCES wardrobe.garment(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(member_id,provider,external_item_id,unit))""",
        """CREATE TABLE wardrobe.external_vton_job (
          job_id uuid PRIMARY KEY REFERENCES wardrobe.job(id),
          external_item_id text NOT NULL, provider text NOT NULL CHECK(provider='MOCK'),
          person_asset_id uuid NOT NULL REFERENCES wardrobe.asset(id),
          result_asset_id uuid REFERENCES wardrobe.asset(id))""",
        """CREATE TABLE wardrobe.lighting_zone (
          location_id uuid PRIMARY KEY REFERENCES wardrobe.storage_location(id),
          device_id uuid NOT NULL REFERENCES wardrobe.device(id),
          anchor_id text NOT NULL CHECK(length(btrim(anchor_id))>0),
          UNIQUE(device_id,anchor_id))""",
        """CREATE TABLE wardrobe.led_command (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id uuid NOT NULL REFERENCES wardrobe.member(id),
          station_id uuid NOT NULL REFERENCES wardrobe.access_station(id),
          device_id uuid NOT NULL REFERENCES wardrobe.device(id),
          idempotency_key uuid NOT NULL, fingerprint text NOT NULL,
          anchor_ids text[] NOT NULL, expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(member_id,idempotency_key))""",
    ]
    for statement in statements:
        op.execute(statement)


def downgrade():
    raise RuntimeError("Integration downgrade requires a reviewed data preservation plan")
