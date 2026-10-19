import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';
import { AiService, EXECUTION_BOUNDS, type AiRequest } from '../server/ai';
import { SupabaseGateway, type FetchPort } from '../server/supabase';
import { DatabaseRepository } from '../server/repository';
import { AppError } from '../server/errors';
import { inspectMedia } from '../server/media';
import type { ServerConfig } from '../server/config';
import type { OutfitDraft, RegistrationDraft } from '../src/core/types';
import type { ProviderFetch } from '../server/providers';
import { asRole, createTestDatabase, OWNER, OTHER, rpc } from './db-harness';

// PostgreSQL/RLS/RPCs are real local PGlite. Only HTTP and object bytes are fixtures.
let db: PGlite, gateway: SupabaseGateway, repo: DatabaseRepository;
const objects = new Map<string, Buffer>();
const config: ServerConfig = { origin:'http://127.0.0.1:4311',port:4312,supabaseUrl:'https://fixture.invalid',publishableKey:'fixture-public',serverKey:'fixture-server',openaiKey:'fixture-openai',decartKey:'fixture-decart',liveEnabled:true,aiMode:'live' };
const json = (value: unknown, status=200) => new Response(JSON.stringify(value), {status,headers:{'content-type':'application/json'}});
const safeName = (s:string) => { assert.match(s,/^[a-z_][a-z_0-9]*$/); return s; };
const arg = (v:unknown) => v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
let serial: Promise<unknown> = Promise.resolve();
const localDatabase: FetchPort = (url, init) => {
  const work = serial.then(async () => {
    const u = new URL(url), headers = new Headers(init.headers), service = headers.get('apikey') === 'fixture-server';
    await asRole(db, service ? 'service_role' : 'authenticated', service ? undefined : OWNER);
    try {
      if (u.pathname.startsWith('/rest/v1/rpc/')) {
        const name = safeName(u.pathname.split('/').at(-1)!), body = JSON.parse(String(init.body));
        const entries = Object.entries(body), params = entries.map(([key],i)=>`${safeName(key)}=>$${i+1}`).join(',');
        const row = await db.query<{result:unknown}>(`select public.${name}(${params}) result`,entries.map(([,v])=>arg(v)));
        return json(row.rows[0].result);
      }
      if (u.pathname.startsWith('/rest/v1/')) {
        const table = safeName(u.pathname.split('/').at(-1)!), params:unknown[]=[], where:string[]=[];
        const columns = (u.searchParams.get('select') ?? '*').split(',').map(x=>x==='*'?'*':safeName(x)).join(',');
        for (const [key,value] of u.searchParams) if (!['select','limit','order'].includes(key)) {
          assert.ok(value.startsWith('eq.')); params.push(value.slice(3)); const column=key==='snapshot_json->_client->>revision'?"snapshot_json->'_client'->>'revision'":safeName(key);where.push(`${column}=$${params.length}`);
        }
        const limit = Number(u.searchParams.get('limit')??1000); assert.ok(Number.isInteger(limit)&&limit<=1000);
        const rows = await db.query(`select ${columns} from public.${table}${where.length?' where '+where.join(' and '):''} limit ${limit}`,params);
        return json(rows.rows);
      }
      if (u.pathname.startsWith('/storage/v1/object/')) {
        const key=u.pathname.replace('/storage/v1/object/','').replace(/^authenticated\//,'');
        const slash=key.indexOf('/'),bucket=key.slice(0,slash),name=key.slice(slash+1);
        if(init.method==='POST') { await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,name]);objects.set(key,Buffer.from(init.body as Uint8Array));return json({uploaded:true}); }
        const visible=await db.query('select id from storage.objects where bucket_id=$1 and name=$2',[bucket,name]);
        if(!visible.rows.length||!objects.has(key))return json({},404);
        return new Response(new Uint8Array(objects.get(key)!),{headers:{'content-type':'application/octet-stream'}});
      }
      throw new Error('Unimplemented local fixture path');
    } catch(e) { return json({message:e instanceof Error?e.message:'fixture error',code:(e as {code?:string})?.code??''},400); }
  });
  serial=work.catch(()=>undefined);return work;
};
before(async()=>{db=await createTestDatabase();gateway=new SupabaseGateway(config,localDatabase);repo=new DatabaseRepository(gateway,{id:OWNER,token:'fixture-jwt'});});
after(async()=>{await serial;await db?.close();});
afterEach(async()=>{
  // Local fixture teardown only: end this case's simulated work before the next
  // case exercises the owner-wide live concurrency cap. No provider is contacted.
  const rows=await gateway.rows(repo.user,'sc_ai_jobs','select=*');
  for(const row of rows)if(['reserved','submitted','running','unknown_submission'].includes(String(row.status)))await gateway.control('sc_update_job',{p_owner_id:OWNER,p_job_id:row.id,p_patch:{status:'failed',error_code:'fixture_teardown'}});
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmLcAAAAASUVORK5CYII=','base64');
async function asset(kind='garment',bytes:Buffer=png,mime='image/png',providers=['openai','decart']) {
  const id=randomUUID(),media=inspectMedia(bytes,mime);await asRole(db,'authenticated',OWNER);
  const row=await rpc<any>(db,'sc_prepare_asset',[id,kind,mime,bytes.length,media.sha256,providers,null]);
  await repo.upload(id,bytes,mime);await repo.finalize(id);return {...row,status:'finalized'};
}
async function approval(action:string,model:string,versions:Record<string,number>,changes:Record<string,unknown>={}) {
  const a={id:randomUUID(),owner_id:OWNER,provider:action==='startTryOn'?'decart':'openai',action,model,allowed_asset_versions:versions,currency:'USD',per_request_usd:6,total_usd:20,max_output_tokens:1800,max_generated_seconds:30,max_concurrency:1,max_attempts:4,max_reconnects:0,valid_from:new Date(Date.now()-60000).toISOString(),valid_until:new Date(Date.now()+3600000).toISOString(),approval_reference:'LOCAL TEST ONLY - not user authorization',...changes};
  await gateway.control('sc_sync_execution_approval',{p_approval:a});return a;
}
function registration(a:any):RegistrationDraft {return{draftId:randomUUID(),ownerId:OWNER,revision:1,asset:{id:a.id,version:1,source:'storage',url:null},name:'manual name',category:'top',color:'',material:'',features:[],size:'',location:'',careNotes:'',provenance:{location:'unconfirmed',size:'unconfirmed',care:'unconfirmed'},manualFields:{name:true}};}
const analysis={observations:{name:'provider name',category:'top',color:'red',material:null},label_text:null,evidence:[{field:'color',observation:'red pixels'}],unknown_fields:['material']};
const responsePayload=()=>({id:'resp_fixture_'+randomUUID(),status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(analysis)}]}],usage:{input_tokens:30,output_tokens:20}});
const code=(expected:string)=>(e:unknown)=>e instanceof AppError&&e.code===expected;
const contract=(fetch:ProviderFetch,c=config)=>AiService.forContractTests(c,repo,fetch,async()=>({durationSeconds:1,codec:'h264',width:1280,height:720,inspected:true}));
async function job(id:string){return (await gateway.rows(repo.user,'sc_ai_jobs',`operation_id=eq.${id}&select=*`))[0];}

test('AI gates never dispatch with hold, missing key, missing/expired approval or unapproved asset',async()=>{
  const a=await asset(),draft=registration(a),request:AiRequest={action:'analyzeRegistration',intentKey:randomUUID(),draft};let calls=0;
  const transport:ProviderFetch=async()=>{calls++;return json(responsePayload());};
  await assert.rejects(contract(transport,{...config,liveEnabled:false}).execute(request),code('approval_required'));
  await assert.rejects(contract(transport,{...config,openaiKey:''}).execute(request),code('configuration_required'));
  await assert.rejects(contract(transport).execute(request),code('approval_required'));
  await approval('analyzeRegistration','gpt-6.1-sol',{[a.id]:1},{valid_from:'2025-01-01T00:00:00Z',valid_until:'2025-01-02T00:00:00Z'});
  await assert.rejects(contract(transport).execute(request),code('approval_required'));
  const denied=await asset('garment',png,'image/png',[]);await assert.rejects(approval('analyzeRegistration','gpt-6.1-sol',{[denied.id]:1}),code('unauthorized_target'));
  await assert.rejects(contract(transport).execute({...request,draft:registration(denied)}),code('approval_required'));assert.equal(calls,0);
});

test('Responses reserves conservative bound, stores accepted ID and result, reloads, then reuses without paid POST',async()=>{
  const a=await asset(),draft=registration(a);await approval('analyzeRegistration','gpt-6.1-sol',{[a.id]:1});let calls=0;
  const service=contract(async()=>{calls++;return json(responsePayload());});
  const request:AiRequest={action:'analyzeRegistration',intentKey:randomUUID(),draft};
  const result=await service.execute(request),stored=await job(result.operation_id);
  assert.equal(stored.status,'succeeded');assert.match(String(stored.response_id),/^resp_fixture_/);assert.equal((result.result as any).observations.name,null);
  const ledger=(await gateway.rows(repo.user,'sc_budget_ledger',`job_id=eq.${stored.id}&select=*`))[0];
  assert.equal(Number(ledger.reserved_usd),EXECUTION_BOUNDS.analyzeRegistration.reservedUsd);assert.equal(ledger.actual_usd,null);assert.equal(ledger.settlement_status,'unsettled');
  const restored=await new AiService(config,repo,async()=>{throw Error('must not fetch');}).operation(result.operation_id);assert.deepEqual(restored.result,result.result);
  const cached=await service.execute({...request,intentKey:randomUUID()},'saved_result');assert.deepEqual(cached.result,result.result);
  const repeated=await service.execute({...request,intentKey:randomUUID()});assert.equal(repeated.operation_id,result.operation_id);assert.equal(calls,1);
  await assert.rejects(service.execute({...request,draft:{...draft,revision:2,color:'edited'}},'saved_result'),code('result_unavailable'));
  const current=await repo.state();assert.equal(current.registrationDrafts[OWNER].name,'manual name');assert.equal(current.registrationDrafts[OWNER].color,'edited');
});

test('Unknown paid submission persists reservation and exact retry never creates another provider request',async()=>{
  const a=await asset(),draft=registration(a);await approval('analyzeRegistration','gpt-6.1-sol',{[a.id]:1});let calls=0;
  const service=contract(async()=>{calls++;throw Error('lost acknowledgment');});const request:AiRequest={action:'analyzeRegistration',intentKey:randomUUID(),draft};
  await assert.rejects(service.execute(request),code('unknown_submission'));
  const replay=await service.execute(request);assert.equal(replay.processing_status,'unknown_submission');assert.equal(calls,1);
  const row=await job(replay.operation_id),ledger=(await gateway.rows(repo.user,'sc_budget_ledger',`job_id=eq.${row.id}&select=*`))[0];assert.equal(ledger.actual_usd,null);assert.equal(ledger.settlement_status,'unsettled');
});

test('Decisions route maps to SQL classifyRegistration and uses Decisions-only reservation',async()=>{
  const a=await asset(),draft=registration(a);await approval('classifyRegistration','gpt-6-luna',{[a.id]:1});
  const service=contract(async(url)=>{assert.ok(url.endsWith('/v1/decisions'));return json({id:'decision_fixture',answers:[{name:'visible_garment',type:'predicate',probability:.95},{name:'target_count',type:'choice',choice:'one',confidence:.95},{name:'visibility',type:'score',score:1.9,confidence:.95}]});});
  const result=await service.execute({action:'evaluatePhoto',intentKey:randomUUID(),draft});assert.equal((result.result as any).analyzable,true);
  const row=await job(result.operation_id),op=await gateway.one(repo.user,'sc_operations',result.operation_id);assert.equal(op.action,'classifyRegistration');
  const ledger=(await gateway.rows(repo.user,'sc_budget_ledger',`job_id=eq.${row.id}&select=*`))[0];assert.equal(Number(ledger.reserved_usd),.20284);
});

test('Malformed Decisions answers still retain accepted ID and unsettled reservation in PostgreSQL',async()=>{
  const a=await asset(),draft=registration(a);await approval('classifyRegistration','gpt-6-luna',{[a.id]:1});let calls=0;
  const service=contract(async()=>{calls++;return json({id:'decision_malformed_sql',answers:[]});});
  const request:AiRequest={action:'evaluatePhoto',intentKey:randomUUID(),draft};
  await assert.rejects(service.execute(request),code('provider_failed'));
  const operations=await gateway.rows(repo.user,'sc_operations',`draft_id=eq.${draft.draftId}&select=*`),row=await job(String(operations[0].id));
  assert.equal(row.response_id,'decision_malformed_sql');assert.equal(row.status,'failed');
  const ledger=(await gateway.rows(repo.user,'sc_budget_ledger',`job_id=eq.${row.id}&select=*`))[0];assert.equal(ledger.settlement_status,'unsettled');assert.equal(ledger.actual_usd,null);
  const replay=await service.execute(request);assert.equal(replay.processing_status,'failed');assert.equal(calls,1);
});

test('Runtime Agents and realtime remain blocked even with keys; fixture agent uses durable journal and later turn outcome',async()=>{
  let calls=0,toolResults=0,complete=false;const garment=await repo.save('saveGarment',{...registration(await asset()),asset:null},randomUUID());
  const gid=garment.entity.id,draft:OutfitDraft={draftId:randomUUID(),ownerId:OWNER,revision:1,name:'fixture outfit',items:{top:gid},topLocked:true};
  const request:AiRequest={action:'generateOutfits',intentKey:randomUUID(),draft};await approval('generateOutfits','gpt-6-astra',{});
  const transport:ProviderFetch=async(url,init)=>{calls++;
    if(url.endsWith('/sessions')&&init.method==='POST')return json({id:'session_fixture',status:'in_progress',required_actions:[]});
    if(url.endsWith('/events')){const body=JSON.parse(String(init.body));if(body.events[0].type==='agent.session.input.tool_result'){toolResults++;assert.equal(body.events[0].success,true);assert.equal(JSON.parse(body.events[0].output)[0].id,gid);}return new Response(null,{status:202});}
    if(url.includes('/turns'))return json({data:[{id:'turn_fixture',status:complete?'completed':'in_progress',subagent_id:null}],has_more:false});
    if(url.includes('/items'))return json({data:[{type:'message',role:'assistant',turn_id:'turn_fixture',content:[{type:'output_text',text:JSON.stringify({kind:'proposal',items:[{slot:'top',garment_id:gid}],explanation:'fixture',evidence_ids:[],unknown_fields:[]})}]}],has_more:false});
    return json({id:'session_fixture',status:complete?'idle':'requires_action',required_actions:complete?[]:[{type:'function_call',turn_id:'turn_fixture',call_id:'call_fixture',name:'get_wardrobe_items',arguments:{query:'manual'}}]});
  };
  await assert.rejects(new AiService(config,repo,transport).execute(request),code('approval_required'));
  await assert.rejects(new AiService(config,repo,transport).execute({action:'startTryOn',intentKey:randomUUID(),fittingMode:'realtime'}),code('approval_required'));assert.equal(calls,0);
  const start=await contract(transport).execute(request);assert.equal(start.processing_status,'running');
  await contract(transport).recoverAgent(start.operation_id);await contract(transport).recoverAgent(start.operation_id);
  const row=await job(start.operation_id),journal=await gateway.rows(repo.user,'sc_job_tool_calls',`job_id=eq.${row.id}&select=*`);assert.equal(journal.length,1);assert.equal(toolResults,2);assert.equal(journal[0].call_id,'call_fixture');
  complete=true;const end=await contract(transport).recoverAgent(start.operation_id);assert.equal((end as any).processing_status,'completed');assert.equal((await job(start.operation_id)).status,'succeeded');assert.equal((end as any).result.kind,'needs_information');assert.deepEqual((end as any).result.items,[]);assert.ok((end as any).result.unknown_fields.includes(`availability:${gid}`));
});

test('Agent cancellation stays unconfirmed until terminal turn and recovery never resumes cancelled work',async()=>{
  let eventPosts=0;await approval('requestCareGuide','gpt-6-astra',{});
  const transport:ProviderFetch=async(url,init)=>{if(url.endsWith('/events')){eventPosts++;assert.equal(JSON.parse(String(init.body)).events[0].type,'agent.session.input.cancel');return new Response(null,{status:202});}if(url.endsWith('/sessions')&&init.method==='POST')return json({id:'session_cancel',status:'in_progress'});if(url.includes('/turns'))return json({data:[{id:'turn_cancel',status:'in_progress'}],has_more:false});return json({id:'session_cancel',status:'requires_action',required_actions:[{type:'function_call',turn_id:'turn_cancel',call_id:'call_cancel',name:'get_wardrobe_items',arguments:{}}]});};
  const start=await contract(transport).execute({action:'requestCareGuide',intentKey:randomUUID()});const stopped=await contract(transport).stop(start.operation_id);assert.equal(stopped.terminal_confirmed,false);
  const restored=await contract(transport).recoverAgent(start.operation_id);assert.equal((restored as any).cancellation_requested,true);assert.equal(eventPosts,1);
});

test('Batch polling completion stays running until validated file is stored/finalized and later content uses storage',async()=>{
  const bytes=await readFile(new URL('./fixtures/synthetic-color.mp4',import.meta.url));
  const person=await asset('person_video',bytes,'video/mp4'),reference=await asset('outfit_reference');await approval('startTryOn','lucy-vton-3.6',{[person.id]:1,[reference.id]:1});let creates=0,downloads=0;
  const transport:ProviderFetch=async(url,init)=>{if(init.method==='POST'){creates++;return json({job_id:'decart_fixture',status:'pending'});}if(url.endsWith('/content')){downloads++;return new Response(new Uint8Array(bytes),{headers:{'content-type':'video/mp4'}});}return json({job_id:'decart_fixture',status:'completed'});};
  const service=contract(transport),start=await service.execute({action:'startTryOn',intentKey:randomUUID(),personAssetId:person.id,referenceAssetId:reference.id,fittingMode:'batch'});
  assert.equal(start.processing_status,'running');const polled=await service.batchStatus(start.operation_id);assert.equal(polled.processing_status,'running');assert.equal(polled.file_status,'not_acquired');
  const blob=await service.batchContent(start.operation_id);assert.equal(blob.size,bytes.length);const row=await job(start.operation_id);assert.equal(row.status,'succeeded');assert.ok(row.result_ref);
  const resultAsset=await repo.asset(String(row.result_ref));assert.equal(resultAsset.provenance,'provider_result');assert.equal(resultAsset.created_by_job_id,row.id);
  await contract(transport).batchContent(start.operation_id);assert.equal(creates,1);assert.equal(downloads,1);assert.deepEqual((await repo.bytes(String(row.result_ref))).bytes,bytes);
});

test('Owner tool scope excludes private assets and ordinary saved operations reload their receipt',async()=>{
  const saved=await repo.save('saveGarment',{...registration(await asset()),asset:null},randomUUID()),gid=saved.entity.id;
  const service=contract(async()=>{throw Error('no provider expected');});
  const handlers=await service.readTools({action:'requestCareGuide',intentKey:'fixture'},{task:'care',context:{},allowedGarmentIds:[gid],allowedEvidenceIds:[]});
  assert.deepEqual(await handlers.get_care_evidence({garment_id:gid}),{status:'unavailable'});
  await assert.rejects(handlers.get_garment_context({garment_id:OTHER}),code('unauthorized_target'));
  const listed=await handlers.get_wardrobe_items({});assert.equal(JSON.stringify(listed).includes('storage_key'),false);assert.equal(JSON.stringify(listed).includes('allowed_providers'),false);
  const receipts=await gateway.rows(repo.user,'sc_operation_receipts',`id=eq.${saved.receipt.id}&select=*`);const loaded=await service.operation(String(receipts[0].operation_id));assert.equal(loaded.job_id,null);assert.equal((loaded.result as any).id,gid);
});

test('Realtime fixture token preserves original job deadline while TTL and session stay inside the lease',async()=>{
  const bytes=await readFile(new URL('./fixtures/synthetic-color.mp4',import.meta.url));
  const person=await asset('person_video',bytes,'video/mp4'),reference=await asset('outfit_reference');await approval('startTryOn','lucy-vton-3.6',{[person.id]:1,[reference.id]:1});
  let tokenCalls=0,tokenBody:any,issuedAt=0;
  const transport:ProviderFetch=async(url,init)=>{assert.ok(url.endsWith('/v1/client/tokens'));tokenCalls++;tokenBody=JSON.parse(String(init.body));issuedAt=Date.now();return json({apiKey:'fixture-ephemeral-only',expiresAt:new Date(issuedAt+tokenBody.expiresIn*1000).toISOString()});};
  const service=contract(transport),start=await service.execute({action:'startTryOn',intentKey:randomUUID(),personAssetId:person.id,referenceAssetId:reference.id,fittingMode:'realtime'});
  assert.equal(tokenCalls,0);const originalEnd=Date.parse(String((await job(start.operation_id)).absolute_end_at));
  const token=await service.token(start.operation_id);assert.equal(token.absoluteEndMs,originalEnd);assert.ok(tokenBody.constraints.realtime.maxSessionDuration>=10);
  const row=await job(start.operation_id),leaseEnd=Date.parse(String(row.lease_active_until));
  assert.ok(issuedAt+(tokenBody.expiresIn+tokenBody.constraints.realtime.maxSessionDuration)*1000<=leaseEnd);
  await assert.rejects(service.token(start.operation_id),code('budget_exceeded'));assert.equal(tokenCalls,1);
  const stopped=await service.stop(start.operation_id);assert.equal(stopped.terminal_confirmed,false);await assert.rejects(service.token(start.operation_id),code('invalid_input'));assert.equal(tokenCalls,1);
});

test('Explicit style analysis preserves registration and read tool consumes only the matching stored reference version',async()=>{
  const original=registration(await asset());await repo.putDraft(original);
  const ref=await asset('style_reference'),other=await asset('style_reference');await approval('analyzeStyleReference','gpt-6.1-sol',{[ref.id]:1});let calls=0;
  const style={kind:'style_observation',colors:['cream'],silhouettes:['wide-leg'],layers:[],style_keywords:['casual'],observed_items:[{slot:'bottom',description:'loose charcoal trousers'}],unknown_fields:['material']};
  const transport:ProviderFetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init.body));assert.equal(body.text.format.name,'style_observation_v1');return json({id:'resp_style_sql',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(style)}]}]});};
  const service=contract(transport),scope={task:'adapt_style' as const,context:{},allowedGarmentIds:[],allowedEvidenceIds:[]};
  const tools=await service.readTools({action:'adaptStyleToWardrobe',intentKey:'fixture',referenceAssetId:ref.id},scope);
  assert.equal((await tools.get_style_reference({asset_id:ref.id}) as any).visual_features,'unavailable');assert.equal(calls,0);
  const request:AiRequest={action:'analyzeStyleReference',intentKey:randomUUID(),referenceAssetId:ref.id};
  const result=await service.execute(request);assert.deepEqual(result.result,style);
  const row=await job(result.operation_id),op=await gateway.one(repo.user,'sc_operations',result.operation_id);assert.equal(op.draft_id,null);assert.equal(op.action,'analyzeStyleReference');assert.equal(row.response_id,'resp_style_sql');
  const ledger=(await gateway.rows(repo.user,'sc_budget_ledger',`job_id=eq.${row.id}&select=*`))[0];assert.equal(Number(ledger.reserved_usd),5.1007);
  const read=await tools.get_style_reference({asset_id:ref.id}) as any;assert.deepEqual(read.visual_features,style);assert.equal(read.source_job_id,row.id);
  await assert.rejects(tools.get_style_reference({asset_id:other.id}),code('unauthorized_target'));
  const unmatched=await service.readTools({action:'adaptStyleToWardrobe',intentKey:'fixture',referenceAssetId:other.id},scope);assert.equal((await unmatched.get_style_reference({asset_id:other.id}) as any).visual_features,'unavailable');
  assert.deepEqual((await service.execute({...request,intentKey:randomUUID()},'saved_result')).result,style);assert.equal(calls,1);
  const current=(await repo.state()).registrationDrafts[OWNER];assert.equal(current.draftId,original.draftId);assert.equal(current.asset?.id,original.asset?.id);
});

test('Independent label OCR preserves garment draft/photo and does not promote proposed text into evidence',async()=>{
  const original=registration(await asset());await repo.putDraft(original);const label=await asset('label');await approval('analyzeRegistration','gpt-6.1-sol',{[label.id]:1});
  const before=(await gateway.rows(repo.user,'sc_evidence_items','select=*')).length;let calls=0;
  const service=contract(async(_url,init)=>{calls++;const body=JSON.parse(String(init.body)),input=JSON.parse(body.input[0].content[0].text);assert.equal(input.kind,'label');assert.deepEqual(input.protected_manual_fields,[]);return json({id:'resp_label_sql',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...analysis,label_text:'Hand wash cold',evidence:[{field:'label_text',observation:'visible printed label'}]})}]}]});});
  const result=await service.execute({action:'analyzeRegistration',intentKey:randomUUID(),referenceAssetId:label.id});assert.equal((result.result as any).label_text,'Hand wash cold');assert.ok(result.job_id);
  const op=await gateway.one(repo.user,'sc_operations',result.operation_id);assert.equal(op.draft_id,null);assert.equal((await gateway.rows(repo.user,'sc_evidence_items','select=*')).length,before);
  const current=(await repo.state()).registrationDrafts[OWNER];assert.equal(current.draftId,original.draftId);assert.equal(current.asset?.id,original.asset?.id);
  const garment=await asset();await approval('analyzeRegistration','gpt-6.1-sol',{[garment.id]:1});await assert.rejects(service.execute({action:'analyzeRegistration',intentKey:randomUUID(),referenceAssetId:garment.id}),code('asset_required'));assert.equal(calls,1);
});
