-- Additive correction: keep discarded drafts retired when stale requests arrive.
begin;
create or replace function sc_private.put_draft(p_draft_id uuid,p_kind text,p_expected_revision integer,p_state_json jsonb,p_manual_fields_json jsonb,p_input_asset_id uuid,p_input_asset_version integer) returns jsonb
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
    -- A delayed autosave must never reactivate a discarded editor. New registration uses a new ID.
    if v.status='discarded' then raise exception 'conflict'; end if;
    if v.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
    if v.kind<>p_kind then raise exception 'conflict'; end if;
    update public.sc_drafts set revision=revision+1,state_json=p_state_json,manual_fields_json=p_manual_fields_json,input_asset_id=p_input_asset_id,input_asset_version=p_input_asset_version,status='editing',updated_at=now() where id=p_draft_id returning * into v;
  else
    if p_expected_revision<>0 then raise exception 'stale_revision'; end if;
    insert into public.sc_drafts(id,owner_id,kind,revision,state_json,manual_fields_json,input_asset_id,input_asset_version) values(p_draft_id,auth.uid(),p_kind,1,p_state_json,p_manual_fields_json,p_input_asset_id,p_input_asset_version) returning * into v;
  end if;
  return to_jsonb(v);
end $$;

revoke all on function sc_private.put_draft(uuid,text,integer,jsonb,jsonb,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function sc_private.put_draft(uuid,text,integer,jsonb,jsonb,uuid,integer) to authenticated;
commit;

