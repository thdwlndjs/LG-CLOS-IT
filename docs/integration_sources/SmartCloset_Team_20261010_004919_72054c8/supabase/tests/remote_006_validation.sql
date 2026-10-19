-- Target slxgcgtnxkchxywgsmuk only. Database-only transaction fixtures; NO provider/API call.
-- Numeric approval values below are temporary SQL fixtures, never permission for real spending.
begin;
do $$ begin
 if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000000901') then raise exception 'fixture UUID collision'; end if;
end $$;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000901');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
set local role authenticated;
select public.sc_ensure_profile('transaction 006 fixture');
select public.sc_put_draft('00000000-0000-4000-8000-000000000902','registration',0,'{"name":"006 preserved entity","category":"top"}','{}',null,null);
do $$ declare saved jsonb; replay jsonb; discarded jsonb; begin
 saved:=public.sc_commit_action('00000000-0000-4000-8000-000000000901','saveGarment','006-save','00000000-0000-4000-8000-000000000902',1,'{"name":"006 preserved entity","category":"top"}');
 discarded:=public.sc_discard_draft('00000000-0000-4000-8000-000000000902',1);
 if discarded->>'status'<>'discarded' then raise exception 'discard status failed'; end if;
 if discarded is distinct from public.sc_discard_draft('00000000-0000-4000-8000-000000000902',1) then raise exception 'discard replay failed'; end if;
 begin
  perform public.sc_put_draft('00000000-0000-4000-8000-000000000902','registration',1,'{"name":"late write must stay discarded","category":"top"}','{}',null,null);
  raise exception 'discarded draft unexpectedly revived';
 exception when raise_exception then if sqlerrm<>'conflict' then raise;end if;end;
 replay:=public.sc_commit_action('00000000-0000-4000-8000-000000000901','saveGarment','006-save-alias','00000000-0000-4000-8000-000000000902',1,'{"name":"006 preserved entity","category":"top"}');
 if saved->>'receipt_id' is distinct from replay->>'receipt_id' or not exists(select 1 from public.sc_garments where id=(saved->>'entity_id')::uuid) then raise exception 'discard damaged committed entity/receipt'; end if;
end $$;
reset role;
set local role service_role;
do $$ declare a jsonb; req jsonb; req2 jsonb; first_job jsonb; second_job jsonb; replay jsonb; begin
 a:=jsonb_build_object('id','00000000-0000-4000-8000-000000001101','owner_id','00000000-0000-4000-8000-000000000901','provider','openai','model','SQL-fixture-not-a-real-model','action','analyzeRegistration','allowed_asset_versions','{}'::jsonb,'per_request_usd',1,'total_usd',3,'max_output_tokens',10,'max_generated_seconds',0,'max_concurrency',4,'max_attempts',4,'max_reconnects',0,'valid_from',now()-interval '1 minute','valid_until',now()+interval '5 minutes','approval_reference','transaction-only SQL fixture; not spending approval');
 perform public.sc_sync_execution_approval(a);
 perform public.sc_sync_execution_approval(a||jsonb_build_object('id','00000000-0000-4000-8000-000000001102','action','analyzeStyleReference'));
 req:=jsonb_build_object('owner_id','00000000-0000-4000-8000-000000000901','actor_id','00000000-0000-4000-8000-000000000901','action','analyzeRegistration','intent_key','006-job-a','input_snapshot','{"fixture":true}'::jsonb,'approval_id','00000000-0000-4000-8000-000000001101','provider','openai','model','SQL-fixture-not-a-real-model','adapter','SQL-only-fixture','stage','analysis','job_signature','006-signature-a','estimated_usd',1,'reserved_units',10,'unit_kind','token','asset_versions','{}'::jsonb,'max_output_tokens',10,'max_generated_seconds',0);
 req2:=req||jsonb_build_object('action','analyzeStyleReference','intent_key','006-job-b','approval_id','00000000-0000-4000-8000-000000001102','job_signature','006-signature-b');
 first_job:=public.sc_reserve_job(req);
 replay:=public.sc_reserve_job(req||'{"intent_key":"006-job-alias"}'::jsonb);
 if replay->>'job_id' is distinct from first_job->>'job_id' or replay->>'reused'<>'true' then raise exception 'job replay blocked'; end if;
 begin perform public.sc_reserve_job(req2);raise exception 'cross-approval owner cap failed';exception when raise_exception then if sqlerrm<>'budget_exceeded' then raise;end if;end;
 perform public.sc_update_job('00000000-0000-4000-8000-000000000901',(first_job->>'job_id')::uuid,'{"status":"cancelled"}');
 perform public.sc_settle_job('00000000-0000-4000-8000-000000000901',(first_job->>'job_id')::uuid,'{"status":"released","reference":"SQL fixture never submitted"}');
 second_job:=public.sc_reserve_job(req2);
 if second_job->>'job_id'=first_job->>'job_id' or second_job->>'reused'<>'false' then raise exception 'terminal slot release or style action failed'; end if;
end $$;
reset role;
select jsonb_build_object('owner_concurrency_across_approvals','PASS','same_job_replay','PASS','separate_style_analysis_action','PASS','soft_discard_entity_receipt_preserved','PASS','discarded_late_write_denied','PASS','provider_calls',0,'auth_login','NOT_TESTED') as verification;
rollback;
select (select count(*) from auth.users where id='00000000-0000-4000-8000-000000000901') as residual_auth_fixtures,
 (select count(*) from public.sc_profiles where id='00000000-0000-4000-8000-000000000901') as residual_profile_fixtures,
 (select count(*) from public.sc_ai_jobs where owner_id='00000000-0000-4000-8000-000000000901') as residual_job_fixtures,
 (select count(*) from public.sc_budget_ledger where owner_id='00000000-0000-4000-8000-000000000901') as residual_ledger_fixtures,
 (select count(*) from public.sc_execution_approvals where owner_id='00000000-0000-4000-8000-000000000901') as residual_approval_fixtures;
