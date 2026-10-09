-- Smart Wardrobe Prototype | PostgreSQL 15+ | Physical Schema v1.1
-- Sources: 03_ARCHITECTURE_HLD_v1.1.md, 04_FSD.md, 05_BACKEND_LLD.md, 06_OPENAPI.yaml
-- Run on a NEW dedicated database with a migration owner role. UTC timestamptz; UUID generated server-side.
-- Migration ordering: extensions/types -> tables -> constraints/indexes -> seeds (separate file).
-- IMPORTANT: API IDs are UUID serialized as strings. JSON response DTOs are assembled by application layer.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS wardrobe;
SET LOCAL search_path = wardrobe, public;

CREATE TYPE garment_status AS ENUM ('AVAILABLE','IN_USE','LAUNDRY','CARE','STORED','UNKNOWN','RETIRED');
CREATE TYPE observation_source AS ENUM ('RFID','VISION','SENSOR','MANUAL','MOCK');
CREATE TYPE outfit_status AS ENUM ('DRAFT','SAVED','ARCHIVED');
CREATE TYPE session_status AS ENUM ('CREATED','ACTIVE','ENDED','CANCELLED','EXPIRED');
CREATE TYPE job_status AS ENUM ('QUEUED','RUNNING','SUCCEEDED','READY','FAILED','TIMED_OUT','CANCELLED');
CREATE TYPE storage_action_status AS ENUM ('PROPOSED','APPROVED','REJECTED','IN_PROGRESS','AWAITING_CONFIRMATION','COMPLETED','FAILED','EXPIRED','CANCELLED');
CREATE TYPE storage_item_status AS ENUM ('PENDING','IN_PROGRESS','AWAITING_CONFIRMATION','COMPLETED','FAILED','SKIPPED');
CREATE TYPE care_schedule_status AS ENUM ('SCHEDULED','COMPLETED','CANCELLED','OVERDUE');
CREATE TYPE asset_status AS ENUM ('PENDING_UPLOAD','READY','FAILED','DELETED');
CREATE TYPE outbox_status AS ENUM ('PENDING','PUBLISHED','FAILED');

CREATE TABLE household (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(btrim(name))>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE member (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES household(id),
 display_name text NOT NULL, role text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER','MEMBER','CHILD')),
 external_subject text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,household_id)
);
CREATE TABLE member_settings (
 member_id uuid PRIMARY KEY REFERENCES member(id) ON DELETE CASCADE,
 timezone text NOT NULL DEFAULT 'Asia/Seoul', units text NOT NULL DEFAULT 'METRIC' CHECK (units IN ('METRIC','IMPERIAL')),
 weather_mode text NOT NULL DEFAULT 'MOCK' CHECK (weather_mode IN ('LIVE','MOCK')),
 calendar_enabled boolean NOT NULL DEFAULT false,
 vton_provider text NOT NULL DEFAULT 'MOCK' CHECK (vton_provider IN ('DECART','MOCK')),
 notifications_enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE storage_location (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES household(id),
 parent_location_id uuid, name text NOT NULL, location_type text NOT NULL,
 capacity_units integer CHECK (capacity_units IS NULL OR capacity_units >= 0),
 attributes jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,household_id), FOREIGN KEY (parent_location_id,household_id) REFERENCES storage_location(id,household_id),
 CHECK (parent_location_id IS DISTINCT FROM id)
);
CREATE TABLE asset (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES household(id),
 owner_id uuid, asset_key text NOT NULL UNIQUE, content_type text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('GARMENT','PERSON','VTON_RESULT','CARD','STYLE','OTHER')),
 status asset_status NOT NULL DEFAULT 'PENDING_UPLOAD', byte_size bigint CHECK(byte_size IS NULL OR byte_size >= 0),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz,
 UNIQUE(id,household_id), FOREIGN KEY (owner_id,household_id) REFERENCES member(id,household_id)
);
CREATE TABLE garment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES household(id),
 owner_id uuid NOT NULL, category text NOT NULL, color text NOT NULL, material text,
 name text, image_asset_id uuid, season_tags text[] NOT NULL DEFAULT '{}',
 care_label jsonb NOT NULL DEFAULT '{}'::jsonb, attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), retired_at timestamptz,
 UNIQUE(id,household_id), FOREIGN KEY (owner_id,household_id) REFERENCES member(id,household_id),
 FOREIGN KEY (image_asset_id,household_id) REFERENCES asset(id,household_id)
);
CREATE TABLE garment_tag (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), garment_id uuid NOT NULL REFERENCES garment(id),
 tag_value text NOT NULL UNIQUE, tag_type text NOT NULL DEFAULT 'RFID',
 attached_at timestamptz NOT NULL DEFAULT now(), detached_at timestamptz,
 CHECK(detached_at IS NULL OR detached_at >= attached_at)
);
CREATE TABLE garment_state (
 garment_id uuid PRIMARY KEY REFERENCES garment(id), location_id uuid REFERENCES storage_location(id),
 status garment_status NOT NULL DEFAULT 'UNKNOWN', location_confidence numeric(5,4),
 last_seen_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 CHECK(location_confidence IS NULL OR location_confidence BETWEEN 0 AND 1), CHECK(version>0)
);
CREATE TABLE garment_observation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), garment_id uuid NOT NULL REFERENCES garment(id),
 location_id uuid REFERENCES storage_location(id), sensor_type observation_source NOT NULL,
 confidence numeric(5,4), observed_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 sensor_id text, raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1)
);
CREATE TABLE care_profile (
 garment_id uuid PRIMARY KEY REFERENCES garment(id), special_care boolean NOT NULL DEFAULT false,
 care_group text, care_constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE environment_reading (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id uuid NOT NULL REFERENCES storage_location(id),
 temperature_c numeric(6,2), humidity_pct numeric(5,2), light_lux numeric(10,2),
 measured_at timestamptz NOT NULL, source observation_source NOT NULL DEFAULT 'SENSOR',
 CHECK(humidity_pct IS NULL OR humidity_pct BETWEEN 0 AND 100),
 CHECK(light_lux IS NULL OR light_lux >= 0)
);
CREATE TABLE context_snapshot (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member(id),
 captured_at timestamptz NOT NULL DEFAULT now(), timezone text NOT NULL DEFAULT 'Asia/Seoul',
 weather jsonb NOT NULL DEFAULT '{}'::jsonb, schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
 location_label text, is_holiday boolean, source_mode text NOT NULL DEFAULT 'MOCK',
 CHECK(jsonb_typeof(weather)='object'), CHECK(jsonb_typeof(schedule)='array')
);
CREATE TABLE outfit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member(id),
 title text NOT NULL DEFAULT 'Untitled Look', status outfit_status NOT NULL DEFAULT 'DRAFT',
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,member_id)
);
CREATE TABLE outfit_item (
 outfit_id uuid NOT NULL REFERENCES outfit(id) ON DELETE CASCADE,
 garment_id uuid NOT NULL REFERENCES garment(id), slot text NOT NULL,
 position integer NOT NULL DEFAULT 0 CHECK(position >= 0),
 PRIMARY KEY(outfit_id,garment_id), UNIQUE(outfit_id,slot,position)
);
CREATE TABLE outfit_session (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member(id),
 source_screen text NOT NULL, status session_status NOT NULL DEFAULT 'CREATED',
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 outfit_id uuid REFERENCES outfit(id), context_snapshot_id uuid REFERENCES context_snapshot(id),
 final_outfit_id uuid REFERENCES outfit(id), final_items_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 CHECK(final_items_snapshot IS NULL OR jsonb_typeof(final_items_snapshot)='array')
);
CREATE TABLE outfit_session_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES outfit_session(id),
 event_type text NOT NULL, revision integer NOT NULL CHECK(revision>=0),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,revision,event_type)
);
CREATE TABLE outfit_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES outfit_session(id),
 outfit_id uuid REFERENCES outfit(id), feedback_type text NOT NULL CHECK(feedback_type IN ('ACCEPTED','MODIFIED','REJECTED','RATED')),
 rating smallint CHECK(rating BETWEEN 1 AND 5), changes jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wear_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member(id),
 outfit_id uuid NOT NULL REFERENCES outfit(id), session_id uuid REFERENCES outfit_session(id),
 context_snapshot_id uuid REFERENCES context_snapshot(id), worn_at timestamptz NOT NULL,
 confirmation_method text NOT NULL CHECK(confirmation_method IN ('USER','VERIFIED_SENSOR','ADMIN_MOCK')),
 confirmation_ref text, confirmed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id), CHECK(confirmation_method <> 'VERIFIED_SENSOR' OR confirmation_ref IS NOT NULL)
);
CREATE TABLE style_reference (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member(id),
 source text NOT NULL CHECK(source IN ('INSTAGRAM','SHOPPING','OTHER')),
 source_url text, image_asset_id uuid REFERENCES asset(id), title text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE care_schedule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), garment_id uuid NOT NULL REFERENCES garment(id),
 scheduled_at timestamptz NOT NULL, care_type text NOT NULL,
 status care_schedule_status NOT NULL DEFAULT 'SCHEDULED', notes text,
 created_by uuid REFERENCES member(id), completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status <> 'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE TABLE care_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), garment_id uuid NOT NULL REFERENCES garment(id),
 schedule_id uuid REFERENCES care_schedule(id), performed_by uuid REFERENCES member(id),
 care_type text NOT NULL, performed_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(schedule_id)
);
CREATE TABLE storage_action (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES household(id),
 requested_by uuid, approved_by uuid, action_type text NOT NULL,
 status storage_action_status NOT NULL DEFAULT 'PROPOSED', reasoning jsonb NOT NULL DEFAULT '[]'::jsonb,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz, completed_at timestamptz, expires_at timestamptz,
 UNIQUE(id,household_id), FOREIGN KEY(requested_by,household_id) REFERENCES member(id,household_id),
 FOREIGN KEY(approved_by,household_id) REFERENCES member(id,household_id)
);
CREATE TABLE storage_action_item (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid NOT NULL REFERENCES storage_action(id) ON DELETE CASCADE,
 garment_id uuid NOT NULL REFERENCES garment(id), source_location_id uuid REFERENCES storage_location(id),
 destination_location_id uuid NOT NULL REFERENCES storage_location(id),
 status storage_item_status NOT NULL DEFAULT 'PENDING', confirmed_at timestamptz,
 confirmation_method text, failure_reason text, UNIQUE(action_id,garment_id),
 CHECK(status <> 'COMPLETED' OR confirmed_at IS NOT NULL)
);
CREATE TABLE job (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES household(id),
 member_id uuid REFERENCES member(id), kind text NOT NULL CHECK(kind IN ('VTON','CARD_RENDER','STORAGE_OPTIMIZE','OTHER')),
 status job_status NOT NULL DEFAULT 'QUEUED', progress_pct smallint NOT NULL DEFAULT 0 CHECK(progress_pct BETWEEN 0 AND 100),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0), max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts>0),
 request_payload jsonb NOT NULL DEFAULT '{}'::jsonb, result_ref text, error_code text, error_message_safe text,
 correlation_id text, lease_owner text, leased_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz, finished_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vton_job (
 job_id uuid PRIMARY KEY REFERENCES job(id), session_id uuid NOT NULL REFERENCES outfit_session(id),
 outfit_revision integer NOT NULL CHECK(outfit_revision>=0), provider text NOT NULL CHECK(provider IN ('DECART','MOCK')),
 provider_job_id text, person_asset_id uuid REFERENCES asset(id),
 result_asset_id uuid REFERENCES asset(id), provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(provider,provider_job_id)
);
CREATE TABLE outfit_card (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), outfit_id uuid NOT NULL REFERENCES outfit(id),
 member_id uuid NOT NULL REFERENCES member(id), session_id uuid REFERENCES outfit_session(id),
 template_id text NOT NULL, template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','RENDERING','READY','FAILED','ARCHIVED')),
 image_asset_id uuid REFERENCES asset(id), is_saved boolean NOT NULL DEFAULT false,
 share_token_hash text UNIQUE, share_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(template_data)='object')
);
CREATE TABLE card_render_job (
 job_id uuid PRIMARY KEY REFERENCES job(id), card_id uuid NOT NULL REFERENCES outfit_card(id),
 template_version text, output_width integer NOT NULL DEFAULT 1080 CHECK(output_width>0),
 output_height integer NOT NULL DEFAULT 1350 CHECK(output_height>0), output_format text NOT NULL DEFAULT 'PNG' CHECK(output_format IN ('PNG','WEBP'))
);
CREATE TABLE domain_event_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
 event_type text NOT NULL, schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0),
 household_id uuid REFERENCES household(id), correlation_id text, payload jsonb NOT NULL,
 status outbox_status NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), last_error text,
 CHECK(jsonb_typeof(payload)='object')
);
CREATE TABLE idempotency_key (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES member(id),
 operation text NOT NULL, key_value text NOT NULL, request_hash text NOT NULL,
 response_status integer, response_body jsonb, resource_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 UNIQUE(member_id,operation,key_value), CHECK(expires_at>created_at)
);
CREATE TABLE audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_member_id uuid REFERENCES member(id),
 household_id uuid REFERENCES household(id), action text NOT NULL, target_type text NOT NULL,
 target_id uuid, correlation_id text, details jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Lookup / filter / time-series / worker claim indexes.
CREATE INDEX ix_member_household ON member(household_id);
CREATE INDEX ix_location_household_parent ON storage_location(household_id,parent_location_id);
CREATE INDEX ix_garment_owner_filter ON garment(owner_id,category,color) WHERE retired_at IS NULL;
CREATE INDEX ix_garment_household ON garment(household_id);
CREATE INDEX ix_garment_tag_active ON garment_tag(garment_id) WHERE detached_at IS NULL;
CREATE INDEX ix_garment_state_location ON garment_state(location_id,status);
CREATE INDEX ix_observation_garment_time ON garment_observation(garment_id,observed_at DESC);
CREATE INDEX ix_observation_location_time ON garment_observation(location_id,observed_at DESC);
CREATE INDEX ix_environment_location_time ON environment_reading(location_id,measured_at DESC);
CREATE INDEX ix_context_member_time ON context_snapshot(member_id,captured_at DESC);
CREATE INDEX ix_outfit_member_status ON outfit(member_id,status,created_at DESC);
CREATE INDEX ix_outfit_item_garment ON outfit_item(garment_id);
CREATE INDEX ix_session_member_status ON outfit_session(member_id,status,created_at DESC);
CREATE INDEX ix_session_event_time ON outfit_session_event(session_id,occurred_at);
CREATE INDEX ix_feedback_session ON outfit_feedback(session_id,created_at DESC);
CREATE INDEX ix_wear_member_time ON wear_event(member_id,worn_at DESC);
CREATE INDEX ix_wear_outfit_time ON wear_event(outfit_id,worn_at DESC);
CREATE INDEX ix_style_member_source ON style_reference(member_id,source,created_at DESC);
CREATE INDEX ix_care_due ON care_schedule(scheduled_at) WHERE status='SCHEDULED';
CREATE INDEX ix_care_garment ON care_schedule(garment_id,scheduled_at DESC);
CREATE INDEX ix_storage_action_household_status ON storage_action(household_id,status,created_at DESC);
CREATE INDEX ix_storage_item_action ON storage_action_item(action_id,status);
CREATE INDEX ix_job_claim ON job(next_attempt_at,created_at) WHERE status='QUEUED';
CREATE INDEX ix_job_lease ON job(leased_until) WHERE status='RUNNING';
CREATE INDEX ix_job_member ON job(member_id,created_at DESC);
CREATE INDEX ix_vton_session_revision ON vton_job(session_id,outfit_revision DESC);
CREATE INDEX ix_card_member ON outfit_card(member_id,created_at DESC);
CREATE INDEX ix_card_outfit ON outfit_card(outfit_id);
CREATE INDEX ix_outbox_claim ON domain_event_outbox(next_attempt_at,created_at) WHERE status IN ('PENDING','FAILED');
CREATE INDEX ix_audit_household_time ON audit_log(household_id,occurred_at DESC);
CREATE INDEX ix_asset_household_kind ON asset(household_id,kind,status);

-- Database-level tenant consistency for relationships that already carry household_id.
-- Other cross-entity owner/household invariants require application service checks in one transaction
-- or additional composite-FK migrations before production multi-tenant exposure.
COMMENT ON SCHEMA wardrobe IS 'Smart Wardrobe prototype. Backend enforces household isolation and state transitions; API schemas are DTOs, not table definitions.';
COMMENT ON TABLE outfit_session IS 'Session end records final selection; NOT proof of physical wear.';
COMMENT ON TABLE wear_event IS 'Created only on verified or explicitly user-confirmed wear.';
COMMENT ON TABLE garment_state IS 'Current estimated state derived from immutable observation history.';
COMMENT ON TABLE domain_event_outbox IS 'Insert in the same DB transaction as domain state mutation; dispatcher publishes after commit.';
-- Approved Sprint 1 contract revision 1.1; historical baseline is frozen separately.

ALTER TABLE wardrobe.member_settings ADD COLUMN image_upload_consent boolean NOT NULL DEFAULT false;
ALTER TABLE wardrobe.asset ADD COLUMN upload_expires_at timestamptz;
ALTER TABLE wardrobe.asset ADD COLUMN retention_expires_at timestamptz;
CREATE TABLE consent_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES wardrobe.member(id),
 granted boolean NOT NULL,
 policy_version text NOT NULL DEFAULT 'sprint1-1.1',
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE garment_share (
 garment_id uuid NOT NULL REFERENCES wardrobe.garment(id),
 member_id uuid NOT NULL REFERENCES wardrobe.member(id),
 household_id uuid NOT NULL REFERENCES wardrobe.household(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(garment_id,member_id),
 FOREIGN KEY(garment_id,household_id) REFERENCES wardrobe.garment(id,household_id),
 FOREIGN KEY(member_id,household_id) REFERENCES wardrobe.member(id,household_id)
);

-- Sprint 5 additive history/care contract (migration 0003)

ALTER TABLE wardrobe.wear_event ADD COLUMN items_snapshot jsonb;
ALTER TABLE wardrobe.wear_event ADD COLUMN cancelled_at timestamptz;
ALTER TABLE wardrobe.wear_event ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE wardrobe.wear_event ADD CONSTRAINT ck_wear_snapshot CHECK(items_snapshot IS NULL OR jsonb_typeof(items_snapshot)='array');
ALTER TABLE wardrobe.care_profile ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE wardrobe.care_schedule ADD COLUMN recurrence_days integer CHECK(recurrence_days BETWEEN 1 AND 365);
ALTER TABLE wardrobe.care_schedule ADD COLUMN recurrence_timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE wardrobe.care_schedule ADD COLUMN next_schedule_id uuid REFERENCES wardrobe.care_schedule(id);
ALTER TABLE wardrobe.care_schedule ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE wardrobe.care_event ADD COLUMN outcome text NOT NULL DEFAULT 'SUCCESS' CHECK(outcome IN ('SUCCESS','NOT_DONE'));
ALTER TABLE wardrobe.care_event ADD COLUMN cancelled_at timestamptz;
ALTER TABLE wardrobe.care_event DROP CONSTRAINT care_event_schedule_id_key;
CREATE UNIQUE INDEX ux_care_success ON wardrobe.care_event(schedule_id) WHERE outcome='SUCCESS' AND cancelled_at IS NULL;
CREATE UNIQUE INDEX ux_care_active_slot ON wardrobe.care_schedule(garment_id,care_type,scheduled_at) WHERE status='SCHEDULED';

COMMIT;
