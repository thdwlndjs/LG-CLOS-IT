-- SmartCloset additive schema. Apply only after the sc_* namespace preflight succeeds.
-- Target: slxgcgtnxkchxywgsmuk. No user creation, credentials, destructive reset, or live approvals.
begin;
create schema if not exists sc_private;
revoke all on schema sc_private from public, anon;
grant usage on schema sc_private to authenticated, service_role;

create table public.sc_profiles (
  id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 1 and 120),
  settings jsonb not null default '{}' check(jsonb_typeof(settings)='object'), created_at timestamptz not null default now()
);
create table public.sc_households (id uuid primary key default gen_random_uuid(), label text not null, created_at timestamptz not null default now());
create table public.sc_memberships (
  household_id uuid not null references public.sc_households(id), profile_id uuid not null references public.sc_profiles(id),
  status text not null default 'active' check(status in ('active','revoked')), primary key(household_id,profile_id)
);
create table public.sc_access_grants (
  owner_id uuid not null references public.sc_profiles(id), grantee_id uuid not null references public.sc_profiles(id),
  resource_kind text not null check(resource_kind in ('asset','garment','outfit','event','evidence','external')),
  resource_id uuid not null, can_read boolean not null default true, can_write boolean not null default false,
  expires_at timestamptz, created_at timestamptz not null default now(),
  primary key(owner_id,grantee_id,resource_kind,resource_id), check(owner_id<>grantee_id), check(not can_write or can_read)
);
create table public.sc_assets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), version integer not null default 1 check(version>0),
  bucket_id text not null default 'sc-private-assets' check(bucket_id='sc-private-assets'), storage_key text not null unique,
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/webm')),
  byte_size bigint not null check(byte_size>0 and byte_size<=209715200), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  provenance text not null check(provenance in ('user_upload','licensed_sample','provider_result','derived')),
  kind text not null check(kind in ('garment','label','person_video','style_reference','outfit_reference','fitting_result','card')),
  status text not null default 'pending' check(status in ('pending','finalized','failed')),
  parent_asset_id uuid, created_by_job_id uuid, allowed_providers text[] not null default '{}',
  usage_scope jsonb not null default '{}' check(jsonb_typeof(usage_scope)='object'), created_at timestamptz not null default now(), finalized_at timestamptz,
  unique(id,owner_id), unique(id,owner_id,version), foreign key(parent_asset_id,owner_id) references public.sc_assets(id,owner_id),
  check(split_part(storage_key,'/',1)=owner_id::text and split_part(storage_key,'/',2)=id::text and storage_key !~ '(^|/)\.\.(/|$)'),
  check(allowed_providers <@ array['openai','decart']::text[]), check(status<>'finalized' or finalized_at is not null)
);
create table public.sc_garments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), asset_id uuid, asset_version integer,
  name text not null check(length(btrim(name)) between 1 and 160), category text not null check(category in ('top','bottom','outer','bag','shoes','hat','accessory','dress')),
  attributes_json jsonb not null default '{}' check(jsonb_typeof(attributes_json)='object'), location_json jsonb not null default '{}' check(jsonb_typeof(location_json)='object'),
  revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,owner_id), foreign key(asset_id,owner_id,asset_version) references public.sc_assets(id,owner_id,version), check((asset_id is null)=(asset_version is null))
);
create table public.sc_evidence_items (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), garment_id uuid, asset_id uuid,
  evidence_kind text not null check(evidence_kind in ('label','official_guidance','user_observation','demo_evidence')),
  original_text text not null check(length(original_text)<=20000), source_ref text, observed_at timestamptz not null, created_at timestamptz not null default now(),
  unique(id,owner_id), foreign key(garment_id,owner_id) references public.sc_garments(id,owner_id), foreign key(asset_id,owner_id) references public.sc_assets(id,owner_id),
  check(garment_id is not null or asset_id is not null or nullif(source_ref,'') is not null)
);
create table public.sc_external_items (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), asset_id uuid,
  source_url text, source_label text not null, ownership text not null default 'external' check(ownership='external'), created_at timestamptz not null default now(),
  unique(id,owner_id), foreign key(asset_id,owner_id) references public.sc_assets(id,owner_id)
);
create table public.sc_outfits (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), name text not null,
  snapshot_json jsonb not null check(jsonb_typeof(snapshot_json)='object'), revision integer not null check(revision>0), created_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.sc_outfit_items (
  owner_id uuid not null, outfit_id uuid not null, slot text not null check(slot in ('top','bottom','outer','bag','shoes','hat','accessory','dress')),
  garment_id uuid, external_item_id uuid, asset_id uuid, asset_version integer,
  primary key(outfit_id,slot), foreign key(outfit_id,owner_id) references public.sc_outfits(id,owner_id),
  foreign key(garment_id,owner_id) references public.sc_garments(id,owner_id), foreign key(external_item_id,owner_id) references public.sc_external_items(id,owner_id),
  foreign key(asset_id,owner_id,asset_version) references public.sc_assets(id,owner_id,version),
  check(num_nonnulls(garment_id,external_item_id)=1), check((asset_id is null)=(asset_version is null))
);
create table public.sc_activity_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), kind text not null check(kind in ('plan','wear','care','movement')),
  occurred_at timestamptz not null, outfit_id uuid, input_source text not null check(input_source in ('user_confirmed','demo','sensor_confirmed')),
  details_json jsonb not null default '{}' check(jsonb_typeof(details_json)='object'), client_event_id text not null check(length(client_event_id) between 1 and 160),
  created_at timestamptz not null default now(), unique(id,owner_id), unique(owner_id,kind,client_event_id), foreign key(outfit_id,owner_id) references public.sc_outfits(id,owner_id)
);
create table public.sc_event_garments (
  owner_id uuid not null, event_id uuid not null, garment_id uuid not null, primary key(event_id,garment_id),
  foreign key(event_id,owner_id) references public.sc_activity_events(id,owner_id), foreign key(garment_id,owner_id) references public.sc_garments(id,owner_id)
);
create table public.sc_drafts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), kind text not null check(kind in ('registration','outfit','style')),
  revision integer not null check(revision>0), input_asset_id uuid, input_asset_version integer,
  manual_fields_json jsonb not null default '{}' check(jsonb_typeof(manual_fields_json)='object'), state_json jsonb not null check(jsonb_typeof(state_json)='object'),
  status text not null default 'editing' check(status in ('editing','saved','discarded')), updated_at timestamptz not null default now(),
  unique(id,owner_id), foreign key(input_asset_id,owner_id,input_asset_version) references public.sc_assets(id,owner_id,version), check((input_asset_id is null)=(input_asset_version is null))
);
create table public.sc_operations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), actor_id uuid not null references public.sc_profiles(id),
  action text not null, intent_key text not null check(length(intent_key) between 1 and 160), input_hash text not null,
  draft_id uuid, draft_revision integer, snapshot_json jsonb not null check(jsonb_typeof(snapshot_json)='object'),
  processing_status text not null default 'reserved' check(processing_status in ('reserved','running','succeeded','failed','cancelled','unknown_submission')),
  apply_status text not null default 'not_applied' check(apply_status in ('not_applied','applied','stale','unavailable')),
  error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,owner_id), unique(owner_id,action,intent_key), foreign key(draft_id,owner_id) references public.sc_drafts(id,owner_id), check((draft_id is null)=(draft_revision is null))
);
create table public.sc_operation_intents (
  owner_id uuid not null, action text not null, intent_key text not null, operation_id uuid not null, input_hash text not null,
  primary key(owner_id,action,intent_key), foreign key(operation_id,owner_id) references public.sc_operations(id,owner_id)
);
create table public.sc_operation_receipts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, operation_id uuid not null unique, action text not null,
  draft_id uuid, draft_revision integer, garment_id uuid, outfit_id uuid, event_id uuid, result_json jsonb not null,
  committed_at timestamptz not null default now(), unique(id,owner_id), unique(owner_id,action,draft_id,draft_revision),
  foreign key(operation_id,owner_id) references public.sc_operations(id,owner_id), foreign key(draft_id,owner_id) references public.sc_drafts(id,owner_id),
  foreign key(garment_id,owner_id) references public.sc_garments(id,owner_id), foreign key(outfit_id,owner_id) references public.sc_outfits(id,owner_id), foreign key(event_id,owner_id) references public.sc_activity_events(id,owner_id),
  check((action='saveGarment' and garment_id is not null and outfit_id is null and event_id is null) or (action='saveOutfit' and outfit_id is not null and garment_id is null and event_id is null) or (action in ('recordActualCare','recordMovementConfirmed','planOutfit','recordWear') and event_id is not null and garment_id is null and outfit_id is null))
);
create table public.sc_execution_approvals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.sc_profiles(id), provider text not null check(provider in ('openai','decart')),
  model text not null, action text not null, allowed_asset_versions jsonb not null check(jsonb_typeof(allowed_asset_versions)='object'),
  currency text not null default 'USD' check(currency='USD'), per_request_usd numeric(14,6) not null check(per_request_usd>0), total_usd numeric(14,6) not null check(total_usd>=per_request_usd),
  max_output_tokens integer not null default 0 check(max_output_tokens>=0), max_generated_seconds integer not null default 0 check(max_generated_seconds>=0),
  max_concurrency integer not null default 1 check(max_concurrency between 1 and 4), max_attempts integer not null default 1 check(max_attempts between 1 and 10),
  max_reconnects integer not null default 0 check(max_reconnects between 0 and 10), valid_from timestamptz not null, valid_until timestamptz not null,
  approval_reference text not null check(length(approval_reference)>0), revoked_at timestamptz, created_at timestamptz not null default now(), unique(id,owner_id), check(valid_until>valid_from)
);
create table public.sc_ai_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, operation_id uuid not null, approval_id uuid,
  adapter text not null, stage text not null, attempt_no integer not null default 1 check(attempt_no>0), mode text not null check(mode in ('mock','saved_result','live')),
  provider text, model text not null, job_signature text not null, config_json jsonb not null default '{}', input_snapshot_json jsonb not null,
  provider_job_id text, response_id text, session_id text, turn_id text,
  status text not null default 'reserved' check(status in ('reserved','submitted','running','succeeded','failed','cancelled','unknown_submission')),
  application_status text not null default 'not_applied' check(application_status in ('not_applied','applied','stale','unavailable')),
  result_ref uuid, result_json jsonb, error_code text, started_at timestamptz, finished_at timestamptz, absolute_end_at timestamptz,
  token_issue_count integer not null default 0 check(token_issue_count>=0), generated_seconds_reserved integer not null default 0 check(generated_seconds_reserved>=0),
  lease_active_until timestamptz, lease_seconds_issued integer not null default 0 check(lease_seconds_issued>=0),
  created_at timestamptz not null default now(), unique(id,owner_id), unique(operation_id,stage,attempt_no),
  foreign key(operation_id,owner_id) references public.sc_operations(id,owner_id), foreign key(approval_id,owner_id) references public.sc_execution_approvals(id,owner_id),
  check(mode='live' or (provider_job_id is null and response_id is null and session_id is null and turn_id is null)), check(mode<>'live' or (approval_id is not null and provider in ('openai','decart')))
);
create unique index sc_ai_job_reuse_idx on public.sc_ai_jobs(owner_id,job_signature) where status in ('reserved','submitted','running','unknown_submission','succeeded');
alter table public.sc_assets add constraint sc_assets_created_job_fk foreign key(created_by_job_id,owner_id) references public.sc_ai_jobs(id,owner_id);
alter table public.sc_ai_jobs add constraint sc_jobs_result_asset_fk foreign key(result_ref,owner_id) references public.sc_assets(id,owner_id);
create table public.sc_budget_ledger (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, operation_id uuid not null, job_id uuid not null unique, approval_id uuid not null,
  currency text not null default 'USD' check(currency='USD'), reserved_usd numeric(14,6) not null check(reserved_usd>0), actual_usd numeric(14,6) check(actual_usd>=0),
  reserved_units numeric(18,4) not null check(reserved_units>=0), actual_units numeric(18,4) check(actual_units>=0), unit_kind text not null check(unit_kind in ('token','generated_second','currency_amount')),
  settlement_status text not null default 'reserved' check(settlement_status in ('reserved','unsettled','settled','released')),
  settlement_reference text, created_at timestamptz not null default now(), settled_at timestamptz,
  foreign key(operation_id,owner_id) references public.sc_operations(id,owner_id), foreign key(job_id,owner_id) references public.sc_ai_jobs(id,owner_id), foreign key(approval_id,owner_id) references public.sc_execution_approvals(id,owner_id),
  check((settlement_status='settled' and actual_usd is not null and actual_units is not null and settled_at is not null and settlement_reference is not null) or (settlement_status<>'settled' and actual_usd is null and actual_units is null))
);
create table public.sc_job_tool_calls (
  owner_id uuid not null, job_id uuid not null, session_id text not null, turn_id text not null, call_id text not null, tool_name text not null,
  arguments_hash text not null, result_json jsonb not null, event_intent_key text not null, created_at timestamptz not null default now(),
  primary key(job_id,session_id,turn_id,call_id), foreign key(job_id,owner_id) references public.sc_ai_jobs(id,owner_id)
);

create index sc_garments_owner_idx on public.sc_garments(owner_id,category);
create index sc_assets_owner_idx on public.sc_assets(owner_id,status);
create index sc_evidence_owner_idx on public.sc_evidence_items(owner_id,garment_id);
create index sc_outfit_items_owner_idx on public.sc_outfit_items(owner_id,garment_id);
create index sc_events_owner_time_idx on public.sc_activity_events(owner_id,occurred_at desc);
create index sc_operations_owner_idx on public.sc_operations(owner_id,created_at desc);
create index sc_jobs_owner_idx on public.sc_ai_jobs(owner_id,operation_id);
create index sc_ledger_approval_idx on public.sc_budget_ledger(approval_id,settlement_status);
create index sc_grants_grantee_idx on public.sc_access_grants(grantee_id,owner_id,resource_kind,resource_id);

-- Private helper checks a verified JWT subject, an explicit per-resource grant, and active shared membership.
create function sc_private.can_access(p_owner uuid,p_kind text,p_id uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (auth.uid()=p_owner or exists(
    select 1 from public.sc_access_grants g
    where g.owner_id=p_owner and g.grantee_id=auth.uid() and g.resource_kind=p_kind and g.resource_id=p_id
      and g.can_read and (not p_write or g.can_write) and (g.expires_at is null or g.expires_at>now())
      and exists(select 1 from public.sc_memberships a join public.sc_memberships b using(household_id)
        where a.profile_id=p_owner and b.profile_id=auth.uid() and a.status='active' and b.status='active')));
$$;
revoke all on function sc_private.can_access(uuid,text,uuid,boolean) from public,anon;
grant execute on function sc_private.can_access(uuid,text,uuid,boolean) to authenticated;

do $$ declare t text; begin
  foreach t in array array['profiles','households','memberships','access_grants','assets','garments','evidence_items','external_items','outfits','outfit_items','activity_events','event_garments','drafts','operations','operation_intents','operation_receipts','execution_approvals','ai_jobs','budget_ledger','job_tool_calls'] loop
    execute format('alter table public.sc_%I enable row level security',t);
    execute format('revoke all on table public.sc_%I from public, anon, authenticated, service_role',t);
    execute format('grant select on table public.sc_%I to authenticated',t);
  end loop;
end $$;
create policy sc_profiles_read on public.sc_profiles for select to authenticated using(id=(select auth.uid()));
create policy sc_memberships_read on public.sc_memberships for select to authenticated using(profile_id=(select auth.uid()));
create policy sc_households_read on public.sc_households for select to authenticated using(exists(select 1 from public.sc_memberships m where m.household_id=sc_households.id and m.profile_id=(select auth.uid()) and m.status='active'));
create policy sc_grants_read on public.sc_access_grants for select to authenticated using(owner_id=(select auth.uid()) or grantee_id=(select auth.uid()));
create policy sc_assets_read on public.sc_assets for select to authenticated using(sc_private.can_access(owner_id,'asset',id));
create policy sc_garments_read on public.sc_garments for select to authenticated using(sc_private.can_access(owner_id,'garment',id));
create policy sc_evidence_read on public.sc_evidence_items for select to authenticated using(sc_private.can_access(owner_id,'evidence',id));
create policy sc_external_read on public.sc_external_items for select to authenticated using(sc_private.can_access(owner_id,'external',id));
create policy sc_outfits_read on public.sc_outfits for select to authenticated using(sc_private.can_access(owner_id,'outfit',id));
create policy sc_items_read on public.sc_outfit_items for select to authenticated using(sc_private.can_access(owner_id,'outfit',outfit_id));
create policy sc_events_read on public.sc_activity_events for select to authenticated using(sc_private.can_access(owner_id,'event',id));
create policy sc_event_items_read on public.sc_event_garments for select to authenticated using(sc_private.can_access(owner_id,'event',event_id));
do $$ declare t text; begin
  foreach t in array array['drafts','operations','operation_intents','operation_receipts','execution_approvals','ai_jobs','budget_ledger','job_tool_calls'] loop
    execute format('create policy sc_owner_read on public.sc_%I for select to authenticated using(owner_id=(select auth.uid()))',t);
  end loop;
end $$;
-- No direct authenticated INSERT/UPDATE/DELETE: writes must use guarded atomic RPCs.
commit;
