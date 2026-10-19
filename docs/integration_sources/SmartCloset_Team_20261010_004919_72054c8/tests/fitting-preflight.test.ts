import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {readFittingPreflight,type FittingPreflightInput} from '../server/fittingPreflight';
import {createApiServer} from '../server/http';
import type {DatabaseRepository} from '../server/repository';
import type {ServerConfig} from '../server/config';
import {AppError} from '../server/errors';
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const OWNER=id(1),OTHER=id(2),config:ServerConfig={origin:'http://127.0.0.1:4311',port:4312,supabaseUrl:'https://fixture.invalid',
  publishableKey:'fixture',serverKey:'fixture',openaiKey:'',decartKey:'fixture',liveEnabled:true,aiMode:'live'};
function fixture(){
 const entries=[{slot:'top' as const,garmentId:id(10),assetId:id(110),assetVersion:1},{slot:'bottom' as const,garmentId:id(20),assetId:id(120),assetVersion:1}];
 const input:FittingPreflightInput={draft:{draftId:id(30),ownerId:OWNER,revision:1,name:'fixture',items:{top:id(10),bottom:id(20)},topLocked:false},
  snapshot:{ownerId:OWNER,person:{assetId:id(100),assetVersion:1},requestVersion:1,outfit:{draftId:id(30),outfitId:null,revision:1,items:entries}},
  fittingMode:'batch',personAssetId:id(101),personAssetVersion:1,referenceAssetId:id(102),referenceAssetVersion:1};
 const assets=[100,101,102,110,120].map(n=>({id:id(n),owner_id:OWNER,status:'finalized',version:1,
  kind:n===101?'person_video':n===102?'outfit_reference':'garment',mime_type:n===101?'video/mp4':'image/png',allowed_providers:['decart']}));
 const garments=entries.map(row=>({id:row.garmentId,owner_id:OWNER,category:row.slot,asset_id:row.assetId,asset_version:1}));
 const approval={id:id(50),owner_id:OWNER,provider:'decart',model:'lucy-vton-3.6',action:'startTryOn',currency:'USD',
  revoked_at:null,valid_from:new Date(Date.now()-60000).toISOString(),valid_until:new Date(Date.now()+60000).toISOString(),
  allowed_asset_versions:Object.fromEntries([101,102,110,120].map(n=>[id(n),1])),per_request_usd:1,total_usd:2,
  max_generated_seconds:30,max_attempts:4,max_concurrency:1};
 const tables:Record<string,Record<string,unknown>[]>={sc_drafts:[],sc_execution_approvals:[approval],sc_budget_ledger:[],sc_ai_jobs:[]};
 const reads:string[]=[];let writes=0;
 const write=()=>{writes++;throw new Error('READ ONLY: mutation called');};
 const repo={user:{id:OWNER,token:'fixture'},db:{
  rows:async(_user:unknown,table:string)=>{reads.push(table);return tables[table]??[];},rpc:write,control:write,
 },state:write,bootstrap:write,putDraft:write,
 garment:async(gid:string)=>{const value=garments.find(row=>row.id===gid);if(!value)throw new AppError('unauthorized_target',403);return value;},
 asset:async(aid:string,version?:number)=>{const value=assets.find(row=>row.id===aid);if(!value||value.owner_id!==OWNER||value.status!=='finalized'||version!==undefined&&value.version!==version)throw new AppError('unauthorized_target',403);return value;},
 bytes:async(aid:string)=>({asset:assets.find(row=>row.id===aid)!,bytes:Buffer.from('fixture-video'),media:{}}),
 } as unknown as DatabaseRepository;
 const verify=async()=>({durationSeconds:5,codec:'h264' as const,width:1280,height:720,inspected:true as const});
 const run=()=>readFittingPreflight(config,repo,input,verify);
 return{input,assets,garments,approval,tables,repo,verify,run,reads,writes:()=>writes};
}
test('preflight returns exact existing approval and remaining budget without bootstrap, draft write or reservation',async()=>{
 const f=fixture();f.tables.sc_budget_ledger.push({owner_id:OWNER,approval_id:f.approval.id,settlement_status:'unsettled',reserved_usd:.5});
 const before=JSON.stringify(f.tables),result=await f.run();
 assert.equal(result.status,'ready');if(result.status!=='ready')return;
 assert.equal(result.mode,'live-batch');assert.equal(result.noExecution,true);
 assert.equal(result.approval.approvalId,f.approval.id);assert.equal(result.budget.remainingUsd,1.5);
 assert.equal(result.budget.remainingSeconds,25);assert.equal(result.budget.estimatedUsd,.2);
 assert.deepEqual(result.snapshot,f.input.snapshot);assert.equal(f.writes(),0);assert.equal(JSON.stringify(f.tables),before);
});
test('foreign owner, category, stale asset and conflicting/discarded draft are rejected read-only',async()=>{
 for(const change of [
  (f:ReturnType<typeof fixture>)=>{f.input.snapshot.ownerId=OTHER;},
  (f:ReturnType<typeof fixture>)=>{f.garments[0].owner_id=OTHER;},
  (f:ReturnType<typeof fixture>)=>{f.input.snapshot.outfit.items[0].assetVersion=2;},
  (f:ReturnType<typeof fixture>)=>{f.assets.find(row=>row.id===id(101))!.owner_id=OTHER;},
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_drafts=[{status:'discarded',state_json:{_client:f.input.draft}}];},
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_drafts=[{status:'editing',state_json:{_client:{...f.input.draft,name:'conflict'}}}];},
 ]){
  const f=fixture();change(f);await assert.rejects(f.run(),error=>error instanceof AppError);
  assert.equal(f.writes(),0);
 }
});
test('missing/revoked/expired/wrong-asset approval and provider consent cannot connect execution',async()=>{
 for(const change of [
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_execution_approvals=[];},
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_execution_approvals[0].revoked_at=new Date().toISOString();},
  (f:ReturnType<typeof fixture>)=>{f.approval.valid_until='2025-01-01';},
  (f:ReturnType<typeof fixture>)=>{f.approval.allowed_asset_versions[id(110)]=2;},
  (f:ReturnType<typeof fixture>)=>{f.assets.find(row=>row.id===id(101))!.allowed_providers=[];},
 ]){
  const f=fixture();change(f);assert.equal((await f.run()).status,'blocked');assert.equal(f.writes(),0);
 }
});
test('remaining budget, owner-wide active work, attempt cap and incomplete ledger fail closed',async()=>{
 for(const change of [
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_budget_ledger=[{owner_id:OWNER,approval_id:f.approval.id,settlement_status:'unsettled',reserved_usd:1.9}];},
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_ai_jobs=[{owner_id:OWNER,mode:'live',status:'unknown_submission',approval_id:id(99)}];},
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_ai_jobs=Array.from({length:4},()=>({owner_id:OWNER,mode:'live',status:'succeeded',approval_id:f.approval.id}));},
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_budget_ledger=[{owner_id:OWNER,approval_id:f.approval.id,settlement_status:'settled',actual_usd:null}];},
  (f:ReturnType<typeof fixture>)=>{f.tables.sc_budget_ledger=Array.from({length:1000},()=>({}));},
 ]){
  const f=fixture();change(f);assert.equal((await f.run()).status,'blocked');assert.equal(f.writes(),0);
 }
});
test('realtime reports the unresolved strict bound without minting tokens or reserving budget',async()=>{
 const f=fixture();f.input.fittingMode='realtime';
 const result=await f.run();assert.equal(result.status,'blocked');
 if(result.status==='blocked')assert.equal(result.reasonCode,'strict_bound_unverified');
 assert.ok(!f.reads.includes('sc_execution_approvals'));assert.equal(f.writes(),0);
});
test('execution still retains approval/asset validation and atomic budget reservation after advisory preflight',async()=>{
 const source=await readFile(new URL('../server/ai.ts',import.meta.url),'utf8');
 assert.match(source,/sc_reserve_job/);assert.match(source,/approval\.allowed_asset_versions/);
 assert.match(source,/!this\.fixtureTransport.*request\.fittingMode === 'realtime'/);
 const http=await readFile(new URL('../server/http.ts',import.meta.url),'utf8');
 assert.ok(http.indexOf("const header=req.headers.authorization")<http.indexOf("path==='/api/try-on/preflight'"));
});
test('HTTP preflight authenticates the owner and fixture requests perform no database mutation',async()=>{
 const f=fixture();let mutations=0,authReads=0;
 const server=createApiServer(config,{databaseFetch:async(url,init)=>{
  const path=new URL(url).pathname;
  if(path==='/auth/v1/user'){authReads++;return Response.json({id:OWNER});}
  if(init.method&&init.method!=='GET'){mutations++;throw new Error('mutation forbidden');}
  if(path==='/rest/v1/sc_garments'){
    const wanted=new URL(url).searchParams.get('id')?.slice(3);return Response.json(f.garments.filter(row=>row.id===wanted));
  }
  if(path==='/rest/v1/sc_assets'){
    const wanted=new URL(url).searchParams.get('id')?.slice(3);return Response.json(f.assets.filter(row=>row.id===wanted));
  }
  if(path==='/rest/v1/sc_drafts'||path==='/rest/v1/sc_ai_jobs')return Response.json([]);
  throw new Error('unexpected read '+path);
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=(server.address() as {port:number}).port,url='http://127.0.0.1:'+port+'/api/try-on/preflight';
 const body={draft:f.input.draft,snapshot:f.input.snapshot,person_asset_id:f.input.personAssetId,person_asset_version:1,
  reference_asset_id:f.input.referenceAssetId,reference_asset_version:1,fitting_mode:'realtime'};
 const request=(value:unknown,authorized=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:config.origin,...(authorized?{Authorization:'Bearer fixture-jwt'}:{})},body:JSON.stringify(value)});
 try{
  const anonymous=await request(body,false);assert.equal(anonymous.status,401);
  const foreign=await request({...body,draft:{...body.draft,ownerId:OTHER}});assert.equal(foreign.status,403);
  const valid=await request(body);assert.equal(valid.status,200);
  assert.equal((await valid.json()).reasonCode,'strict_bound_unverified');assert.equal(mutations,0);assert.ok(authReads>=2);
 }finally{server.close();await once(server,'close');}
});

test('a local central portrait remains client identity and is never required as a private transmitted asset',async()=>{
 const f=fixture();f.input.snapshot.person.assetId='local-person-12345678-1234-4234-8234-123456789abc';
 const result=await f.run();assert.equal(result.status,'ready');if(result.status!=='ready')return;
 assert.equal(result.personIdentityEvidence,'client-confirmed-same-person');
 assert.equal(result.snapshot.person.assetId,f.input.snapshot.person.assetId);
 assert.ok(!Object.hasOwn(result.approval.allowedAssetVersions,f.input.snapshot.person.assetId));
 assert.equal(f.writes(),0);
});

function existingJob(f:ReturnType<typeof fixture>,extra:Record<string,unknown>={}){
 return {id:id(60),operation_id:id(61),owner_id:OWNER,provider:'decart',model:'lucy-vton-3.6',mode:'live',stage:'batch',status:'running',provider_job_id:'fixture-existing-provider-job',
  approval_id:f.approval.id,input_snapshot_json:{action:'startTryOn',fittingMode:'batch',draft:structuredClone(f.input.draft),
    personAssetId:f.input.personAssetId,referenceAssetId:f.input.referenceAssetId,
    asset_versions:Object.fromEntries([101,102,110,120].map(n=>[id(n),1]))},...extra};
}
test('exact existing operation can be recovered after approval expiry and exhausted budget without another reservation',async()=>{
 const f=fixture();f.approval.valid_until='2025-01-01';f.tables.sc_budget_ledger=[{owner_id:OWNER,approval_id:f.approval.id,settlement_status:'unsettled',reserved_usd:2}];
 f.tables.sc_ai_jobs=[existingJob(f)];const result=await f.run();
 assert.equal(result.status,'existing_operation');if(result.status!=='existing_operation')return;
 assert.equal(result.existingOperation.operationId,id(61));assert.equal(result.existingOperation.providerReady,true);
 assert.equal(f.writes(),0);assert.ok(!f.reads.includes('sc_execution_approvals'));assert.ok(!f.reads.includes('sc_budget_ledger'));
});
test('unknown submission without provider ID is returned for metadata lookup only',async()=>{
 const f=fixture();f.tables.sc_execution_approvals=[];
 f.tables.sc_ai_jobs=[existingJob(f,{status:'unknown_submission',provider_job_id:null})];
 const result=await f.run();assert.equal(result.status,'existing_operation');
 if(result.status==='existing_operation')assert.equal(result.existingOperation.providerReady,false);
 assert.equal(f.writes(),0);
});
test('active operation with a different complete input never receives recovery or new execution permission',async()=>{
 for(const change of [
  (value:Record<string,unknown>)=>{(value.input_snapshot_json as Record<string,unknown>).personAssetId=id(999);},
  (value:Record<string,unknown>)=>{(value.input_snapshot_json as Record<string,unknown>).referenceAssetId=id(999);},
  (value:Record<string,unknown>)=>{(value.input_snapshot_json as Record<string,unknown>).asset_versions={[id(101)]:2};},
  (value:Record<string,unknown>)=>{((value.input_snapshot_json as Record<string,unknown>).draft as {revision:number}).revision=2;},
 ]){
  const f=fixture(),job=existingJob(f);change(job);f.tables.sc_ai_jobs=[job];
  const result=await f.run();assert.equal(result.status,'blocked');
  if(result.status==='blocked')assert.equal(result.reasonCode,'active_execution');
  assert.equal(f.writes(),0);
 }
});

test('mixed full-look preflight requires the external record and its asset in the same existing approval',async()=>{
 const f=fixture(),externalId=id(211),assetId=id(212);
 f.input.draft.externalItems={outer:{externalItemId:externalId,assetId,assetVersion:1,name:'provided fixture',sourceLabel:'fixture source',sourceUrl:null}};
 f.input.snapshot.outfit.externalItems=[{slot:'outer',externalItemId:externalId,assetId,assetVersion:1}];
 f.assets.push({id:assetId,owner_id:OWNER,status:'finalized',version:1,kind:'garment',mime_type:'image/png',allowed_providers:['decart']});
 let externalOwner=OWNER;(f.repo.db as unknown as {one:Function}).one=async()=>({id:externalId,owner_id:externalOwner,asset_id:assetId,source_label:'fixture source',source_url:null});
 assert.equal((await f.run()).status,'blocked');f.approval.allowed_asset_versions[assetId]=1;
 const ready=await f.run();assert.equal(ready.status,'ready');assert.equal(f.writes(),0);
 externalOwner=OTHER;await assert.rejects(f.run(),error=>error instanceof AppError&&error.status===403);
});
