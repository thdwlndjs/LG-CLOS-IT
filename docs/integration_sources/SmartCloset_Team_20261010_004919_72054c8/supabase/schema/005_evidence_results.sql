begin;
create function sc_private.put_evidence(p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_evidence_items; v_new public.sc_evidence_items;
begin
  perform sc_private.require_owner(auth.uid());
  if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence ? 'owner_id' or p_evidence ? 'created_at' then raise exception 'invalid_input'; end if;
  v_new:=jsonb_populate_record(null::public.sc_evidence_items,p_evidence||jsonb_build_object('owner_id',auth.uid(),'created_at',now()));
  if v_new.id is null then raise exception 'invalid_input'; end if;
  if v_new.garment_id is not null and not exists(select 1 from public.sc_garments where id=v_new.garment_id and owner_id=auth.uid()) then raise exception 'unauthorized_target'; end if;
  if v_new.asset_id is not null and not exists(select 1 from public.sc_assets where id=v_new.asset_id and owner_id=auth.uid() and status='finalized' and (v_new.evidence_kind<>'label' or kind='label')) then raise exception 'unauthorized_target'; end if;
  select * into v from public.sc_evidence_items where id=v_new.id;
  if found then
    if v.owner_id<>auth.uid() then raise exception 'unauthorized_target'; end if;
    if (to_jsonb(v)-'created_at') is distinct from (to_jsonb(v_new)-'created_at') then raise exception 'conflict'; end if;
    return to_jsonb(v);
  end if;
  insert into public.sc_evidence_items select v_new.* returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_put_evidence(p_evidence jsonb) returns jsonb language sql security invoker set search_path='' as $$select sc_private.put_evidence(p_evidence)$$;
create function sc_private.put_external_item(p_item jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_external_items; v_new public.sc_external_items;
begin
  perform sc_private.require_owner(auth.uid());
  if jsonb_typeof(p_item) is distinct from 'object' or p_item ? 'owner_id' or p_item ? 'created_at' then raise exception 'invalid_input'; end if;
  v_new:=jsonb_populate_record(null::public.sc_external_items,p_item||jsonb_build_object('owner_id',auth.uid(),'ownership','external','created_at',now()));
  if v_new.id is null or length(coalesce(v_new.source_label,'')) not between 1 and 200 or (v_new.source_url is not null and v_new.source_url !~ '^https://') then raise exception 'invalid_input'; end if;
  if v_new.asset_id is not null and not exists(select 1 from public.sc_assets where id=v_new.asset_id and owner_id=auth.uid() and status='finalized') then raise exception 'unauthorized_target'; end if;
  select * into v from public.sc_external_items where id=v_new.id;
  if found then
    if v.owner_id<>auth.uid() then raise exception 'unauthorized_target'; end if;
    if (to_jsonb(v)-'created_at') is distinct from (to_jsonb(v_new)-'created_at') then raise exception 'conflict'; end if;
    return to_jsonb(v);
  end if;
  insert into public.sc_external_items select v_new.* returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_put_external_item(p_item jsonb) returns jsonb language sql security invoker set search_path='' as $$select sc_private.put_external_item(p_item)$$;

create function sc_private.prepare_generated_asset(p_owner_id uuid,p_job_id uuid,p_asset_id uuid,p_kind text,p_mime_type text,p_byte_size bigint,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_assets; v_job public.sc_ai_jobs; v_ext text;
begin
  select * into v_job from public.sc_ai_jobs where id=p_job_id and owner_id=p_owner_id for update;
  if not found then raise exception 'unauthorized_target'; end if;
  if v_job.mode<>'live' or v_job.status not in ('submitted','running','succeeded') or p_kind not in ('fitting_result','card','outfit_reference') or p_asset_id is null or p_mime_type not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm') or p_byte_size is null or p_byte_size<=0 or p_byte_size>209715200 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_input'; end if;
  select * into v from public.sc_assets where id=p_asset_id;
  if found then
    if v.owner_id<>p_owner_id then raise exception 'unauthorized_target'; end if;
    if v.created_by_job_id is distinct from p_job_id or v.sha256<>p_sha256 or v.mime_type<>p_mime_type or v.byte_size<>p_byte_size or v.kind<>p_kind then raise exception 'conflict'; end if;
    return to_jsonb(v);
  end if;
  v_ext:=case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' else 'webm' end;
  insert into public.sc_assets(id,owner_id,storage_key,mime_type,byte_size,sha256,provenance,kind,created_by_job_id)
    values(p_asset_id,p_owner_id,p_owner_id::text||'/'||p_asset_id::text||'/v1.'||v_ext,p_mime_type,p_byte_size,p_sha256,'provider_result',p_kind,p_job_id) returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_prepare_generated_asset(p_owner_id uuid,p_job_id uuid,p_asset_id uuid,p_kind text,p_mime_type text,p_byte_size bigint,p_sha256 text) returns jsonb language sql security invoker set search_path='' as $$select sc_private.prepare_generated_asset(p_owner_id,p_job_id,p_asset_id,p_kind,p_mime_type,p_byte_size,p_sha256)$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('sc_put_evidence','sc_put_external_item')) or (n.nspname='sc_private' and p.proname in ('put_evidence','put_external_item')) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname='sc_prepare_generated_asset') or (n.nspname='sc_private' and p.proname='prepare_generated_asset') loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
