-- All writes below are atomic transactions invoked by a verified user JWT.
begin;
create function sc_private.require_owner(p_owner uuid) returns void language plpgsql set search_path='' as $$
begin
  if auth.uid() is null or auth.uid()<>p_owner then raise exception 'unauthorized_target'; end if;
end $$;
create function sc_private.input_hash(p_value jsonb) returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$$;
create function sc_private.ensure_profile(p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_profiles;
begin
  if auth.uid() is null then raise exception 'unauthorized_target'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 120 then raise exception 'invalid_input'; end if;
  insert into public.sc_profiles(id,display_name) values(auth.uid(),btrim(p_display_name)) on conflict(id) do nothing;
  select * into v from public.sc_profiles where id=auth.uid(); return to_jsonb(v);
end $$;
create function public.sc_ensure_profile(p_display_name text) returns jsonb language sql security invoker set search_path='' as $$select sc_private.ensure_profile(p_display_name)$$;

create function sc_private.put_draft(p_draft_id uuid,p_kind text,p_expected_revision integer,p_state_json jsonb,p_manual_fields_json jsonb,p_input_asset_id uuid,p_input_asset_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.sc_drafts;
begin
  perform sc_private.require_owner(auth.uid());
  if p_draft_id is null or p_expected_revision is null or p_expected_revision<0 or p_kind not in ('registration','outfit','style') or jsonb_typeof(p_state_json) is distinct from 'object' or jsonb_typeof(p_manual_fields_json) is distinct from 'object' then raise exception 'invalid_input'; end if;
  if (p_input_asset_id is null)<>(p_input_asset_version is null) then raise exception 'invalid_input'; end if;
  if p_input_asset_id is not null and not exists(select 1 from public.sc_assets where id=p_input_asset_id and owner_id=auth.uid() and version=p_input_asset_version and status='finalized') then raise exception 'unauthorized_target'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into v from public.sc_drafts where id=p_draft_id;
  if found then
    if v.owner_id<>auth.uid() then raise exception 'unauthorized_target'; end if;
    if v.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
    if v.kind<>p_kind then raise exception 'conflict'; end if;
    update public.sc_drafts set revision=revision+1,state_json=p_state_json,manual_fields_json=p_manual_fields_json,input_asset_id=p_input_asset_id,input_asset_version=p_input_asset_version,status='editing',updated_at=now() where id=p_draft_id returning * into v;
  else
    if p_expected_revision<>0 then raise exception 'stale_revision'; end if;
    insert into public.sc_drafts(id,owner_id,kind,revision,state_json,manual_fields_json,input_asset_id,input_asset_version) values(p_draft_id,auth.uid(),p_kind,1,p_state_json,p_manual_fields_json,p_input_asset_id,p_input_asset_version) returning * into v;
  end if;
  return to_jsonb(v);
end $$;
create function public.sc_put_draft(p_draft_id uuid,p_kind text,p_expected_revision integer,p_state_json jsonb,p_manual_fields_json jsonb,p_input_asset_id uuid default null,p_input_asset_version integer default null) returns jsonb language sql security invoker set search_path='' as $$select sc_private.put_draft(p_draft_id,p_kind,p_expected_revision,p_state_json,p_manual_fields_json,p_input_asset_id,p_input_asset_version)$$;

create function sc_private.prepare_asset(p_asset_id uuid,p_kind text,p_mime_type text,p_byte_size bigint,p_sha256 text,p_allowed_providers text[],p_parent_asset_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_assets; v_version integer:=1; v_ext text;
begin
  perform sc_private.require_owner(auth.uid());
  if p_asset_id is null or p_kind not in ('garment','label','person_video','style_reference','outfit_reference','fitting_result','card') or p_mime_type not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm') or p_byte_size is null or p_byte_size<=0 or p_byte_size>209715200 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_allowed_providers is null or not(p_allowed_providers <@ array['openai','decart']::text[]) then raise exception 'invalid_input'; end if;
  if p_kind='person_video' and p_mime_type not in ('video/mp4','video/webm') then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if p_parent_asset_id is not null then
    select version+1 into v_version from public.sc_assets where id=p_parent_asset_id and owner_id=auth.uid() and status='finalized';
    if not found then raise exception 'unauthorized_target'; end if;
  end if;
  select * into v from public.sc_assets where id=p_asset_id;
  if found then
    if v.owner_id<>auth.uid() then raise exception 'unauthorized_target'; end if;
    if v.kind<>p_kind or v.mime_type<>p_mime_type or v.byte_size<>p_byte_size or v.sha256<>p_sha256 or v.allowed_providers<>p_allowed_providers or v.parent_asset_id is distinct from p_parent_asset_id then raise exception 'conflict'; end if;
    return to_jsonb(v);
  end if;
  v_ext:=case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' else 'webm' end;
  insert into public.sc_assets(id,owner_id,version,storage_key,mime_type,byte_size,sha256,provenance,kind,parent_asset_id,allowed_providers)
    values(p_asset_id,auth.uid(),v_version,auth.uid()::text||'/'||p_asset_id::text||'/v'||v_version::text||'.'||v_ext,p_mime_type,p_byte_size,p_sha256,'user_upload',p_kind,p_parent_asset_id,p_allowed_providers) returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_prepare_asset(p_asset_id uuid,p_kind text,p_mime_type text,p_byte_size bigint,p_sha256 text,p_allowed_providers text[] default '{}',p_parent_asset_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select sc_private.prepare_asset(p_asset_id,p_kind,p_mime_type,p_byte_size,p_sha256,p_allowed_providers,p_parent_asset_id)$$;

create function sc_private.receipt_envelope(p_receipt public.sc_operation_receipts,p_replayed boolean) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('operation_id',p_receipt.operation_id,'processing_status','succeeded','apply_status','applied','receipt_id',p_receipt.id,'committed_at',p_receipt.committed_at,'entity_id',coalesce(p_receipt.garment_id,p_receipt.outfit_id,p_receipt.event_id),'result',p_receipt.result_json,'replayed',p_replayed);
$$;
create function sc_private.commit_action(p_owner_id uuid,p_action text,p_intent_key text,p_draft_id uuid,p_draft_revision integer,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_old_hash text; v_operation uuid; v_receipt public.sc_operation_receipts; v_draft public.sc_drafts;
  v_id uuid:=gen_random_uuid(); v_garment public.sc_garments; v_outfit public.sc_outfits; v_event public.sc_activity_events;
  v_item jsonb; v_gid uuid; v_external uuid; v_asset uuid; v_asset_version integer; v_result jsonb; v_kind text; v_slots text[]:='{}';
begin
  if auth.uid() is null or p_owner_id is null then raise exception 'unauthorized_target'; end if;
  if p_action is null or p_action not in ('saveGarment','saveOutfit','recordActualCare','recordMovementConfirmed','planOutfit','recordWear') or p_intent_key is null or length(p_intent_key) not between 1 and 160 or jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'invalid_input'; end if;
  if (p_draft_id is null)<>(p_draft_revision is null) then raise exception 'invalid_input'; end if;
  if auth.uid()<>p_owner_id then
    if p_action not in ('recordActualCare','recordMovementConfirmed') or jsonb_typeof(p_snapshot->'garment_ids') is distinct from 'array' or jsonb_array_length(p_snapshot->'garment_ids')=0 then raise exception 'unauthorized_target'; end if;
    for v_gid in select value::uuid from jsonb_array_elements_text(p_snapshot->'garment_ids') loop
      if not sc_private.can_access(p_owner_id,'garment',v_gid,true) then raise exception 'unauthorized_target'; end if;
    end loop;
  end if;
  -- Serialize the owner's logical actions. This covers distinct intent keys racing for one draft revision.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  v_hash:=sc_private.input_hash(jsonb_build_object('action',p_action,'draft_id',p_draft_id,'draft_revision',p_draft_revision,'snapshot',p_snapshot));
  select operation_id,input_hash into v_operation,v_old_hash from public.sc_operation_intents where owner_id=p_owner_id and action=p_action and intent_key=p_intent_key;
  if found then
    if v_old_hash<>v_hash then raise exception 'conflict'; end if;
    select * into strict v_receipt from public.sc_operation_receipts where operation_id=v_operation;
    return sc_private.receipt_envelope(v_receipt,true);
  end if;
  if p_draft_id is not null then
    select * into v_receipt from public.sc_operation_receipts where owner_id=p_owner_id and action=p_action and draft_id=p_draft_id and draft_revision=p_draft_revision;
    if found then
      select input_hash into v_old_hash from public.sc_operations where id=v_receipt.operation_id;
      if v_old_hash<>v_hash then raise exception 'conflict'; end if;
      insert into public.sc_operation_intents values(p_owner_id,p_action,p_intent_key,v_receipt.operation_id,v_hash);
      return sc_private.receipt_envelope(v_receipt,true);
    end if;
  end if;
  if p_action in ('saveGarment','saveOutfit') then
    if p_draft_id is null then raise exception 'invalid_input'; end if;
    select * into v_draft from public.sc_drafts where id=p_draft_id and owner_id=p_owner_id;
    if not found then raise exception 'unauthorized_target'; end if;
    if v_draft.revision<>p_draft_revision then raise exception 'stale_revision'; end if;
    if v_draft.status='discarded' or v_draft.state_json<>p_snapshot then raise exception 'conflict'; end if;
    if (p_action='saveGarment' and v_draft.kind<>'registration') or (p_action='saveOutfit' and v_draft.kind not in ('outfit','style')) then raise exception 'invalid_input'; end if;
  else
    if p_draft_id is not null or jsonb_typeof(p_snapshot->'garment_ids') is distinct from 'array' or length(coalesce(p_snapshot->>'client_event_id','')) not between 1 and 160 or coalesce(p_snapshot->>'input_source','') not in ('user_confirmed','demo') or p_snapshot->>'occurred_at' is null then raise exception 'invalid_input'; end if;
    v_kind:=case p_action when 'recordActualCare' then 'care' when 'recordMovementConfirmed' then 'movement' when 'planOutfit' then 'plan' else 'wear' end;
    select * into v_event from public.sc_activity_events where owner_id=p_owner_id and kind=v_kind and client_event_id=p_snapshot->>'client_event_id';
    if found then
      select r.* into strict v_receipt from public.sc_operation_receipts r where r.owner_id=p_owner_id and r.event_id=v_event.id;
      select input_hash into v_old_hash from public.sc_operations where id=v_receipt.operation_id;
      if v_old_hash<>v_hash then raise exception 'conflict'; end if;
      insert into public.sc_operation_intents values(p_owner_id,p_action,p_intent_key,v_receipt.operation_id,v_hash);
      return sc_private.receipt_envelope(v_receipt,true);
    end if;
  end if;
  if p_action='saveGarment' then
    v_asset:=nullif(p_snapshot->>'asset_id','')::uuid; v_asset_version:=(p_snapshot->>'asset_version')::integer;
    if (v_asset is null)<>(v_asset_version is null) then raise exception 'invalid_input'; end if;
    if v_asset is not null and not exists(select 1 from public.sc_assets where id=v_asset and owner_id=p_owner_id and version=v_asset_version and status='finalized') then raise exception 'unauthorized_target'; end if;
    insert into public.sc_garments(id,owner_id,asset_id,asset_version,name,category,attributes_json,location_json)
      values(v_id,p_owner_id,v_asset,v_asset_version,p_snapshot->>'name',p_snapshot->>'category',coalesce(p_snapshot->'attributes_json','{}'),coalesce(p_snapshot->'location_json','{}')) returning * into v_garment;
    v_result:=to_jsonb(v_garment);
  elsif p_action='saveOutfit' then
    if jsonb_typeof(p_snapshot->'items') is distinct from 'array' or jsonb_array_length(p_snapshot->'items') not between 1 and 8 or length(btrim(coalesce(p_snapshot->>'name',''))) not between 1 and 160 then raise exception 'invalid_input'; end if;
    insert into public.sc_outfits(id,owner_id,name,snapshot_json,revision) values(v_id,p_owner_id,p_snapshot->>'name',p_snapshot,p_draft_revision) returning * into v_outfit;
    for v_item in select value from jsonb_array_elements(p_snapshot->'items') loop
      v_gid:=nullif(v_item->>'garment_id','')::uuid; v_external:=nullif(v_item->>'external_item_id','')::uuid;
      v_asset:=nullif(v_item->>'asset_id','')::uuid; v_asset_version:=(v_item->>'asset_version')::integer;
      if num_nonnulls(v_gid,v_external)<>1 or (v_item->>'slot')=any(v_slots) then raise exception 'invalid_input'; end if;
      v_slots:=array_append(v_slots,v_item->>'slot');
      if v_gid is not null then
        select * into v_garment from public.sc_garments where id=v_gid and owner_id=p_owner_id;
        if not found then raise exception 'unauthorized_target'; end if;
        if v_garment.category is distinct from v_item->>'slot' or v_garment.asset_id is distinct from v_asset or v_garment.asset_version is distinct from v_asset_version then raise exception 'stale_revision'; end if;
      else
        if not exists(select 1 from public.sc_external_items where id=v_external and owner_id=p_owner_id and asset_id is not distinct from v_asset) then raise exception 'unauthorized_target'; end if;
      end if;
      if v_asset is not null and not exists(select 1 from public.sc_assets where id=v_asset and owner_id=p_owner_id and version=v_asset_version and status='finalized') then raise exception 'unauthorized_target'; end if;
      insert into public.sc_outfit_items(owner_id,outfit_id,slot,garment_id,external_item_id,asset_id,asset_version) values(p_owner_id,v_id,v_item->>'slot',v_gid,v_external,v_asset,v_asset_version);
    end loop;
    v_result:=to_jsonb(v_outfit)||jsonb_build_object('items',p_snapshot->'items');
  else
    if jsonb_array_length(p_snapshot->'garment_ids')=0 or (p_action='recordMovementConfirmed' and (jsonb_array_length(p_snapshot->'garment_ids')<>1 or jsonb_typeof(p_snapshot->'location_json') is distinct from 'object' or p_snapshot->'location_json'='{}'::jsonb)) then raise exception 'invalid_input'; end if;
    if p_action='planOutfit' and nullif(p_snapshot->>'outfit_id','') is null then raise exception 'invalid_input'; end if;
    if nullif(p_snapshot->>'outfit_id','') is not null and not exists(select 1 from public.sc_outfits where id=(p_snapshot->>'outfit_id')::uuid and owner_id=p_owner_id) then raise exception 'unauthorized_target'; end if;
    insert into public.sc_activity_events(id,owner_id,kind,occurred_at,outfit_id,input_source,details_json,client_event_id)
      values(v_id,p_owner_id,v_kind,(p_snapshot->>'occurred_at')::timestamptz,nullif(p_snapshot->>'outfit_id','')::uuid,p_snapshot->>'input_source',coalesce(p_snapshot->'details_json','{}'),p_snapshot->>'client_event_id') returning * into v_event;
    for v_gid in select value::uuid from jsonb_array_elements_text(p_snapshot->'garment_ids') loop
      if not exists(select 1 from public.sc_garments where id=v_gid and owner_id=p_owner_id) then raise exception 'unauthorized_target'; end if;
      if v_event.outfit_id is not null and not exists(select 1 from public.sc_outfit_items where outfit_id=v_event.outfit_id and garment_id=v_gid) then raise exception 'invalid_input'; end if;
      insert into public.sc_event_garments(owner_id,event_id,garment_id) values(p_owner_id,v_id,v_gid);
      if p_action='recordMovementConfirmed' then update public.sc_garments set location_json=p_snapshot->'location_json',revision=revision+1,updated_at=now() where id=v_gid and owner_id=p_owner_id; end if;
    end loop;
    v_result:=to_jsonb(v_event)||jsonb_build_object('garment_ids',p_snapshot->'garment_ids');
  end if;
  v_operation:=gen_random_uuid();
  insert into public.sc_operations(id,owner_id,actor_id,action,intent_key,input_hash,draft_id,draft_revision,snapshot_json,processing_status,apply_status)
    values(v_operation,p_owner_id,auth.uid(),p_action,p_intent_key,v_hash,p_draft_id,p_draft_revision,p_snapshot,'succeeded','applied');
  insert into public.sc_operation_intents values(p_owner_id,p_action,p_intent_key,v_operation,v_hash);
  insert into public.sc_operation_receipts(owner_id,operation_id,action,draft_id,draft_revision,garment_id,outfit_id,event_id,result_json)
    values(p_owner_id,v_operation,p_action,p_draft_id,p_draft_revision,case when p_action='saveGarment' then v_id end,case when p_action='saveOutfit' then v_id end,case when p_action not in ('saveGarment','saveOutfit') then v_id end,v_result) returning * into v_receipt;
  if p_draft_id is not null then update public.sc_drafts set status='saved' where id=p_draft_id; end if;
  return sc_private.receipt_envelope(v_receipt,false);
end $$;
create function public.sc_commit_action(p_owner_id uuid,p_action text,p_intent_key text,p_draft_id uuid,p_draft_revision integer,p_snapshot jsonb) returns jsonb language sql security invoker set search_path='' as $$select sc_private.commit_action(p_owner_id,p_action,p_intent_key,p_draft_id,p_draft_revision,p_snapshot)$$;

create function sc_private.set_resource_grant(p_resource_kind text,p_resource_id uuid,p_grantee_id uuid,p_can_read boolean,p_can_write boolean,p_expires_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_table text; v_exists boolean; v public.sc_access_grants;
begin
  perform sc_private.require_owner(auth.uid());
  if p_grantee_id is null or p_grantee_id=auth.uid() or p_can_read is null or p_can_write is null or (p_can_write and not p_can_read) then raise exception 'invalid_input'; end if;
  v_table:=case p_resource_kind when 'asset' then 'sc_assets' when 'garment' then 'sc_garments' when 'outfit' then 'sc_outfits' when 'event' then 'sc_activity_events' when 'evidence' then 'sc_evidence_items' when 'external' then 'sc_external_items' end;
  if v_table is null then raise exception 'invalid_input'; end if;
  execute format('select exists(select 1 from public.%I where id=$1 and owner_id=$2)',v_table) into v_exists using p_resource_id,auth.uid();
  if not v_exists then raise exception 'unauthorized_target'; end if;
  if not p_can_read then delete from public.sc_access_grants where owner_id=auth.uid() and grantee_id=p_grantee_id and resource_kind=p_resource_kind and resource_id=p_resource_id; return '{"revoked":true}'::jsonb; end if;
  if not exists(select 1 from public.sc_memberships a join public.sc_memberships b using(household_id) where a.profile_id=auth.uid() and b.profile_id=p_grantee_id and a.status='active' and b.status='active') then raise exception 'unauthorized_target'; end if;
  insert into public.sc_access_grants(owner_id,grantee_id,resource_kind,resource_id,can_read,can_write,expires_at) values(auth.uid(),p_grantee_id,p_resource_kind,p_resource_id,p_can_read,p_can_write,p_expires_at)
  on conflict(owner_id,grantee_id,resource_kind,resource_id) do update set can_read=excluded.can_read,can_write=excluded.can_write,expires_at=excluded.expires_at returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_set_resource_grant(p_resource_kind text,p_resource_id uuid,p_grantee_id uuid,p_can_read boolean,p_can_write boolean default false,p_expires_at timestamptz default null) returns jsonb language sql security invoker set search_path='' as $$select sc_private.set_resource_grant(p_resource_kind,p_resource_id,p_grantee_id,p_can_read,p_can_write,p_expires_at)$$;

-- New functions have no inherited PUBLIC execution. Only the API wrappers and their guarded implementations are callable.
revoke all on all functions in schema sc_private from public,anon,authenticated,service_role;
grant execute on function sc_private.can_access(uuid,text,uuid,boolean) to authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('sc_ensure_profile','sc_put_draft','sc_prepare_asset','sc_commit_action','sc_set_resource_grant')) or (n.nspname='sc_private' and p.proname in ('ensure_profile','put_draft','prepare_asset','commit_action','set_resource_grant')) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
