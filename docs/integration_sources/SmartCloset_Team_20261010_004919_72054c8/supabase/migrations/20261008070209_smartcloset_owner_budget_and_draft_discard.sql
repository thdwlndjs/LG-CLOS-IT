-- Additive correction: owner-wide live concurrency and editor-only soft discard.
-- Original applied migration sources remain immutable.
begin;
create or replace function sc_private.reserve_job(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=(p_request->>'owner_id')::uuid; v_approval public.sc_execution_approvals; v_job public.sc_ai_jobs; v_op public.sc_operations; v_ledger public.sc_budget_ledger;
  v_hash text; v_spent numeric; v_cost numeric:=(p_request->>'estimated_usd')::numeric; v_units numeric:=(p_request->>'reserved_units')::numeric;
  v_pair record; v_end timestamptz; v_asset_versions jsonb:=p_request->'asset_versions'; v_draft public.sc_drafts; v_conf jsonb:=coalesce(p_request->'config_json','{}'::jsonb);
begin
  if jsonb_typeof(p_request) is distinct from 'object' or v_owner is null or v_owner is distinct from (p_request->>'actor_id')::uuid
    or p_request->>'action' is null or p_request->>'action' not in ('analyzeRegistration','analyzeStyleReference','classifyRegistration','generateOutfits','adaptStyleToWardrobe','requestCareGuide','startTryOn')
    or length(coalesce(p_request->>'intent_key','')) not between 1 and 160 or length(coalesce(p_request->>'job_signature','')) not between 1 and 256
    or length(coalesce(p_request->>'adapter',''))=0 or length(coalesce(p_request->>'stage',''))=0
    or jsonb_typeof(p_request->'input_snapshot') is distinct from 'object' or jsonb_typeof(v_asset_versions) is distinct from 'object' or jsonb_typeof(v_conf) is distinct from 'object'
    or jsonb_typeof(p_request->'estimated_usd') is distinct from 'number' or v_cost<=0 or jsonb_typeof(p_request->'reserved_units') is distinct from 'number' or v_units<0
    or p_request->>'unit_kind' is null or p_request->>'unit_kind' not in ('token','generated_second','currency_amount') then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
  v_hash:=sc_private.input_hash(jsonb_build_object('action',p_request->>'action','draft_id',p_request->>'draft_id','draft_revision',p_request->'draft_revision','snapshot',p_request->'input_snapshot','signature',p_request->>'job_signature','provider',p_request->>'provider','model',p_request->>'model','assets',v_asset_versions,'config',v_conf,'adapter',p_request->>'adapter','stage',p_request->>'stage','approval_id',p_request->>'approval_id'));
  select o.* into v_op from public.sc_operation_intents i join public.sc_operations o on o.id=i.operation_id where i.owner_id=v_owner and i.action=p_request->>'action' and i.intent_key=p_request->>'intent_key';
  if found then
    if v_op.input_hash<>v_hash then raise exception 'conflict'; end if;
    select * into strict v_job from public.sc_ai_jobs where operation_id=v_op.id and stage=p_request->>'stage' order by attempt_no limit 1;
    select * into strict v_ledger from public.sc_budget_ledger where job_id=v_job.id;
    return jsonb_build_object('operation_id',v_op.id,'job_id',v_job.id,'ledger_id',v_ledger.id,'processing_status',v_job.status,'reused',true,'reserved_usd',v_ledger.reserved_usd,'absolute_end_at',v_job.absolute_end_at);
  end if;
  select * into v_job from public.sc_ai_jobs where owner_id=v_owner and job_signature=p_request->>'job_signature' and status in ('reserved','submitted','running','unknown_submission','succeeded');
  if found then
    select * into strict v_op from public.sc_operations where id=v_job.operation_id;
    if v_op.input_hash<>v_hash then raise exception 'conflict'; end if;
    select * into strict v_ledger from public.sc_budget_ledger where job_id=v_job.id;
    insert into public.sc_operation_intents values(v_owner,p_request->>'action',p_request->>'intent_key',v_op.id,v_hash);
    return jsonb_build_object('operation_id',v_op.id,'job_id',v_job.id,'ledger_id',v_ledger.id,'processing_status',v_job.status,'reused',true,'reserved_usd',v_ledger.reserved_usd,'absolute_end_at',v_job.absolute_end_at);
  end if;
  select * into v_approval from public.sc_execution_approvals where id=(p_request->>'approval_id')::uuid and owner_id=v_owner for update;
  if not found or v_approval.revoked_at is not null or now()<v_approval.valid_from or now()>=v_approval.valid_until or v_approval.provider is distinct from p_request->>'provider' or v_approval.model is distinct from p_request->>'model' or v_approval.action is distinct from p_request->>'action' then raise exception 'approval_required'; end if;
  if v_cost>v_approval.per_request_usd or coalesce((p_request->>'max_output_tokens')::integer,-1) not between 0 and v_approval.max_output_tokens or coalesce((p_request->>'max_generated_seconds')::integer,-1) not between 0 and v_approval.max_generated_seconds then raise exception 'budget_exceeded'; end if;
  if p_request->>'unit_kind'='generated_second' and (v_units<>(p_request->>'max_generated_seconds')::integer or v_units<=0) then raise exception 'invalid_input'; end if;
  for v_pair in select key,value from jsonb_each(v_asset_versions) loop
    if jsonb_typeof(v_pair.value)<>'number' or v_approval.allowed_asset_versions->v_pair.key is distinct from v_pair.value or not exists(select 1 from public.sc_assets a where a.id=v_pair.key::uuid and a.owner_id=v_owner and a.version=(v_pair.value::text)::integer and a.status='finalized' and v_approval.provider=any(a.allowed_providers)) then raise exception 'unauthorized_target'; end if;
  end loop;
  if (p_request->>'draft_id' is null)<>(p_request->>'draft_revision' is null) then raise exception 'invalid_input'; end if;
  if p_request->>'draft_id' is not null then
    select * into v_draft from public.sc_drafts where id=(p_request->>'draft_id')::uuid and owner_id=v_owner;
    if not found then raise exception 'unauthorized_target'; end if;
    if v_draft.revision<>(p_request->>'draft_revision')::integer or v_draft.status='discarded' then raise exception 'stale_revision'; end if;
  end if;
  select coalesce(sum(case when settlement_status='settled' then actual_usd when settlement_status in ('reserved','unsettled') then reserved_usd else 0 end),0) into v_spent from public.sc_budget_ledger where approval_id=v_approval.id;
  if v_spent+v_cost>v_approval.total_usd then raise exception 'budget_exceeded'; end if;
  -- One active paid execution per owner across ALL approvals/providers/actions.
  -- Existing intent/signature replays already returned above and never consume a new slot.
  if exists(select 1 from public.sc_ai_jobs where owner_id=v_owner and mode='live' and status in ('reserved','submitted','running','unknown_submission')) then raise exception 'budget_exceeded'; end if;
  if (select count(*) from public.sc_ai_jobs where approval_id=v_approval.id and status in ('reserved','submitted','running','unknown_submission'))>=v_approval.max_concurrency then raise exception 'budget_exceeded'; end if;
  if (select count(*) from public.sc_ai_jobs where approval_id=v_approval.id)>=v_approval.max_attempts then raise exception 'budget_exceeded'; end if;
  if p_request->>'absolute_end_at' is not null then
    v_end:=(p_request->>'absolute_end_at')::timestamptz;
    if v_end<=now() or v_end>v_approval.valid_until or v_end>now()+make_interval(secs=>(p_request->>'max_generated_seconds')::integer) then raise exception 'budget_exceeded'; end if;
  end if;
  if p_request->>'stage'='realtime' and (v_end is null or p_request->>'unit_kind'<>'generated_second') then raise exception 'invalid_input'; end if;
  insert into public.sc_operations(owner_id,actor_id,action,intent_key,input_hash,draft_id,draft_revision,snapshot_json) values(v_owner,v_owner,p_request->>'action',p_request->>'intent_key',v_hash,(p_request->>'draft_id')::uuid,(p_request->>'draft_revision')::integer,p_request->'input_snapshot') returning * into v_op;
  insert into public.sc_operation_intents values(v_owner,p_request->>'action',p_request->>'intent_key',v_op.id,v_hash);
  insert into public.sc_ai_jobs(owner_id,operation_id,approval_id,adapter,stage,mode,provider,model,job_signature,config_json,input_snapshot_json,absolute_end_at,generated_seconds_reserved)
    values(v_owner,v_op.id,v_approval.id,p_request->>'adapter',p_request->>'stage','live',v_approval.provider,v_approval.model,p_request->>'job_signature',v_conf,p_request->'input_snapshot',v_end,(p_request->>'max_generated_seconds')::integer) returning * into v_job;
  insert into public.sc_budget_ledger(owner_id,operation_id,job_id,approval_id,reserved_usd,reserved_units,unit_kind) values(v_owner,v_op.id,v_job.id,v_approval.id,v_cost,v_units,p_request->>'unit_kind') returning * into v_ledger;
  return jsonb_build_object('operation_id',v_op.id,'job_id',v_job.id,'ledger_id',v_ledger.id,'processing_status',v_job.status,'reused',false,'reserved_usd',v_cost,'absolute_end_at',v_end);
end $$;

create function sc_private.discard_draft(p_draft_id uuid,p_expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_drafts;
begin
  perform sc_private.require_owner(auth.uid());
  if p_draft_id is null or p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into v from public.sc_drafts where id=p_draft_id and owner_id=auth.uid() for update;
  if not found then raise exception 'unauthorized_target'; end if;
  if v.status='discarded' then return to_jsonb(v); end if;
  if v.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
  -- Editor selection only. Committed garments, outfits, operations and receipts are untouched.
  update public.sc_drafts set status='discarded',updated_at=now() where id=v.id returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_discard_draft(p_draft_id uuid,p_expected_revision integer) returns jsonb language sql security invoker set search_path='' as $$select sc_private.discard_draft(p_draft_id,p_expected_revision)$$;
revoke all on function sc_private.reserve_job(jsonb) from public,anon,authenticated,service_role;
grant execute on function sc_private.reserve_job(jsonb) to service_role;
revoke all on function sc_private.discard_draft(uuid,integer),public.sc_discard_draft(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function sc_private.discard_draft(uuid,integer),public.sc_discard_draft(uuid,integer) to authenticated;
commit;

