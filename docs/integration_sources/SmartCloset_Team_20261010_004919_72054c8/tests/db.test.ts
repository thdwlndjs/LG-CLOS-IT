import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createTestDatabase, OWNER, OTHER, THIRD, rpc } from './db-harness';

let db: PGlite;
before(async () => { db = await createTestDatabase(); });
after(async () => { if (db) await db.close(); });
const j = (x: unknown) => JSON.stringify(x);
const garment = (name='검증 의류', category='top') => ({ name, category, attributes_json:{color:'검정'},location_json:{label:'행거 A'} });
async function save(snapshot=garment(), action='saveGarment') {
  const draft = randomUUID();
  await rpc(db,'sc_put_draft',[draft, action==='saveGarment'?'registration':'outfit',0,j(snapshot),'{}',null,null]);
  const result = await rpc<any>(db,'sc_commit_action',[OWNER,action,randomUUID(),draft,1,j(snapshot)]);
  return {draft,result,snapshot};
}
async function adminCount(table:string) { await asRole(db,'postgres'); return Number((await db.query<{n:number}>(`select count(*)::int n from public.sc_${table}`)).rows[0].n); }
async function approval(overrides:Record<string,unknown>={}) {
  await asRole(db,'service_role');
  const row={id:randomUUID(),owner_id:OWNER,provider:'openai',model:'fixture-model',action:'analyzeRegistration',allowed_asset_versions:{},currency:'USD',per_request_usd:1,total_usd:3,max_output_tokens:1000,max_generated_seconds:0,max_concurrency:1,max_attempts:4,max_reconnects:0,valid_from:new Date(Date.now()-60000).toISOString(),valid_until:new Date(Date.now()+3600000).toISOString(),approval_reference:'test-only-not-real-approval',...overrides};
  await rpc(db,'sc_sync_execution_approval',[j(row)]);return row;
}
function jobRequest(a:any,overrides:Record<string,unknown>={}) {
  return {owner_id:OWNER,actor_id:OWNER,action:a.action,intent_key:randomUUID(),input_snapshot:{fixture:true},approval_id:a.id,provider:a.provider,model:a.model,adapter:'fixture',stage:'analysis',job_signature:randomUUID(),estimated_usd:1,reserved_units:1000,unit_kind:'token',asset_versions:{},max_output_tokens:1000,max_generated_seconds:0,...overrides};
}

test('schema, grants and RLS: anonymous and direct authenticated writes are denied',async()=>{
  await asRole(db,'postgres');
  const tables=await db.query<{relname:string;relrowsecurity:boolean}>("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r' and relname like 'sc_%'");
  assert.equal(tables.rows.length,20); assert.ok(tables.rows.every(t=>t.relrowsecurity));
  await asRole(db,'anon'); await assert.rejects(db.query('select * from public.sc_garments'),/permission denied/);
  await assert.rejects(rpc(db,'sc_ensure_profile',['anon']),/permission denied/);
  await asRole(db,'authenticated',OWNER);
  await assert.rejects(db.query("insert into public.sc_garments(owner_id,name,category) values($1,'forged','top')",[OWNER]),/permission denied/);
  await assert.rejects(rpc(db,'sc_reserve_job',['{}']),/permission denied/);
  await asRole(db,'service_role'); await assert.rejects(db.query('update public.sc_profiles set display_name=display_name'),/permission denied/);
});

test('authenticated profile bootstrap uses the JWT subject and preserves existing name',async()=>{
  await asRole(db,'authenticated',OWNER);
  const profile=await rpc<any>(db,'sc_ensure_profile',['changed label']);assert.equal(profile.id,OWNER);assert.equal(profile.display_name,'owner fixture');
  await asRole(db,'authenticated');await assert.rejects(rpc(db,'sc_ensure_profile',['missing subject']),/unauthorized_target/);
});

test('atomic garment receipt replay is immutable; intent and draft revision conflicts are rejected',async()=>{
  await asRole(db,'authenticated',OWNER);const s=await save();const receipt=s.result;
  assert.equal(receipt.result.attributes_json.color,'검정');assert.equal(receipt.result.location_json.label,'행거 A');
  const replay=await rpc<any>(db,'sc_commit_action',[OWNER,'saveGarment','new-alias',s.draft,1,j(s.snapshot)]);
  assert.equal(replay.receipt_id,receipt.receipt_id);assert.equal(replay.replayed,true);
  await assert.rejects(rpc(db,'sc_commit_action',[OWNER,'saveGarment','new-alias',s.draft,1,j({...s.snapshot,name:'changed'})]),/conflict/);
  await rpc(db,'sc_put_draft',[s.draft,'registration',1,j({...s.snapshot,name:'revision 2'}),'{}',null,null]);
  const event={client_event_id:randomUUID(),occurred_at:'2026-10-13T09:24:00+09:00',input_source:'user_confirmed',garment_ids:[receipt.entity_id],location_json:{label:'행거 B'}};
  await rpc(db,'sc_commit_action',[OWNER,'recordMovementConfirmed',randomUUID(),null,null,j(event)]);
  const repeated=await rpc<any>(db,'sc_commit_action',[OWNER,'saveGarment','new-alias',s.draft,1,j(s.snapshot)]);
  assert.deepEqual(repeated.result,receipt.result);assert.equal(repeated.result.location_json.label,'행거 A');
  const current=await db.query<any>('select * from sc_garments where id=$1',[receipt.entity_id]);assert.equal(current.rows[0].location_json.label,'행거 B');
});

test('invalid child item rolls back outfit, operation and receipt together',async()=>{
  await asRole(db,'authenticated',OWNER);const a=await save(garment('상의'));
  const countBefore={outfits:await adminCount('outfits'),operations:await adminCount('operations'),receipts:await adminCount('operation_receipts')};
  await asRole(db,'authenticated',OWNER);
  const snap={name:'invalid child',items:[{slot:'top',garment_id:a.result.entity_id},{slot:'bottom',garment_id:randomUUID()}]};
  const draft=randomUUID();await rpc(db,'sc_put_draft',[draft,'outfit',0,j(snap),'{}',null,null]);
  await assert.rejects(rpc(db,'sc_commit_action',[OWNER,'saveOutfit',randomUUID(),draft,1,j(snap)]),/unauthorized_target/);
  assert.deepEqual({outfits:await adminCount('outfits'),operations:await adminCount('operations'),receipts:await adminCount('operation_receipts')},countBefore);
});

test('owned and external outfit items remain separate; plan/wear/care/movement remain distinct',async()=>{
  await asRole(db,'authenticated',OWNER);const top=await save(garment('top'));const bottom=await save(garment('bottom','bottom'));
  const externalId=randomUUID();await rpc(db,'sc_put_external_item',[j({id:externalId,source_label:'reference',source_url:'https://example.test/item'})]);
  const snap={name:'조합',items:[{slot:'top',garment_id:top.result.entity_id},{slot:'bottom',garment_id:bottom.result.entity_id},{slot:'bag',external_item_id:externalId}]};
  const outfit=await save(snap as any,'saveOutfit');assert.equal(outfit.result.result.items[2].external_item_id,externalId);
  const base={client_event_id:randomUUID(),occurred_at:'2026-10-13T09:24:00+09:00',input_source:'user_confirmed',garment_ids:[top.result.entity_id,bottom.result.entity_id],outfit_id:outfit.result.entity_id};
  const plan=await rpc<any>(db,'sc_commit_action',[OWNER,'planOutfit','plan-test',null,null,j(base)]);assert.equal(plan.result.kind,'plan');
  const again=await rpc<any>(db,'sc_commit_action',[OWNER,'planOutfit','plan-alias',null,null,j(base)]);assert.equal(again.receipt_id,plan.receipt_id);
  await assert.rejects(rpc(db,'sc_commit_action',[OWNER,'planOutfit','plan-conflict',null,null,j({...base,occurred_at:'2026-10-14T09:24:00+09:00'})]),/conflict/);
  const wear=await rpc<any>(db,'sc_commit_action',[OWNER,'recordWear','wear-test',null,null,j({...base,client_event_id:randomUUID()})]);assert.equal(wear.result.kind,'wear');assert.notEqual(wear.entity_id,plan.entity_id);
  const rows=await db.query<{kind:string}>('select kind from sc_activity_events where outfit_id=$1',[outfit.result.entity_id]);assert.deepEqual(rows.rows.map(r=>r.kind).sort(),['plan','wear']);
});

test('owner isolation, explicit family read/write and revocation, with no asset inheritance',async()=>{
  await asRole(db,'authenticated',OWNER);const s=await save();const gid=s.result.entity_id;
  await asRole(db,'postgres');const household=randomUUID();await db.query("insert into sc_households(id,label) values($1,'test family')",[household]);await db.query('insert into sc_memberships(household_id,profile_id) values($1,$2),($1,$3)',[household,OWNER,OTHER]);
  await asRole(db,'authenticated',OTHER);assert.equal((await db.query('select * from sc_garments where id=$1',[gid])).rows.length,0);
  await asRole(db,'authenticated',OWNER);await rpc(db,'sc_set_resource_grant',['garment',gid,OTHER,true,false,null]);
  await asRole(db,'authenticated',OTHER);assert.equal((await db.query('select * from sc_garments where id=$1',[gid])).rows.length,1);
  const event={client_event_id:randomUUID(),occurred_at:'2026-10-13T09:24:00+09:00',input_source:'user_confirmed',garment_ids:[gid],location_json:{label:'shared shelf'}};
  await assert.rejects(rpc(db,'sc_commit_action',[OWNER,'recordMovementConfirmed','family-move',null,null,j(event)]),/unauthorized_target/);
  await asRole(db,'authenticated',OWNER);await rpc(db,'sc_set_resource_grant',['garment',gid,OTHER,true,true,null]);
  await asRole(db,'authenticated',OTHER);const moved=await rpc<any>(db,'sc_commit_action',[OWNER,'recordMovementConfirmed','family-move',null,null,j(event)]);assert.equal(moved.result.owner_id,OWNER);
  await asRole(db,'authenticated',THIRD);assert.equal((await db.query('select * from sc_garments where id=$1',[gid])).rows.length,0);
  await asRole(db,'authenticated',OWNER);await rpc(db,'sc_set_resource_grant',['garment',gid,OTHER,false,false,null]);
  await asRole(db,'authenticated',OTHER);assert.equal((await db.query('select * from sc_garments where id=$1',[gid])).rows.length,0);
});

test('pending uploads are private, immutable, owner-scoped, and finalize only after verified metadata and object',async()=>{
  await asRole(db,'authenticated',OWNER);const id=randomUUID();const hash='a'.repeat(64);
  const asset=await rpc<any>(db,'sc_prepare_asset',[id,'label','image/png',123,hash,['openai'],null]);assert.equal(asset.status,'pending');
  await assert.rejects(rpc(db,'sc_finalize_asset',[OWNER,id,hash,123,'image/png']),/permission denied/);
  await asRole(db,'service_role');await assert.rejects(rpc(db,'sc_finalize_asset',[OWNER,id,hash,123,'image/png']),/result_unavailable/);
  await asRole(db,'authenticated',OTHER);await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[asset.bucket_id,asset.storage_key]),/row-level security/);
  await asRole(db,'authenticated',OWNER);await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[asset.bucket_id,asset.storage_key]);assert.equal((await db.query('select * from storage.objects where name=$1',[asset.storage_key])).rows.length,1);
  await asRole(db,'service_role');await assert.rejects(rpc(db,'sc_finalize_asset',[OWNER,id,hash,124,'image/png']),/conflict/);await rpc(db,'sc_finalize_asset',[OWNER,id,hash,123,'image/png']);
  await asRole(db,'authenticated',OWNER);assert.equal((await db.query('select * from storage.objects where name=$1',[asset.storage_key])).rows.length,1);
  assert.equal((await db.query('update storage.objects set name=name where name=$1 returning id',[asset.storage_key])).rows.length,0);
  await rpc(db,'sc_put_evidence',[j({id:randomUUID(),asset_id:id,evidence_kind:'label',original_text:'직접 확인할 라벨',observed_at:'2026-10-08T09:00:00+09:00'})]);
  await asRole(db,'authenticated',OTHER);assert.equal((await db.query('select * from storage.objects where name=$1',[asset.storage_key])).rows.length,0);
});

test('budget reservation is atomic, approval gated, reuses uncertain submission, and never reports zero unknown actual',async()=>{
  const a=await approval();const req=jobRequest(a);const first=await rpc<any>(db,'sc_reserve_job',[j(req)]);assert.equal(first.reused,false);
  const repeated=await rpc<any>(db,'sc_reserve_job',[j(req)]);assert.equal(repeated.job_id,first.job_id);assert.equal(repeated.reused,true);
  await assert.rejects(rpc(db,'sc_reserve_job',[j({...req,input_snapshot:{changed:true}})]),/conflict/);
  await assert.rejects(rpc(db,'sc_reserve_job',[j(jobRequest(a))]),/budget_exceeded/);
  const uncertain=await rpc<any>(db,'sc_update_job',[OWNER,first.job_id,j({status:'unknown_submission',error_code:'unknown_submission'})]);assert.equal(uncertain.status,'unknown_submission');
  const recovery=await rpc<any>(db,'sc_reserve_job',[j({...req,intent_key:randomUUID()})]);assert.equal(recovery.job_id,first.job_id);
  const alias=randomUUID();await rpc(db,'sc_reserve_job',[j({...req,intent_key:alias})]);
  await assert.rejects(rpc(db,'sc_reserve_job',[j({...req,intent_key:alias,job_signature:randomUUID()})]),/conflict/);
  const ledger=await rpc<any>(db,'sc_settle_job',[OWNER,first.job_id,j({status:'unsettled'})]);assert.equal(ledger.actual_usd,null);assert.equal(ledger.settlement_status,'unsettled');
  await assert.rejects(rpc(db,'sc_settle_job',[OWNER,first.job_id,j({status:'released',reference:'not evidence'})]),/conflict/);
  await rpc(db,'sc_update_job',[OWNER,first.job_id,j({status:'succeeded',response_id:'fixture-response',result_json:{observations:[]}})]);
  const settled=await rpc<any>(db,'sc_settle_job',[OWNER,first.job_id,j({status:'settled',actual_usd:0.4,actual_units:400,reference:'fixture-usage'})]);assert.equal(Number(settled.actual_usd),0.4);
  await assert.rejects(rpc(db,'sc_settle_job',[OWNER,first.job_id,j({status:'settled',actual_usd:0.3,actual_units:400,reference:'fixture-usage'})]),/conflict/);
});

test('budget total cap, expiry, asset approval and actor ownership are enforced',async()=>{
  const a=await approval({total_usd:1});const first=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(a))]);
  await rpc(db,'sc_update_job',[OWNER,first.job_id,j({status:'succeeded',result_json:{}})]);await rpc(db,'sc_settle_job',[OWNER,first.job_id,j({status:'settled',actual_usd:1,actual_units:1000,reference:'fixture-usage'})]);
  await assert.rejects(rpc(db,'sc_reserve_job',[j(jobRequest(a))]),/budget_exceeded/);
  const b=await approval();await assert.rejects(rpc(db,'sc_reserve_job',[j(jobRequest(b,{actor_id:OTHER}))]),/invalid_input/);
  await assert.rejects(rpc(db,'sc_reserve_job',[j(jobRequest(b,{asset_versions:{[randomUUID()]:1}}))]),/unauthorized_target/);
  const expired=await approval({valid_from:'2025-01-01T00:00:00Z',valid_until:'2025-01-02T00:00:00Z'});await assert.rejects(rpc(db,'sc_reserve_job',[j(jobRequest(expired))]),/approval_required/);
});

test('late job completion keeps original operation snapshot and marks changed draft stale',async()=>{
  await asRole(db,'authenticated',OWNER);const draft=randomUUID();await rpc(db,'sc_put_draft',[draft,'registration',0,j({name:'old'}),'{}',null,null]);
  const a=await approval();const job=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(a,{draft_id:draft,draft_revision:1,input_snapshot:{name:'old'}}))]);
  await asRole(db,'authenticated',OWNER);await rpc(db,'sc_put_draft',[draft,'registration',1,j({name:'edited'}),'{}',null,null]);
  await asRole(db,'service_role');const finished=await rpc<any>(db,'sc_update_job',[OWNER,job.job_id,j({status:'succeeded',application_status:'applied',result_json:{name:'analysis'}})]);assert.equal(finished.application_status,'stale');assert.equal(finished.input_snapshot_json.name,'old');
  await asRole(db,'authenticated',OWNER);const rows=await db.query<any>('select state_json from sc_drafts where id=$1',[draft]);assert.equal(rows.rows[0].state_json.name,'edited');
});

test('realtime lease cannot reset time or exceed reconnect allowance; stopped jobs reject lease',async()=>{
  const a=await approval({provider:'decart',model:'lucy-vton-3.6',action:'startTryOn',max_output_tokens:0,max_generated_seconds:30,max_reconnects:0});
  const end=new Date(Date.now()+29000).toISOString();const first=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(a,{stage:'realtime',unit_kind:'generated_second',reserved_units:30,max_output_tokens:0,max_generated_seconds:30,absolute_end_at:end}))]);
  const lease=await rpc<any>(db,'sc_issue_realtime_lease',[OWNER,first.job_id,10]);assert.equal(lease.token_issue_count,1);
  await assert.rejects(rpc(db,'sc_issue_realtime_lease',[OWNER,first.job_id,10]),/budget_exceeded/);
  await rpc(db,'sc_update_job',[OWNER,first.job_id,j({status:'cancelled'})]);await assert.rejects(rpc(db,'sc_issue_realtime_lease',[OWNER,first.job_id,1]),/approval_required/);
});

test('agent tool results are durable per call, reject forged targets/tools and preserve event key',async()=>{
  const a=await approval({action:'generateOutfits'});const job=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(a,{stage:'agent'}))]);
  await rpc(db,'sc_update_job',[OWNER,job.job_id,j({status:'running',session_id:'fixture-session',turn_id:'fixture-turn'})]);
  const args=[OWNER,job.job_id,'fixture-session','fixture-turn','call-1','get_wardrobe_items','hash-1',j({items:[]}),'event-key'];
  const first=await rpc<any>(db,'sc_record_tool_call',args);const repeated=await rpc<any>(db,'sc_record_tool_call',[...args.slice(0,7),j({items:['late']}),'different-event-key']);assert.deepEqual(repeated,first);
  await assert.rejects(rpc(db,'sc_record_tool_call',[OWNER,job.job_id,'fixture-session','fixture-turn','call-1','get_wardrobe_items','hash-2','{}','event-key']),/conflict/);
  await assert.rejects(rpc(db,'sc_record_tool_call',[OWNER,job.job_id,'fixture-session','fixture-turn','call-2','execute_sql','hash','{}','event-key']),/invalid_input/);
  for(let i=2;i<=8;i++) await rpc(db,'sc_record_tool_call',[OWNER,job.job_id,'fixture-session','fixture-turn',`call-${i}`,'get_wardrobe_items',`hash-${i}`,'{}',`event-${i}`]);
  await assert.rejects(rpc(db,'sc_record_tool_call',[OWNER,job.job_id,'fixture-session','fixture-turn','call-9','get_wardrobe_items','hash-9','{}','event-9']),/budget_exceeded/);
  assert.deepEqual(await rpc(db,'sc_record_tool_call',args),first);
  await rpc(db,'sc_update_job',[OWNER,job.job_id,j({status:'cancelled'})]);
});

test('SQL ownership/version foreign keys independently reject cross-profile children',async()=>{
  await asRole(db,'authenticated',OWNER);const s=await save();
  await asRole(db,'postgres');
  await assert.rejects(db.query("insert into sc_evidence_items(owner_id,garment_id,evidence_kind,original_text,observed_at) values($1,$2,'user_observation','forged',now())",[OTHER,s.result.entity_id]),/foreign key constraint/);
  await assert.rejects(db.query("insert into sc_drafts(id,owner_id,kind,revision,input_asset_id,input_asset_version,state_json) values($1,$2,'registration',1,$3,99,'{}')",[randomUUID(),OWNER,randomUUID()]),/foreign key constraint/);
});

test('draft optimistic concurrency, rapid repeated save and foreign owner target are guarded',async()=>{
  await asRole(db,'authenticated',OWNER);const draft=randomUUID();const snapshot=garment('rapid');await rpc(db,'sc_put_draft',[draft,'registration',0,j(snapshot),'{}',null,null]);
  // PGlite serializes the SQL connection. This verifies repeated submissions, not multi-connection contention.
  const [a,b]=await Promise.all([rpc<any>(db,'sc_commit_action',[OWNER,'saveGarment','rapid-a',draft,1,j(snapshot)]),rpc<any>(db,'sc_commit_action',[OWNER,'saveGarment','rapid-b',draft,1,j(snapshot)])]);assert.equal(a.receipt_id,b.receipt_id);
  await assert.rejects(rpc(db,'sc_put_draft',[draft,'registration',0,j(snapshot),'{}',null,null]),/stale_revision/);
  await asRole(db,'authenticated',OTHER);await assert.rejects(rpc(db,'sc_put_draft',[draft,'registration',1,j(snapshot),'{}',null,null]),/unauthorized_target/);
  await assert.rejects(rpc(db,'sc_commit_action',[OWNER,'saveGarment','foreign-target',draft,1,j(snapshot)]),/unauthorized_target/);
});

test('generated files are separate private assets tied to a live owner job; client cannot forge provider success',async()=>{
  const a=await approval();const job=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(a))]);
  await rpc(db,'sc_update_job',[OWNER,job.job_id,j({status:'running',response_id:'generated-fixture-response'})]);
  const id=randomUUID();const hash='b'.repeat(64);
  const asset=await rpc<any>(db,'sc_prepare_generated_asset',[OWNER,job.job_id,id,'card','image/png',100,hash]);assert.equal(asset.provenance,'provider_result');assert.equal(asset.created_by_job_id,job.job_id);assert.deepEqual(asset.allowed_providers,[]);
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[asset.bucket_id,asset.storage_key]);
  await rpc(db,'sc_finalize_asset',[OWNER,id,hash,100,'image/png']);await rpc(db,'sc_update_job',[OWNER,job.job_id,j({status:'succeeded',result_ref:id,application_status:'not_applied'})]);
  await asRole(db,'authenticated',OWNER);await assert.rejects(rpc(db,'sc_update_job',[OWNER,job.job_id,j({status:'succeeded'})]),/permission denied/);
  await asRole(db,'authenticated',OTHER);assert.equal((await db.query('select * from sc_assets where id=$1',[id])).rows.length,0);
  await asRole(db,'postgres');await assert.rejects(db.query("update sc_ai_jobs set mode='mock' where id=$1",[job.job_id]),/check constraint/);
});

test('realtime reconnect cannot overlap a still-valid lease even when reconnect allowance remains',async()=>{
  const a=await approval({provider:'decart',model:'lucy-vton-3.6',action:'startTryOn',max_output_tokens:0,max_generated_seconds:30,max_reconnects:2});
  const job=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(a,{stage:'realtime',unit_kind:'generated_second',reserved_units:30,max_output_tokens:0,max_generated_seconds:30,absolute_end_at:new Date(Date.now()+29000).toISOString()}))]);
  await rpc(db,'sc_issue_realtime_lease',[OWNER,job.job_id,10]);
  await assert.rejects(rpc(db,'sc_issue_realtime_lease',[OWNER,job.job_id,5]),/budget_exceeded/);
  await asRole(db,'postgres');await db.query("update sc_ai_jobs set lease_active_until=now()-interval '1 second' where id=$1",[job.job_id]);
  await asRole(db,'service_role');await assert.rejects(rpc(db,'sc_issue_realtime_lease',[OWNER,job.job_id,21]),/budget_exceeded/);
  const lease=await rpc<any>(db,'sc_issue_realtime_lease',[OWNER,job.job_id,5]);assert.equal(lease.token_issue_count,2);
  await rpc(db,'sc_update_job',[OWNER,job.job_id,j({status:'cancelled'})]);
});

test('remote verification SQL rolls back all temporary Auth/profile/draft fixtures',async()=>{
  await asRole(db,'postgres');
  const results=await db.exec(await readFile('supabase/tests/remote_validation.sql','utf8'));
  const residual=results.at(-1)?.rows[0];
  assert.deepEqual(residual,{residual_auth_fixtures:0,residual_profile_fixtures:0,residual_draft_fixtures:0});
});

test('remote family and private Storage validation leaves no catalog fixtures after rollback',async()=>{
  await asRole(db,'postgres');
  const results=await db.exec(await readFile('supabase/tests/remote_access_validation.sql','utf8'));
  assert.deepEqual(results.at(-1)?.rows[0],{residual_auth_fixtures:0,residual_profile_fixtures:0,residual_household_fixtures:0,residual_asset_fixtures:0,residual_storage_fixtures:0});
});

test('recorded applied migration copies remain byte-identical to their reviewed SQL sources',async()=>{
  const manifest=JSON.parse(await readFile('supabase/migration-manifest.json','utf8')) as {source:string;migration:string;sha256:string;target:string}[];
  assert.ok(manifest.length>=5);
  for(const entry of manifest){
    assert.equal(entry.target,'slxgcgtnxkchxywgsmuk');
    const source=await readFile(entry.source),migration=await readFile(entry.migration);
    assert.deepEqual(source,migration);assert.equal(createHash('sha256').update(source).digest('hex'),entry.sha256);
  }
});

test('one active paid job per owner spans approvals/actions; replay and other owners remain independent',async()=>{
  const a=await approval({max_concurrency:4});const b=await approval({action:'analyzeStyleReference',max_concurrency:4});
  const firstRequest=jobRequest(a);const first=await rpc<any>(db,'sc_reserve_job',[j(firstRequest)]);
  const replay=await rpc<any>(db,'sc_reserve_job',[j({...firstRequest,intent_key:randomUUID()})]);assert.equal(replay.job_id,first.job_id);
  await assert.rejects(rpc(db,'sc_reserve_job',[j(jobRequest(b))]),/budget_exceeded/);
  await rpc(db,'sc_update_job',[OWNER,first.job_id,j({status:'unknown_submission'})]);
  await assert.rejects(rpc(db,'sc_reserve_job',[j(jobRequest(b))]),/budget_exceeded/);
  const otherApproval=await approval({owner_id:OTHER});
  const other=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(otherApproval,{owner_id:OTHER,actor_id:OTHER}))]);assert.ok(other.job_id);
  await rpc(db,'sc_update_job',[OTHER,other.job_id,j({status:'cancelled'})]);
  await rpc(db,'sc_update_job',[OWNER,first.job_id,j({status:'cancelled'})]);
  const next=await rpc<any>(db,'sc_reserve_job',[j(jobRequest(b))]);assert.equal(next.reused,false);await rpc(db,'sc_update_job',[OWNER,next.job_id,j({status:'cancelled'})]);
});

test('soft discard requires own exact revision and preserves committed entities and receipt replay',async()=>{
  await asRole(db,'authenticated',OWNER);const s=await save(garment('preserved saved entity'));
  await assert.rejects(rpc(db,'sc_discard_draft',[s.draft,2]),/stale_revision/);
  await asRole(db,'authenticated',OTHER);await assert.rejects(rpc(db,'sc_discard_draft',[s.draft,1]),/unauthorized_target/);
  await asRole(db,'authenticated',OWNER);const discarded=await rpc<any>(db,'sc_discard_draft',[s.draft,1]);assert.equal(discarded.status,'discarded');assert.equal(discarded.revision,1);
  assert.deepEqual(await rpc(db,'sc_discard_draft',[s.draft,1]),discarded);
  const replay=await rpc<any>(db,'sc_commit_action',[OWNER,'saveGarment','after-soft-discard',s.draft,1,j(s.snapshot)]);assert.equal(replay.receipt_id,s.result.receipt_id);assert.deepEqual(replay.result,s.result.result);
  await assert.rejects(rpc(db,'sc_put_draft',[s.draft,'registration',1,j(garment('late request must not revive draft')),'{}',null,null]),/conflict/);
  assert.equal((await db.query<{status:string}>('select status from sc_drafts where id=$1',[s.draft])).rows[0].status,'discarded');
  const next=await save(garment('new registration'));assert.notEqual(next.draft,s.draft);assert.notEqual(next.result.entity_id,s.result.entity_id);
  assert.equal((await db.query('select * from sc_garments where id=$1',[s.result.entity_id])).rows.length,1);
  const editing=randomUUID();await rpc(db,'sc_put_draft',[editing,'registration',0,j(garment('cancel before save')),'{}',null,null]);await rpc(db,'sc_discard_draft',[editing,1]);
  await assert.rejects(rpc(db,'sc_commit_action',[OWNER,'saveGarment','discarded-uncommitted',editing,1,j(garment('cancel before save'))]),/conflict/);
  await asRole(db,'anon');await assert.rejects(rpc(db,'sc_discard_draft',[s.draft,1]),/permission denied/);
});

test('006 remote regression script leaves no synthetic approval/job/budget/Auth fixtures',async()=>{
  await asRole(db,'postgres');
  const results=await db.exec(await readFile('supabase/tests/remote_006_validation.sql','utf8'));
  assert.deepEqual(results.at(-1)?.rows[0],{residual_auth_fixtures:0,residual_profile_fixtures:0,residual_job_fixtures:0,residual_ledger_fixtures:0,residual_approval_fixtures:0});
});
