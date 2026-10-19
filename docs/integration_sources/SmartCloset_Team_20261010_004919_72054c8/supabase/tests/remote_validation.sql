-- Run ONLY on confirmed slxgcgtnxkchxywgsmuk after migrations. All fixtures are rolled back.
-- Auth catalog rows below are transaction-local SQL fixtures, not account creation/login tests.
begin;
do $$ begin
 if exists(select 1 from auth.users where id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102')) then raise exception 'fixture UUID collision'; end if;
end $$;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000101'),('00000000-0000-4000-8000-000000000102');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
set local role authenticated;
select public.sc_ensure_profile('transaction fixture owner');
select public.sc_put_draft('00000000-0000-4000-8000-000000000201','registration',0,'{"name":"SQL fixture garment","category":"top","location_json":{"label":"fixture A"}}','{}',null,null);
select set_config('sc_test.receipt',public.sc_commit_action('00000000-0000-4000-8000-000000000101','saveGarment','remote-fixture-a','00000000-0000-4000-8000-000000000201',1,'{"name":"SQL fixture garment","category":"top","location_json":{"label":"fixture A"}}')::text,true);
do $$ declare original jsonb:=current_setting('sc_test.receipt')::jsonb; repeated jsonb; begin
 repeated:=public.sc_commit_action('00000000-0000-4000-8000-000000000101','saveGarment','remote-fixture-b','00000000-0000-4000-8000-000000000201',1,'{"name":"SQL fixture garment","category":"top","location_json":{"label":"fixture A"}}');
 if original->>'receipt_id' is distinct from repeated->>'receipt_id' or repeated->>'replayed'<>'true' then raise exception 'receipt replay failed'; end if;
 if (select count(*) from public.sc_garments)<>1 then raise exception 'owner read failed'; end if;
 begin
   insert into public.sc_garments(owner_id,name,category) values('00000000-0000-4000-8000-000000000101','forbidden','top');
   raise exception 'direct write unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.sc_reserve_job('{}');raise exception 'budget RPC unexpectedly allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
set local role authenticated;
select public.sc_ensure_profile('transaction fixture other');
do $$ begin
 if (select count(*) from public.sc_garments)<>0 then raise exception 'owner isolation failed'; end if;
 if (select count(*) from public.sc_operation_receipts)<>0 then raise exception 'receipt isolation failed'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.sc_garments;raise exception 'anonymous read unexpectedly allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select jsonb_build_object('source','transaction-only SQL fixtures','receipt_replay','PASS','owner_rls','PASS','anonymous_grants','PASS','direct_write_denied','PASS','budget_rpc_denied','PASS','auth_login','NOT_TESTED','storage_bytes','NOT_TESTED') as verification;
rollback;
-- These fixture counts must all be zero after rollback; no fixture account or data remains.
select (select count(*) from auth.users where id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102')) as residual_auth_fixtures,
 (select count(*) from public.sc_profiles where id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102')) as residual_profile_fixtures,
 (select count(*) from public.sc_drafts where id='00000000-0000-4000-8000-000000000201') as residual_draft_fixtures;
