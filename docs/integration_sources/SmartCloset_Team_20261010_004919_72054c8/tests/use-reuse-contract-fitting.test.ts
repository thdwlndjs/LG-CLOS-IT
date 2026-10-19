import test from 'node:test';
import assert from 'node:assert/strict';
import {AiService,digest,type AiRequest} from '../server/ai';
import {fittingContentIdentity} from '../server/fittingContentIdentity';
import {fittingContentKey} from '../src/fittingContentIdentity';
import {fittingSnapshotsMatch,type FittingSnapshot,type FittingCandidate} from '../src/mirrorScene';
import type {Asset,Garment,OutfitDraft} from '../src/core/types';
import type {DatabaseRepository} from '../server/repository';
import type {ServerConfig} from '../server/config';
import {AppError} from '../server/errors';
import {MirrorFittingController,type MirrorFittingPorts} from '../src/mirrorFittingController';
import type {RealtimeStart} from '../src/integrations/decartRealtime';

// Isolated transport/storage contracts only. No live provider, user DB, or decoded media evidence.
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const OWNER=id(1),PERSON=id(2),REFERENCE=id(3),OP=id(4),RESULT=id(5),DRAFT=id(6);
const asset=(n:number):Asset=>({id:id(n),version:1,source:'storage',url:'/api/assets/'+id(n)+'/content'});
function inputs(){
 const draft:OutfitDraft={draftId:DRAFT,ownerId:OWNER,revision:1,name:'original',items:{top:id(10),bottom:id(20)},topLocked:false};
 const garments=([10,20] as const).map((n,i):Garment=>({id:id(n),ownerId:OWNER,category:i?'bottom':'top',asset:asset(n+100),name:'fixture',color:'',features:[],material:'',size:'',location:'',careNotes:'',revision:1,provenance:{care:'unconfirmed',location:'unconfirmed',size:'unconfirmed'}}));
 const snapshot:FittingSnapshot={ownerId:OWNER,person:{assetId:id(100),assetVersion:1},requestVersion:1,outfit:{draftId:DRAFT,outfitId:null,revision:1,items:garments.map(g=>({slot:g.category,garmentId:g.id,assetId:g.asset!.id,assetVersion:1}))}};
 const request:AiRequest={action:'startTryOn',intentKey:'first',draft,personAssetId:PERSON,referenceAssetId:REFERENCE,fittingMode:'batch'};
 const versions:Record<string,number>={[PERSON]:1,[REFERENCE]:1,[id(110)]:1,[id(120)]:1};
 return{draft,garments,snapshot,request,versions};
}
const signature=(value:ReturnType<typeof inputs>,owner=OWNER)=>digest(fittingContentIdentity(value.request,owner,value.versions,value.garments));
const next=(value:ReturnType<typeof inputs>)=>{const copy=structuredClone(value);copy.draft.draftId=id(66);copy.draft.revision=7;copy.draft.name='custom title';copy.draft.topLocked=true;copy.draft.lockedSlots={bottom:true};copy.draft.savedOutfitId=id(77);copy.draft.sourceOutfitId=id(78);copy.draft.purpose='card';copy.draft.nameOrigin='user';copy.request.intentKey='different';copy.snapshot.outfit.draftId=copy.draft.draftId;copy.snapshot.outfit.revision=7;copy.snapshot.outfit.outfitId=id(77);copy.snapshot.requestVersion=9;return copy;};

test('R22 content reuse ignores title, draft identity/revision, locks and card provenance while freshness stays strict',()=>{
 const before=inputs(),after=next(before);
 assert.equal(signature(before),signature(after));assert.equal(fittingContentKey(before.snapshot),fittingContentKey(after.snapshot));
 assert.equal(fittingSnapshotsMatch(before.snapshot,after.snapshot),false);
 after.snapshot.outfit.items.reverse();after.draft.items={bottom:id(20),top:id(10)};after.request.draft=after.draft;
 assert.equal(signature(before),signature(after));assert.equal(fittingContentKey(before.snapshot),fittingContentKey(after.snapshot));
});

test('R22 server content key invalidates owner, person/reference version, slot asset binding, origin and configuration',()=>{
 const baseline=signature(inputs());
 const mutations:Array<(v:ReturnType<typeof inputs>)=>void>=[
  v=>{v.request.personAssetId=id(99);v.versions[id(99)]=1;},v=>{v.versions[PERSON]++;},v=>{v.versions[REFERENCE]++;},
  v=>{v.request.referenceAssetId=id(98);v.versions[id(98)]=1;},v=>{v.versions[id(110)]++;},
  v=>{[v.garments[0].asset,v.garments[1].asset]=[v.garments[1].asset,v.garments[0].asset];},
  v=>{v.garments[0].asset!.source='upload';},v=>{v.request.fittingMode='realtime';},
  v=>{delete v.draft.items.top;v.draft.externalItems={top:{externalItemId:id(90),assetId:id(110),assetVersion:1,name:'fixture external',sourceLabel:'fixture supplier',sourceUrl:'https://fixture.invalid/item'}};},
 ];
 for(const mutate of mutations){const v=inputs();mutate(v);assert.notEqual(signature(v),baseline);}
 assert.notEqual(signature(inputs(),id(99)),baseline);
 const content=fittingContentIdentity(inputs().request,OWNER,inputs().versions,inputs().garments);
 for(const patch of [{model:'different-model'},{prompt:'different instruction'},{seed:1},{resolution:'1080p'},{enhancePrompt:false}])assert.notEqual(digest({...content,configuration:{...content.configuration,...patch}}),baseline);
});

test('R22 client registration identity changes for logical person, every slot/version, external source and owner',()=>{
 const original=inputs().snapshot,key=fittingContentKey(original);
 for(const mutate of [
  (s:FittingSnapshot)=>{s.ownerId=id(90);},(s:FittingSnapshot)=>{s.person.assetVersion++;},(s:FittingSnapshot)=>{s.person.assetId=id(91);},
  (s:FittingSnapshot)=>{s.outfit.items[1].assetVersion++;},(s:FittingSnapshot)=>{s.outfit.items[0].assetId=id(92);},
  (s:FittingSnapshot)=>{s.outfit.items[0].garmentId=id(93);},(s:FittingSnapshot)=>{const top=s.outfit.items.shift()!;s.outfit.externalItems=[{slot:'top',externalItemId:top.garmentId,assetId:top.assetId,assetVersion:top.assetVersion}];},
 ]){const value=structuredClone(original);mutate(value);assert.notEqual(fittingContentKey(value),key);}
});

const config:ServerConfig={origin:'http://fixture.invalid',port:4312,supabaseUrl:'https://fixture.invalid',publishableKey:'fixture',serverKey:'fixture',openaiKey:'fixture',decartKey:'fixture',liveEnabled:false,aiMode:'saved_result'};
function serverFixture(legacy=false){
 const value=inputs(),queries:string[]=[],savedDrafts:OutfitDraft[]=[],rows:Array<Record<string,unknown>>=[];
 const sig=digest({mode:'live',model:'lucy-vton-3.6',schema:'provider-v1',snapshot:{...value.request,intentKey:undefined,asset_versions:value.versions}});
 rows.push({id:id(7),operation_id:OP,owner_id:OWNER,adapter:'startTryOn',mode:'live',status:'succeeded',job_signature:sig,result_ref:RESULT,result_json:{provider_status:'completed',...(!legacy?{fitting_content:fittingContentIdentity(value.request,OWNER,value.versions,value.garments),fitting_content_key:signature(value)}:{})},input_snapshot_json:{...value.request,asset_versions:value.versions}});
 let providerCalls=0;
 const repo={user:{id:OWNER},state:async()=>({garments:value.garments}),putDraft:async(d:OutfitDraft)=>{savedDrafts.push(structuredClone(d));return{id:d.draftId,revision:d.revision};},
  asset:async(assetId:string,version?:number)=>{const current=value.versions[assetId];if(current===undefined||version!==undefined&&current!==version)throw new AppError('unauthorized_target',403);return{id:assetId,version:current,owner_id:OWNER,status:'finalized'};},
  db:{rows:async(_user:unknown,table:string,query:string)=>{queries.push(table+'?'+query);assert.equal(table,'sc_ai_jobs');assert.ok(query.includes('owner_id=eq.'+OWNER));const match=query.match(/job_signature=eq\.([^&]+)/)?.[1];return match?rows.filter(row=>row.job_signature===match):rows;}},
 } as unknown as DatabaseRepository;
 const service=new AiService(config,repo,async()=>{providerCalls++;throw Error('Provider forbidden');});
 return{value,service,queries,savedDrafts,rows,providerCalls:()=>providerCalls};
}

test('R22 saved service reuses verified content across a new card/draft without execution or historical mutation',async()=>{
 const f=serverFixture(),historical=structuredClone(f.rows),changed=next(f.value);
 const result=await f.service.execute(changed.request,'saved_result');
 assert.equal(result.operation_id,OP);assert.ok('result_asset_id'in result);assert.equal(result.result_asset_id,RESULT);assert.equal(result.mode,'saved_result');
 assert.equal(f.providerCalls(),0);assert.equal(f.queries.length,2);assert.deepEqual(f.rows,historical);
 // Existing scope may persist the editable draft; this test does not call a real DB.
 assert.equal(f.savedDrafts[0].revision,7);
});

test('R22 stored content miss does not fall back to provider execution',async()=>{
 const f=serverFixture();f.value.versions[REFERENCE]++;
 await assert.rejects(f.service.execute(f.value.request,'saved_result'),e=>e instanceof AppError&&e.code==='result_unavailable');
 assert.equal(f.providerCalls(),0);assert.equal(f.queries.length,2);
});

test('R22 legacy results retain exact-request compatibility and cannot be broadly relabelled without a content map',async()=>{
 const f=serverFixture(true);assert.equal((await f.service.execute(f.value.request,'saved_result')).operation_id,OP);
 await assert.rejects(f.service.execute(next(f.value).request,'saved_result'),e=>e instanceof AppError&&e.code==='result_unavailable');
 assert.equal(f.providerCalls(),0);
});

const deferred=<T>()=>{let resolve!:(value:T)=>void;return{promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};};
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();await new Promise<void>(r=>setImmediate(r));};
function controllerFixture(){
 const results:Array<FittingCandidate|null>=[],calls:string[]=[],starts:unknown[]=[],revoked:string[]=[],applied:unknown[]=[],timers:Array<()=>void>=[];
 let url=0,rt:RealtimeStart|null=null;
 const track={readyState:'live',stop(){this.readyState='ended';},addEventListener(){},removeEventListener(){}};
 const stream={active:true,getTracks:()=>[track],getVideoTracks:()=>[track],getAudioTracks:()=>[]} as unknown as MediaStream;
 const ports:MirrorFittingPorts={now:()=>1000000,createObjectURL:()=>`blob:fixture-${++url}`,revokeObjectURL:u=>revoked.push(u),
  schedule:cb=>{timers.push(cb);return cb;},cancelSchedule:()=>{},
  request:async(path,method)=>{calls.push(method+' '+path);if(path.endsWith('/status'))return{operation_id:OP,processing_status:'running'};return{mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:OP,result_asset_id:RESULT};},
  fetch:async()=>new Response(new Blob(['fixture bytes'],{type:'image/png'}),{headers:{'content-type':'image/png'}}),
  tryOn:async(...args)=>{starts.push(args);return{mode:'live',operation_id:OP,result:{absolute_end_at:new Date(1030000).toISOString()}};},
  openPerson:async()=>({stream,close:()=>track.stop()}),
  realtime:{start:async input=>{rt=input;input.onRemoteStream(stream);return{connected:true};},applyLook:async value=>{applied.push(value);return true;},stop:async()=>{const current=rt;rt=null;if(current)await current.onStopped(current.operationId);}},
 };
 const controller=new MirrorFittingController({onResult:r=>results.push(r)},ports);
 const register=(v=inputs(),person=asset(2),reference=asset(3))=>controller.registerInputs({snapshot:v.snapshot,person,reference,samePersonConfirmed:true,fullOutfitConfirmed:true,transferConsent:true});
 const live=async(mode:'live-batch'|'live-realtime')=>{const allowedAssetVersions=inputs().versions;await controller.configureExecution({mode,liveApproval:{ownerId:OWNER,approvalId:id(80),validUntilMs:1060000,perRequestUsd:1,totalUsd:2,maxGeneratedSeconds:60,allowedAssetVersions}});};
 return{controller,ports,register,live,results,calls,starts,revoked,applied,timers,rt:()=>rt};
}

test('R22 registered exact content remains usable after rename/new draft and result binds to the latest epoch',async()=>{
 const f=controllerFixture(),old=inputs(),changed=next(old);f.register(old);
 assert.equal((await f.controller.submitSelected(old.snapshot,old.draft)).status,'ready');
 assert.equal((await f.controller.submitSelected(changed.snapshot,changed.draft)).status,'ready');
 assert.deepEqual(f.results.at(-1)?.snapshot,changed.snapshot);assert.equal(f.results.at(-1)?.origin,'saved');assert.equal(f.starts.length,0);
 await f.controller.stop();assert.equal(f.revoked.length,2);
});

test('R23 same-content revision does not authorize a late old result or extra private file read',async()=>{
 const f=controllerFixture(),old=inputs(),changed=next(old),hold=deferred<Record<string,unknown>>();f.register(old);
 const original=f.ports.request;let lookup=0,reads=0;f.ports.request=async(...args)=>++lookup===1?hold.promise:original(...args);f.ports.fetch=async()=>{reads++;return new Response('fixture',{headers:{'content-type':'image/png'}});};
 const first=f.controller.submitSelected(old.snapshot,old.draft);await tick();const second=f.controller.submitSelected(changed.snapshot,changed.draft);
 hold.resolve({mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:OP,result_asset_id:RESULT});
 assert.equal((await first).status,'stale');assert.equal((await second).status,'ready');assert.equal(reads,1);assert.deepEqual(f.results.at(-1)?.snapshot,changed.snapshot);
 await f.controller.stop();
});

test('R22 changed private input invalidates an in-flight result even with identical content selection',async()=>{
 const f=controllerFixture(),value=inputs(),hold=deferred<Record<string,unknown>>();f.register(value);f.ports.request=async()=>hold.promise;
 const pending=f.controller.submitSelected(value.snapshot,value.draft);await tick();f.register(value,{...asset(2),version:2});
 hold.resolve({mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:OP,result_asset_id:RESULT});
 assert.equal((await pending).status,'stale');assert.ok(f.results.every(r=>r===null));await f.controller.stop();
});

test('R22 same content keeps the original active batch operation and does not reset its paid submission',async()=>{
 const f=controllerFixture(),value=inputs(),changed=next(value);f.register(value);await f.live('live-batch');
 assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'processing');
 assert.equal((await f.controller.submitSelected(changed.snapshot,changed.draft)).status,'processing');
 assert.equal(f.starts.length,1);assert.equal(f.calls.filter(c=>c.endsWith('/stop')).length,0);assert.equal(f.controller.getCurrentOperation()?.operationId,OP);
 await f.controller.stop();assert.equal(f.calls.filter(c=>c.endsWith('/stop')).length,1);
});

test('R22 active realtime identical content keeps its stream and absolute end, with no saved replay or new creation',async()=>{
 const f=controllerFixture(),value=inputs(),changed=next(value);changed.draft.draftId=value.draft.draftId;changed.snapshot.outfit.draftId=value.draft.draftId;f.register(value);await f.live('live-realtime');
 await f.controller.submitSelected(value.snapshot,value.draft);const absoluteEnd=f.rt()!.absoluteEndMs;
 await f.controller.submitSelected(changed.snapshot,changed.draft);
 assert.equal(f.starts.length,1);assert.equal(f.applied.length,0);assert.equal(f.rt()!.absoluteEndMs,absoluteEnd);assert.equal(f.calls.length,0);
 assert.equal(f.results.at(-1)?.origin,'provider-realtime');assert.deepEqual(f.results.at(-1)?.snapshot,changed.snapshot);await f.controller.stop();
});

test('R23 account/repository changes discard registered content and late saved responses',async()=>{
 const f=controllerFixture(),value=inputs(),hold=deferred<Record<string,unknown>>();f.controller.bindContext(OWNER,{});f.register(value);f.ports.request=async()=>hold.promise;
 const pending=f.controller.submitSelected(value.snapshot,value.draft);await tick();f.controller.bindContext(id(99),{});
 hold.resolve({mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:OP,result_asset_id:RESULT});
 assert.equal((await pending).status,'stale');assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'blocked');assert.ok(f.results.every(r=>r===null));await f.controller.stop();
});

test('R22 separate content metadata preserves the exact reservation hash and survives provider status refresh',async()=>{
 const value=inputs(),job:Record<string,unknown>={id:id(7),owner_id:OWNER,operation_id:OP,provider:'decart',stage:'batch',mode:'live',model:'lucy-vton-3.6',config_json:{fittingMode:'batch'}},reservations:Record<string,unknown>[]=[];
 let paidCreates=0;
 const approval={id:id(8),owner_id:OWNER,provider:'decart',action:'startTryOn',model:'lucy-vton-3.6',currency:'USD',valid_from:'2020-01-01',valid_until:'2099-01-01',allowed_asset_versions:value.versions,max_generated_seconds:30,per_request_usd:5};
 const assetRow=(assetId:string)=>({id:assetId,owner_id:OWNER,status:'finalized',version:value.versions[assetId],allowed_providers:['decart'],kind:assetId===PERSON?'person_video':assetId===REFERENCE?'outfit_reference':'garment',mime_type:assetId===PERSON?'video/mp4':'image/png'});
 const repo={user:{id:OWNER},state:async()=>({garments:value.garments}),asset:async(assetId:string)=>assetRow(assetId),putDraft:async(d:OutfitDraft)=>({id:d.draftId,revision:d.revision}),
  bytes:async(assetId:string)=>({asset:assetRow(assetId),bytes:Buffer.from('fixture bytes'),media:{mime:assetId===PERSON?'video/mp4':'image/png',width:1,height:1}}),
  db:{rows:async(_u:unknown,table:string)=>table==='sc_execution_approvals'?[approval]:table==='sc_ai_jobs'?[job]:[],one:async()=>({id:OP,owner_id:OWNER}),control:async(name:string,args:Record<string,unknown>)=>{
   if(name==='sc_reserve_job'){const request=args.p_request as Record<string,unknown>;reservations.push(structuredClone(request));Object.assign(job,{input_snapshot_json:request.input_snapshot,job_signature:request.job_signature,status:'reserved'});return{job_id:job.id,operation_id:OP,reused:false};}
   if(name==='sc_update_job'){Object.assign(job,args.p_patch);return job;}
   if(name==='sc_settle_job')return{};
   throw Error('unexpected fixture mutation '+name);
  }},
 } as unknown as DatabaseRepository;
 const transport=async(url:string)=>{
  if(url.includes('/v1/jobs/lucy-vton-3.6')){paidCreates++;assert.ok((job.result_json as Record<string,unknown>).fitting_content_key);return Response.json({job_id:'fixture_original_job',status:'pending'});}
  assert.ok(url.endsWith('/v1/jobs/fixture_original_job'));return Response.json({job_id:'fixture_original_job',status:'completed'});
 };
 const service=AiService.forContractTests({...config,liveEnabled:true},repo,transport,async()=>({durationSeconds:1,codec:'h264',width:1280,height:720,inspected:true}));
 await service.execute(value.request,'live');
 const expected={...value.request,intentKey:undefined,asset_versions:value.versions};
 assert.deepEqual(reservations[0].input_snapshot,expected);
 assert.equal(reservations[0].job_signature,digest({mode:'live',model:'lucy-vton-3.6',schema:'provider-v1',snapshot:expected}));
 const content=(job.result_json as Record<string,unknown>).fitting_content;
 assert.deepEqual(content,fittingContentIdentity(value.request,OWNER,value.versions,value.garments));
 await service.batchStatus(OP);assert.equal((job.result_json as Record<string,unknown>).provider_status,'completed');
 assert.deepEqual((job.result_json as Record<string,unknown>).fitting_content,content);assert.equal(paidCreates,1);assert.equal(reservations.length,1);
});

test('R22 exact request lookup cannot bypass a changed stored model/configuration or corrupted content map',async()=>{
 for(const patch of ['model','prompt','seed','source'] as const){
  const f=serverFixture(),saved=f.rows[0].result_json as Record<string,unknown>;
  const content=structuredClone(saved.fitting_content) as {configuration:Record<string,unknown>;origin:string};
  if(patch==='source')content.origin='provider-realtime';else content.configuration[patch]=patch==='seed'?99:'different';
  saved.fitting_content=content;saved.fitting_content_key=digest(content);
  await assert.rejects(f.service.execute(f.value.request,'saved_result'),e=>e instanceof AppError&&e.code==='result_unavailable');assert.equal(f.providerCalls(),0);
 }
});

test('R22 returning to an earlier candidate applies the current realtime session rather than replaying cached media',async()=>{
 const f=controllerFixture(),a=inputs(),b=structuredClone(a),back=structuredClone(a);
 b.draft.revision=2;b.draft.items.top=id(11);b.snapshot.outfit.revision=2;b.snapshot.requestVersion=2;b.snapshot.outfit.items[0].garmentId=id(11);
 back.draft.revision=3;back.snapshot.outfit.revision=3;back.snapshot.requestVersion=3;
 f.register(a);f.register(b);await f.live('live-realtime');
 const original=f.ports.request;
 f.ports.request=async(path,method,body)=>{
  if(!path.endsWith('/look'))return original(path,method,body);
  f.calls.push(method+' '+path);const request=body as {draft:OutfitDraft;reference_asset_id:string};
  return{operation_id:OP,processing_status:'look_ready',apply_status:'not_applied',draft_revision:request.draft.revision,reference_asset_id:request.reference_asset_id,reference_asset_version:1,absolute_end_at:new Date(1030000).toISOString()};
 };
 assert.equal((await f.controller.submitSelected(a.snapshot,a.draft)).status,'processing');
 assert.equal((await f.controller.submitSelected(b.snapshot,b.draft)).status,'processing');
 assert.equal((await f.controller.submitSelected(back.snapshot,back.draft)).status,'processing');
 assert.equal(f.starts.length,1);assert.equal(f.applied.length,2);assert.deepEqual(f.calls,['PATCH /api/try-on/'+OP+'/look','PATCH /api/try-on/'+OP+'/look']);
 assert.equal(f.results.at(-1)?.origin,'provider-realtime');assert.deepEqual(f.results.at(-1)?.snapshot,back.snapshot);assert.equal(f.rt()!.absoluteEndMs,1030000);await f.controller.stop();
});
