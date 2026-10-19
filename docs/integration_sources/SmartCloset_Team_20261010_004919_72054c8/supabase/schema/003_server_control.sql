-- Service-role-only, narrow lifecycle controls. No provider calls and no seeded approvals.
begin;
create function sc_private.sync_execution_approval(p_approval jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_execution_approvals; v_new public.sc_execution_approvals; v_pair record;
begin
  if jsonb_typeof(p_approval) is distinct from 'object' then raise exception 'invalid_input'; end if;
  v_new:=jsonb_populate_record(null::public.sc_execution_approvals,p_approval||jsonb_build_object('currency','USD','created_at',now()));
  if v_new.id is null or v_new.owner_id is null or v_new.revoked_at is not null then raise exception 'invalid_input'; end if;
  select * into v from public.sc_execution_approvals where id=v_new.id;
  if found then
    if (to_jsonb(v)-'created_at') is distinct from (to_jsonb(v_new)-'created_at') then raise exception 'conflict'; end if;
    return to_jsonb(v);
  end if;
  if jsonb_typeof(v_new.allowed_asset_versions) is distinct from 'object' then raise exception 'invalid_input'; end if;
  for v_pair in select key,value from jsonb_each(v_new.allowed_asset_versions) loop
    if jsonb_typeof(v_pair.value)<>'number' or not exists(select 1 from public.sc_assets a where a.id=v_pair.key::uuid and a.owner_id=v_new.owner_id and a.version=(v_pair.value::text)::integer and a.status='finalized' and v_new.provider=any(a.allowed_providers)) then raise exception 'unauthorized_target'; end if;
  end loop;
  insert into public.sc_execution_approvals select v_new.* returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_sync_execution_approval(p_approval jsonb) returns jsonb language sql security invoker set search_path='' as $$select sc_private.sync_execution_approval(p_approval)$$;

create function sc_private.finalize_asset(p_owner_id uuid,p_asset_id uuid,p_verified_sha256 text,p_verified_byte_size bigint,p_verified_mime_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_assets;
begin
  select * into v from public.sc_assets where id=p_asset_id and owner_id=p_owner_id for update;
  if not found then raise exception 'unauthorized_target'; end if;
  if v.sha256 is distinct from p_verified_sha256 or v.byte_size is distinct from p_verified_byte_size or v.mime_type is distinct from p_verified_mime_type then raise exception 'conflict'; end if;
  if v.status='failed' then raise exception 'conflict'; end if;
  if not exists(select 1 from storage.objects where bucket_id=v.bucket_id and name=v.storage_key) then raise exception 'result_unavailable'; end if;
  if v.status='pending' then update public.sc_assets set status='finalized',finalized_at=now() where id=v.id returning * into v; end if;
  return to_jsonb(v);
end $$;
create function public.sc_finalize_asset(p_owner_id uuid,p_asset_id uuid,p_verified_sha256 text,p_verified_byte_size bigint,p_verified_mime_type text) returns jsonb language sql security invoker set search_path='' as $$select sc_private.finalize_asset(p_owner_id,p_asset_id,p_verified_sha256,p_verified_byte_size,p_verified_mime_type)$$;

create function sc_private.reserve_job(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=(p_request->>'owner_id')::uuid; v_approval public.sc_execution_approvals; v_job public.sc_ai_jobs; v_op public.sc_operations; v_ledger public.sc_budget_ledger;
  v_hash text; v_spent numeric; v_cost numeric:=(p_request->>'estimated_usd')::numeric; v_units numeric:=(p_request->>'reserved_units')::numeric;
  v_pair record; v_end timestamptz; v_asset_versions jsonb:=p_request->'asset_versions'; v_draft public.sc_drafts; v_conf jsonb:=coalesce(p_request->'config_json','{}'::jsonb);
begin
  if jsonb_typeof(p_request) is distinct from 'object' or v_owner is null or v_owner is distinct from (p_request->>'actor_id')::uuid
    or p_request->>'action' is null or p_request->>'action' not in ('analyzeRegistration','classifyRegistration','generateOutfits','adaptStyleToWardrobe','requestCareGuide','startTryOn')
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
create function public.sc_reserve_job(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$select sc_private.reserve_job(p_request)$$;

create function sc_private.update_job(p_owner_id uuid,p_job_id uuid,p_patch jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_ai_jobs; v_op public.sc_operations; v_status text; v_apply text; v_key text;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'invalid_input'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('status','provider_job_id','response_id','session_id','turn_id','result_ref','result_json','error_code','application_status') then raise exception 'invalid_input'; end if;
  end loop;
  select * into v from public.sc_ai_jobs where id=p_job_id and owner_id=p_owner_id for update;
  if not found then raise exception 'unauthorized_target'; end if;
  v_status:=coalesce(p_patch->>'status',v.status); v_apply:=coalesce(p_patch->>'application_status',v.application_status);
  if v_status not in ('reserved','submitted','running','succeeded','failed','cancelled','unknown_submission') or v_apply not in ('not_applied','applied','stale','unavailable') then raise exception 'invalid_input'; end if;
  if v_status<>v.status and (v.status in ('succeeded','failed','cancelled') or (v.status<>'reserved' and v_status='reserved') or (v.status='running' and v_status='submitted')) then raise exception 'conflict'; end if;
  -- Once recorded, provider identity cannot be replaced by another result/job.
  if (v.provider_job_id is not null and p_patch ? 'provider_job_id' and v.provider_job_id is distinct from p_patch->>'provider_job_id') or (v.response_id is not null and p_patch ? 'response_id' and v.response_id is distinct from p_patch->>'response_id') or (v.session_id is not null and p_patch ? 'session_id' and v.session_id is distinct from p_patch->>'session_id') then raise exception 'conflict'; end if;
  if v.status in ('succeeded','failed','cancelled') and ((p_patch ? 'result_json' and v.result_json is distinct from p_patch->'result_json') or (p_patch ? 'result_ref' and v.result_ref is distinct from (p_patch->>'result_ref')::uuid)) then raise exception 'conflict'; end if;
  if v_apply='applied' and v_status<>'succeeded' then raise exception 'invalid_input'; end if;
  select * into strict v_op from public.sc_operations where id=v.operation_id;
  if v_apply='applied' and v_op.draft_id is not null and not exists(select 1 from public.sc_drafts where id=v_op.draft_id and owner_id=p_owner_id and revision=v_op.draft_revision and status<>'discarded') then v_apply:='stale'; end if;
  if p_patch->>'result_ref' is not null and not exists(select 1 from public.sc_assets where id=(p_patch->>'result_ref')::uuid and owner_id=p_owner_id and status='finalized') then raise exception 'unauthorized_target'; end if;
  update public.sc_ai_jobs set status=v_status,application_status=v_apply,
    provider_job_id=coalesce(p_patch->>'provider_job_id',provider_job_id),response_id=coalesce(p_patch->>'response_id',response_id),session_id=coalesce(p_patch->>'session_id',session_id),turn_id=coalesce(p_patch->>'turn_id',turn_id),
    result_ref=coalesce((p_patch->>'result_ref')::uuid,result_ref),result_json=coalesce(p_patch->'result_json',result_json),error_code=coalesce(p_patch->>'error_code',error_code),
    started_at=case when v_status in ('submitted','running','unknown_submission') then coalesce(started_at,now()) else started_at end,
    finished_at=case when v_status in ('succeeded','failed','cancelled') then coalesce(finished_at,now()) else finished_at end where id=p_job_id returning * into v;
  update public.sc_operations set processing_status=case when v_status in ('submitted','running') then 'running' else v_status end,apply_status=v_apply,error_code=v.error_code,updated_at=now() where id=v.operation_id;
  if v_status='unknown_submission' then update public.sc_budget_ledger set settlement_status='unsettled' where job_id=p_job_id and settlement_status='reserved'; end if;
  return to_jsonb(v);
end $$;
create function public.sc_update_job(p_owner_id uuid,p_job_id uuid,p_patch jsonb) returns jsonb language sql security invoker set search_path='' as $$select sc_private.update_job(p_owner_id,p_job_id,p_patch)$$;

create function sc_private.settle_job(p_owner_id uuid,p_job_id uuid,p_settlement jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_budget_ledger; v_job public.sc_ai_jobs; v_status text:=p_settlement->>'status'; v_actual numeric; v_units numeric;
begin
  select * into v_job from public.sc_ai_jobs where id=p_job_id and owner_id=p_owner_id for update;
  if not found then raise exception 'unauthorized_target'; end if;
  select * into strict v from public.sc_budget_ledger where job_id=p_job_id for update;
  if jsonb_typeof(p_settlement) is distinct from 'object' or v_status is null or v_status not in ('unsettled','settled','released') then raise exception 'invalid_input'; end if;
  if v_status='settled' then
    if jsonb_typeof(p_settlement->'actual_usd') is distinct from 'number' or jsonb_typeof(p_settlement->'actual_units') is distinct from 'number' or length(coalesce(p_settlement->>'reference',''))=0 then raise exception 'invalid_input'; end if;
    v_actual:=(p_settlement->>'actual_usd')::numeric; v_units:=(p_settlement->>'actual_units')::numeric;
    if v_actual<0 or v_units<0 or v_job.status not in ('succeeded','failed','cancelled') then raise exception 'invalid_input'; end if;
  end if;
  if v.settlement_status in ('settled','released') then
    if v_status<>v.settlement_status or v.actual_usd is distinct from v_actual or v.actual_units is distinct from v_units or v.settlement_reference is distinct from p_settlement->>'reference' then raise exception 'conflict'; end if;
    return to_jsonb(v);
  end if;
  if v_status='released' and (length(coalesce(p_settlement->>'reference',''))=0 or v_job.status not in ('reserved','cancelled') or v_job.started_at is not null or num_nonnulls(v_job.provider_job_id,v_job.response_id,v_job.session_id)>0) then raise exception 'conflict'; end if;
  update public.sc_budget_ledger set settlement_status=v_status,actual_usd=v_actual,actual_units=v_units,settlement_reference=p_settlement->>'reference',settled_at=case when v_status in ('settled','released') then now() end where id=v.id returning * into v;
  if v_status='released' then
    update public.sc_ai_jobs set status='cancelled',finished_at=now() where id=p_job_id;
    update public.sc_operations set processing_status='cancelled',updated_at=now() where id=v.operation_id;
  end if;
  return to_jsonb(v);
end $$;
create function public.sc_settle_job(p_owner_id uuid,p_job_id uuid,p_settlement jsonb) returns jsonb language sql security invoker set search_path='' as $$select sc_private.settle_job(p_owner_id,p_job_id,p_settlement)$$;

create function sc_private.issue_realtime_lease(p_owner_id uuid,p_job_id uuid,p_requested_seconds integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_ai_jobs; v_approval public.sc_execution_approvals; v_remaining integer;
begin
  select * into v from public.sc_ai_jobs where id=p_job_id and owner_id=p_owner_id for update;
  if not found then raise exception 'unauthorized_target'; end if;
  select * into strict v_approval from public.sc_execution_approvals where id=v.approval_id;
  if v.mode<>'live' or v.stage<>'realtime' or v.status not in ('reserved','submitted','running') or v.absolute_end_at is null or v.absolute_end_at<=now() or v_approval.revoked_at is not null or v_approval.valid_until<=now() then raise exception 'approval_required'; end if;
  if v.token_issue_count>v_approval.max_reconnects then raise exception 'budget_exceeded'; end if;
  -- A token TTL does not terminate its media session. Reserve the whole permitted session
  -- duration; a second connection cannot overlap it, even if a browser disconnect claim arrives.
  if v.lease_active_until is not null and v.lease_active_until>now() then raise exception 'budget_exceeded'; end if;
  v_remaining:=least(floor(extract(epoch from v.absolute_end_at-now()))::integer,v.generated_seconds_reserved-v.lease_seconds_issued);
  if p_requested_seconds is null or p_requested_seconds<=0 or p_requested_seconds>v_remaining then raise exception 'budget_exceeded'; end if;
  update public.sc_ai_jobs set token_issue_count=token_issue_count+1,lease_seconds_issued=lease_seconds_issued+p_requested_seconds,lease_active_until=now()+make_interval(secs=>p_requested_seconds) where id=p_job_id returning * into v;
  return jsonb_build_object('job_id',v.id,'remaining_seconds',p_requested_seconds,'absolute_end_at',v.absolute_end_at,'token_issue_count',v.token_issue_count);
end $$;
create function public.sc_issue_realtime_lease(p_owner_id uuid,p_job_id uuid,p_requested_seconds integer) returns jsonb language sql security invoker set search_path='' as $$select sc_private.issue_realtime_lease(p_owner_id,p_job_id,p_requested_seconds)$$;

create function sc_private.record_tool_call(p_owner_id uuid,p_job_id uuid,p_session_id text,p_turn_id text,p_call_id text,p_tool_name text,p_arguments_hash text,p_result_json jsonb,p_event_intent_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sc_job_tool_calls; v_job public.sc_ai_jobs;
begin
  select * into v_job from public.sc_ai_jobs where id=p_job_id and owner_id=p_owner_id for update;
  if not found or v_job.session_id is distinct from p_session_id then raise exception 'unauthorized_target'; end if;
  if p_tool_name is null or p_tool_name not in ('get_wardrobe_items','get_garment_context','get_care_evidence','get_outing_context','get_style_reference') or length(coalesce(p_turn_id,'')) not between 1 and 256 or length(coalesce(p_call_id,'')) not between 1 and 256 or length(coalesce(p_arguments_hash,'')) not between 1 and 256 or length(coalesce(p_event_intent_key,'')) not between 1 and 160 or p_result_json is null or octet_length(p_result_json::text)>131072 then raise exception 'invalid_input'; end if;
  select * into v from public.sc_job_tool_calls where job_id=p_job_id and session_id=p_session_id and turn_id=p_turn_id and call_id=p_call_id;
  if found then
    if v.arguments_hash<>p_arguments_hash or v.tool_name<>p_tool_name then raise exception 'conflict'; end if;
    return to_jsonb(v);
  end if;
  if v_job.status not in ('submitted','running') or v_job.turn_id is distinct from p_turn_id then raise exception 'stale_revision'; end if;
  if (select count(*) from public.sc_job_tool_calls where job_id=p_job_id)>=8 then raise exception 'budget_exceeded'; end if;
  insert into public.sc_job_tool_calls(owner_id,job_id,session_id,turn_id,call_id,tool_name,arguments_hash,result_json,event_intent_key) values(p_owner_id,p_job_id,p_session_id,p_turn_id,p_call_id,p_tool_name,p_arguments_hash,p_result_json,p_event_intent_key) returning * into v;
  return to_jsonb(v);
end $$;
create function public.sc_record_tool_call(p_owner_id uuid,p_job_id uuid,p_session_id text,p_turn_id text,p_call_id text,p_tool_name text,p_arguments_hash text,p_result_json jsonb,p_event_intent_key text) returns jsonb language sql security invoker set search_path='' as $$select sc_private.record_tool_call(p_owner_id,p_job_id,p_session_id,p_turn_id,p_call_id,p_tool_name,p_arguments_hash,p_result_json,p_event_intent_key)$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('sc_sync_execution_approval','sc_finalize_asset','sc_reserve_job','sc_update_job','sc_settle_job','sc_issue_realtime_lease','sc_record_tool_call')) or (n.nspname='sc_private' and p.proname in ('sync_execution_approval','finalize_asset','reserve_job','update_job','settle_job','issue_realtime_lease','record_tool_call')) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
