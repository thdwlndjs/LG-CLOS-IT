-- Confirm target slxgcgtnxkchxywgsmuk first. This transaction rolls back every fixture.
-- Synthetic catalog metadata only: no signup, Auth tokens, media bytes, storage API or provider call.
begin;
do $$ begin
 if exists(select 1 from auth.users where id in ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000303')) then raise exception 'fixture UUID collision'; end if;
end $$;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000301'),('00000000-0000-4000-8000-000000000302'),('00000000-0000-4000-8000-000000000303');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);
set local role authenticated;
select public.sc_ensure_profile('transaction resource owner');
select public.sc_put_draft('00000000-0000-4000-8000-000000000401','registration',0,'{"name":"temporary shared garment","category":"top","location_json":{"label":"fixture A"}}','{}',null,null);
select set_config('sc_test.family_receipt',public.sc_commit_action('00000000-0000-4000-8000-000000000301','saveGarment','remote-family-save','00000000-0000-4000-8000-000000000401',1,'{"name":"temporary shared garment","category":"top","location_json":{"label":"fixture A"}}')::text,true);
select set_config('sc_test.asset',public.sc_prepare_asset('00000000-0000-4000-8000-000000000701','label','image/png',100,repeat('c',64),'{}',null)::text,true);
insert into storage.objects(bucket_id,name) values('sc-private-assets',current_setting('sc_test.asset')::jsonb->>'storage_key');
do $$ begin
 if (select count(*) from storage.objects where name=current_setting('sc_test.asset')::jsonb->>'storage_key')<>1 then raise exception 'pending owner verification read failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
set local role authenticated;select public.sc_ensure_profile('transaction explicit grantee');reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000303',true);
set local role authenticated;select public.sc_ensure_profile('transaction member without grant');reset role;
insert into public.sc_households(id,label) values('00000000-0000-4000-8000-000000000801','transaction-only family');
insert into public.sc_memberships(household_id,profile_id) values
 ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000301'),
 ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000302'),
 ('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000303');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.sc_garments where id=(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid) then raise exception 'membership alone leaked garment'; end if;
 begin
  insert into storage.objects(bucket_id,name) values('sc-private-assets','00000000-0000-4000-8000-000000000301/00000000-0000-4000-8000-000000000701/forged.png');
  raise exception 'foreign storage insert unexpectedly allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);
set local role authenticated;
select public.sc_set_resource_grant('garment',(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid,'00000000-0000-4000-8000-000000000302',true,false,null);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
set local role authenticated;
do $$ declare gid uuid:=(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid; begin
 if (select count(*) from public.sc_garments where id=gid)<>1 then raise exception 'explicit garment read failed'; end if;
 if exists(select 1 from public.sc_assets where id='00000000-0000-4000-8000-000000000701') then raise exception 'garment grant leaked asset'; end if;
 begin
  perform public.sc_commit_action('00000000-0000-4000-8000-000000000301','recordMovementConfirmed','remote-family-move',null,null,jsonb_build_object('client_event_id','remote-family-event','occurred_at','2026-10-13T09:24:00+09:00','input_source','user_confirmed','garment_ids',jsonb_build_array(gid),'location_json',jsonb_build_object('label','fixture B')));
  raise exception 'read-only grant unexpectedly allowed movement';
 exception when raise_exception then if sqlerrm<>'unauthorized_target' then raise; end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);
set local role authenticated;
select public.sc_set_resource_grant('garment',(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid,'00000000-0000-4000-8000-000000000302',true,true,null);
select public.sc_set_resource_grant('asset','00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000302',true,false,null);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
set local role authenticated;
select public.sc_commit_action('00000000-0000-4000-8000-000000000301','recordMovementConfirmed','remote-family-move',null,null,jsonb_build_object('client_event_id','remote-family-event','occurred_at','2026-10-13T09:24:00+09:00','input_source','user_confirmed','garment_ids',jsonb_build_array(current_setting('sc_test.family_receipt')::jsonb->>'entity_id'),'location_json',jsonb_build_object('label','fixture B')));
do $$ begin
 if (select location_json->>'label' from public.sc_garments where id=(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid)<>'fixture B' then raise exception 'explicit movement write failed'; end if;
 if exists(select 1 from storage.objects where name=current_setting('sc_test.asset')::jsonb->>'storage_key') then raise exception 'shared pending asset leaked bytes'; end if;
 if exists(select 1 from public.sc_operation_receipts where owner_id='00000000-0000-4000-8000-000000000301') then raise exception 'garment grant leaked owner receipts'; end if;
end $$;
reset role;
set local role service_role;
-- The hash/size below are synthetic test assertions, not actual uploaded-byte verification.
select public.sc_finalize_asset('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000701',repeat('c',64),100,'image/png');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
set local role authenticated;
do $$ declare affected integer; begin
 if (select count(*) from storage.objects where name=current_setting('sc_test.asset')::jsonb->>'storage_key')<>1 then raise exception 'explicit finalized asset read failed'; end if;
 update storage.objects set name=name where name=current_setting('sc_test.asset')::jsonb->>'storage_key';
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'storage overwrite unexpectedly allowed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000303',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.sc_garments where id=(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid) or exists(select 1 from storage.objects where name=current_setting('sc_test.asset')::jsonb->>'storage_key') then raise exception 'ungranted family member leaked resources'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);
set local role authenticated;
select public.sc_set_resource_grant('garment',(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid,'00000000-0000-4000-8000-000000000302',false,false,null);
select public.sc_set_resource_grant('asset','00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000302',false,false,null);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.sc_garments where id=(current_setting('sc_test.family_receipt')::jsonb->>'entity_id')::uuid) or exists(select 1 from storage.objects where name=current_setting('sc_test.asset')::jsonb->>'storage_key') then raise exception 'resource revocation failed'; end if;
end $$;
reset role;
select jsonb_build_object('same_family_without_grant','PASS','explicit_read_write','PASS','source_asset_separate','PASS','pending_owner_only','PASS','private_finalized_access','PASS','overwrite_denied','PASS','grant_revocation','PASS','actual_media_bytes','NOT_TESTED','real_auth_login','NOT_TESTED') as verification;
rollback;
select (select count(*) from auth.users where id in ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000303')) as residual_auth_fixtures,
 (select count(*) from public.sc_profiles where id in ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000303')) as residual_profile_fixtures,
 (select count(*) from public.sc_households where id='00000000-0000-4000-8000-000000000801') as residual_household_fixtures,
 (select count(*) from public.sc_assets where id='00000000-0000-4000-8000-000000000701') as residual_asset_fixtures,
 (select count(*) from storage.objects where name='00000000-0000-4000-8000-000000000301/00000000-0000-4000-8000-000000000701/v1.png') as residual_storage_fixtures;
