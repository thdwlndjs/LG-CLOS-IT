import test from 'node:test';
import assert from 'node:assert/strict';
import type {Asset,OutfitDraft} from '../src/core/types';
import type {FittingCandidate,FittingSnapshot,FittingStreamBinding} from '../src/mirrorScene';
import type {RealtimeStart,RealtimeLook} from '../src/integrations/decartRealtime';
import {MirrorFittingController,type MirrorFittingPorts,type MirrorInputRegistration,type MirrorFittingState} from '../src/mirrorFittingController';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const OWNER=id(1),PERSON=id(2),REFERENCE=id(3),OP=id(4),RESULT=id(5),DRAFT=id(6);
const asset=(n:number):Asset=>({id:id(n),version:1,source:'storage',url:'/api/assets/'+id(n)+'/content'});
function selection(revision=1,top=10,owner=OWNER) {
  const draft:OutfitDraft={draftId:DRAFT,ownerId:owner,revision,name:'fixture',items:{top:id(top),bottom:id(20)},topLocked:false};
  const snapshot:FittingSnapshot={ownerId:owner,person:{assetId:id(100),assetVersion:1},requestVersion:revision,
    outfit:{draftId:DRAFT,outfitId:null,revision,items:[
      {slot:'top',garmentId:id(top),assetId:id(top+1000),assetVersion:1},
      {slot:'bottom',garmentId:id(20),assetId:id(1020),assetVersion:1},
    ]}};
  return {draft,snapshot};
}
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(value=>{resolve=value;});return {promise,resolve};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise<void>(resolve=>setImmediate(resolve));};
function media() {
  const listeners=new Set<()=>void>();
  const track={kind:'video',readyState:'live',stops:0,stop(){this.readyState='ended';this.stops++;},
    addEventListener:(_name:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>listeners.delete(fn),
    end(){this.readyState='ended';for(const fn of [...listeners])fn();}};
  const stream={get active(){return track.readyState==='live';},getTracks:()=>[track],getVideoTracks:()=>[track],getAudioTracks:()=>[]};
  return {stream:stream as unknown as MediaStream,track,listeners};
}
function fixture() {
  const states:MirrorFittingState[]=[],results:Array<FittingCandidate|null>=[],streams:Array<FittingStreamBinding|null>=[];
  const requests:Array<{path:string;method:string;body:unknown}>=[],starts:unknown[]=[],applied:RealtimeLook[]=[],revoked:string[]=[];
  const remote=media(),inputMedia=media();let current:RealtimeStart|null=null,urlNumber=0,closes=0,fetches=0,disconnects=0;
  const now=1000000,end=now+30000;
  const ports:MirrorFittingPorts={
    now:()=>now,createObjectURL:()=> 'blob:fixture-'+(++urlNumber),revokeObjectURL:url=>revoked.push(url),
    request:async(path,method,body)=>{
      requests.push({path,method,body});
      if(path.endsWith('/status'))return {operation_id:OP,processing_status:'running',result:{provider_status:'pending'}};
      if(path.endsWith('/look')){
        const input=body as {draft:OutfitDraft;reference_asset_id:string};
        return {operation_id:OP,processing_status:'look_ready',apply_status:'not_applied',draft_revision:input.draft.revision,
          reference_asset_id:input.reference_asset_id,reference_asset_version:1,absolute_end_at:new Date(end).toISOString()};
      }
      if(path==='/api/try-on')return {mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:OP,result_asset_id:RESULT};
      return {};
    },
    fetch:async()=>{fetches++;return new Response(new Blob(['fixture-image'],{type:'image/png'}),{headers:{'Content-Type':'image/png'}});},
    tryOn:async(...args)=>{starts.push(args);return {mode:'live',operation_id:OP,result:{absolute_end_at:new Date(end).toISOString()}};},
    openPerson:async()=>({stream:inputMedia.stream,close:()=>{closes++;inputMedia.track.stop();}}),
    realtime:{
      start:async options=>{current=options;options.onRemoteStream(remote.stream);return {connected:true};},
      applyLook:async look=>{applied.push(look);return true;},
      stop:async()=>{disconnects++;const old=current;current=null;if(old){old.onRemoteStream(null);await old.onStopped(old.operationId);}},
    },
  };
  const controller=new MirrorFittingController({onState:value=>states.push(value),onResult:value=>results.push(value),onStream:value=>streams.push(value)},ports);
  function register(value=selection(),consent=true):MirrorInputRegistration{
    const registration:MirrorInputRegistration={snapshot:value.snapshot,person:asset(2),reference:asset(3+value.draft.revision-1),
      samePersonConfirmed:true,fullOutfitConfirmed:true,transferConsent:consent};
    controller.registerInputs(registration);return registration;
  }
  function live(mode:'live-batch'|'live-realtime'='live-realtime') {
    const allowedAssetVersions:Record<string,number>={};
    for(let n=1;n<2000;n++)allowedAssetVersions[id(n)]=1;
    controller.configureExecution({mode,liveApproval:{ownerId:OWNER,approvalId:id(50),validUntilMs:now+60000,
      perRequestUsd:1,totalUsd:2,maxGeneratedSeconds:60,allowedAssetVersions}});
  }
  return {controller,ports,register,live,requests,starts,applied,states,results,streams,revoked,remote,inputMedia,
    stats:()=>({closes,fetches,disconnects}),current:()=>current};
}

test('unregistered input and saved miss never call paid execution or fabricate a static result',async()=>{
  const f=fixture(),value=selection();
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'blocked');
  assert.equal(f.requests.length,0);assert.equal(f.starts.length,0);
  f.register();f.ports.request=async()=>({mode:'saved_result',processing_status:'missing'});
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'blocked');
  assert.equal(f.starts.length,0);assert.equal(f.stats().fetches,0);
  assert.ok(f.results.every(result=>result===null));
});

test('input registration rejects public assets and live execution requires existing consent/assets/budget evidence',async()=>{
  const f=fixture(),value=selection(),input=f.register();
  assert.throws(()=>f.controller.registerInputs({...input,reference:{...input.reference,source:'packaged'}}));
  f.controller.configureExecution({mode:'live-realtime'});
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'blocked');
  f.live();f.register(value,false);
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'blocked');
  assert.equal(f.starts.length,0);assert.equal(f.requests.length,0);
  f.register();f.controller.configureExecution({mode:'live-batch',liveApproval:{ownerId:OWNER,approvalId:id(50),validUntilMs:1060000,
    perRequestUsd:1,totalUsd:1,maxGeneratedSeconds:30,allowedAssetVersions:{}}});
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'blocked');
  assert.equal(f.starts.length,0);
});

test('saved result recovery is exact-input only and stop revokes the retained file',async()=>{
  const f=fixture(),value=selection();f.register();
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'ready');
  const result=f.results.at(-1)!;assert.equal(result.origin,'saved');
  f.ports.request=async()=>{throw new Error('fixture retry failed');};
  assert.equal((await f.controller.retrySelected(value.snapshot,value.draft)).status,'error');
  assert.deepEqual(f.results.at(-1),result);assert.equal(f.revoked.length,0);
  f.controller.reconcile(selection(2,11).snapshot);
  assert.equal(f.results.at(-1),null);assert.deepEqual(f.revoked,['blob:fixture-1']);
  await f.controller.stop();assert.equal(f.streams.at(-1),null);
});

test('saved response for A is discarded and rapid B/C selection coalesces the pending candidate',async()=>{
  const f=fixture(),a=selection(),b=selection(2,11),c=selection(3,12),hold=deferred<Record<string,unknown>>();
  [a,b,c].forEach(value=>f.register(value));
  const original=f.ports.request;let calls=0;
  f.ports.request=async(...args)=>{calls++;return calls===1?hold.promise:original(...args);};
  const pa=f.controller.submitSelected(a.snapshot,a.draft);await tick();
  const pb=f.controller.submitSelected(b.snapshot,b.draft);
  const pc=f.controller.submitSelected(c.snapshot,c.draft);
  assert.equal((await pb).status,'stale');
  hold.resolve({mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:OP,result_asset_id:RESULT});
  assert.equal((await pa).status,'stale');assert.equal((await pc).status,'ready');
  assert.equal(calls,2);assert.equal(f.stats().fetches,1);
  assert.equal(f.results.at(-1)?.snapshot.outfit.revision,3);
});

test('realtime bridge publishes actual stream only and top replacement validates whole reference before SDK set',async()=>{
  const f=fixture(),a=selection(),b=selection(2,11);f.register(a);f.register(b);f.live();
  assert.equal((await f.controller.submitSelected(a.snapshot,a.draft)).status,'processing');
  assert.equal(f.starts.length,1);
  assert.equal(f.results.at(-1)?.origin,'provider-realtime');
  assert.equal(f.streams.at(-1)?.snapshot.outfit.revision,1);
  assert.equal((await f.controller.submitSelected(b.snapshot,b.draft)).status,'processing');
  assert.equal(f.starts.length,1);assert.equal(f.applied.length,1);
  assert.equal(f.applied[0].revision,2);assert.ok(f.applied[0].image.size>0);
  assert.ok(f.requests.some(row=>row.path==='/api/try-on/'+OP+'/look'&&row.method==='PATCH'));
  assert.equal(f.streams.at(-1)?.snapshot.outfit.revision,2);
  assert.equal(f.remote.track.stops,0);
  await f.controller.stop();
  assert.equal(f.remote.track.readyState,'ended');assert.equal(f.inputMedia.track.readyState,'ended');
  assert.equal(f.remote.listeners.size,0);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/stop')).length,1);
});

test('coalesced top updates cannot publish an old set completion as the new candidate',async()=>{
  const f=fixture(),a=selection(),b=selection(2,11),c=selection(3,12),d=selection(4,13);
  [a,b,c,d].forEach(value=>f.register(value));f.live();
  await f.controller.submitSelected(a.snapshot,a.draft);
  const hold=deferred<boolean>(),entered=deferred<void>();
  f.ports.realtime.applyLook=async look=>{f.applied.push(look);if(look.revision===2){entered.resolve();return hold.promise;}return true;};
  const pb=f.controller.submitSelected(b.snapshot,b.draft);await entered.promise;
  const pc=f.controller.submitSelected(c.snapshot,c.draft),pd=f.controller.submitSelected(d.snapshot,d.draft);
  assert.equal((await pc).status,'stale');assert.equal(f.streams.at(-1),null);
  hold.resolve(true);
  assert.equal((await pb).status,'stale');assert.equal((await pd).status,'processing');
  assert.deepEqual(f.applied.map(look=>look.revision),[2,4]);
  assert.ok(!f.streams.some(binding=>binding?.snapshot.outfit.revision===2));
  assert.equal(f.streams.at(-1)?.snapshot.outfit.revision,4);
  assert.equal(f.starts.length,1);await f.controller.stop();
});

test('mismatched server look validation fails closed without applying or retaining the stream',async()=>{
  const f=fixture(),a=selection(),b=selection(2,11);f.register(a);f.register(b);f.live();
  await f.controller.submitSelected(a.snapshot,a.draft);
  const original=f.ports.request;
  f.ports.request=async(...args)=>args[0].endsWith('/look')?{...(await original(...args)),reference_asset_version:99}:original(...args);
  assert.equal((await f.controller.submitSelected(b.snapshot,b.draft)).status,'error');
  assert.equal(f.applied.length,0);assert.equal(f.remote.track.readyState,'ended');
  assert.equal(f.streams.at(-1),null);assert.equal(f.results.at(-1),null);
});

test('logout while paid submission is pending stops the late operation without connecting',async()=>{
  const f=fixture(),value=selection(),hold=deferred<Record<string,unknown>>(),entered=deferred<void>();f.register();f.live();
  f.ports.tryOn=async()=>{entered.resolve();return hold.promise;};
  const pending=f.controller.submitSelected(value.snapshot,value.draft);await entered.promise;
  await f.controller.reset();
  hold.resolve({mode:'live',operation_id:OP,result:{absolute_end_at:new Date(1030000).toISOString()}});
  assert.equal((await pending).status,'stale');
  assert.equal(f.current(),null);assert.equal(f.inputMedia.track.readyState,'ended');
  assert.equal(f.requests.filter(row=>row.path.endsWith('/stop')).length,1);
  assert.equal(f.streams.at(-1),null);
});

test('late stream after stop is released and natural end clears every listener and presentation',async()=>{
  const f=fixture(),value=selection();f.register();f.live();
  await f.controller.submitSelected(value.snapshot,value.draft);
  const callback=f.current()!.onRemoteStream;
  f.remote.track.end();await tick();
  assert.equal(f.streams.at(-1),null);assert.equal(f.remote.listeners.size,0);
  const late=media();callback(late.stream);
  assert.equal(late.track.readyState,'ended');assert.equal(f.streams.at(-1),null);
});

test('batch result reads an existing operation without a lookup fallback or another creation',async()=>{
  const f=fixture(),value=selection();f.register();f.live('live-batch');
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'processing');
  assert.equal(f.stats().fetches,0);assert.ok(f.results.every(result=>result===null));
  assert.equal((await f.controller.loadBatchResult()).status,'ready');
  assert.equal((f.results.at(-1) as FittingCandidate|null)?.origin,'provider-batch');
  assert.equal(f.stats().fetches,1);assert.equal(f.starts.length,1);
  await f.controller.stop();assert.deepEqual(f.revoked,['blob:fixture-1']);
});



test('identical taps share one paid submission and do not restart an established session',async()=>{
  const f=fixture(),value=selection();f.register();f.live();
  const first=f.controller.submitSelected(value.snapshot,value.draft);
  const second=f.controller.submitSelected(value.snapshot,value.draft);
  assert.equal(first,second);await first;
  assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'processing');
  assert.equal(f.starts.length,1);assert.equal(f.requests.filter(row=>row.path.endsWith('/stop')).length,0);
  await f.controller.stop();
});

test('changing confirmed inputs during a saved lookup discards the earlier input response',async()=>{
  const f=fixture(),value=selection(),registered=f.register(),hold=deferred<Record<string,unknown>>(),entered=deferred<void>();
  f.ports.request=async()=>{entered.resolve();return hold.promise;};
  const pending=f.controller.submitSelected(value.snapshot,value.draft);await entered.promise;
  f.controller.registerInputs({...registered,reference:asset(900)});
  hold.resolve({mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:OP,result_asset_id:RESULT});
  assert.equal((await pending).status,'stale');assert.equal(f.stats().fetches,0);
  assert.equal(f.results.at(-1),null);
});

test('late stop completion cannot overwrite a new request state',async()=>{
  const f=fixture(),value=selection(),hold=deferred<void>();f.register();
  let stops=0;f.ports.realtime.stop=async()=>{if(++stops===1)await hold.promise;};
  const stopping=f.controller.stop();
  const next=f.controller.submitSelected(value.snapshot,value.draft);
  await tick();hold.resolve();await stopping;
  assert.equal((await next).status,'ready');
  assert.ok(!f.states.some(state=>state.status==='idle'));
  assert.equal(f.states.at(-1)?.status,'ready');
});


function readyPreflight(f:ReturnType<typeof fixture>,value=selection()){
 const original=f.ports.request;
 f.ports.request=async(path,method,body)=>{
  if(path!=='/api/try-on/preflight')return original(path,method,body);
  f.requests.push({path,method,body});
  const request=body as Record<string,unknown>,versions:Record<string,number>={};
  for(let n=1;n<2000;n++)versions[id(n)]=1;
  return {status:'ready',mode:'live-batch',noExecution:true,snapshot:request.snapshot,personAssetId:PERSON,personAssetVersion:1,
   referenceAssetId:(request.reference_asset_id),referenceAssetVersion:1,
   approval:{ownerId:OWNER,approvalId:id(50),validUntilMs:1060000,perRequestUsd:1,totalUsd:2,maxGeneratedSeconds:30,allowedAssetVersions:versions},
   budget:{remainingUsd:2,remainingSeconds:30,estimatedUsd:.2}};
 };
}
function scheduler(f:ReturnType<typeof fixture>){
 let time=1000000,next=0;
 const tasks=new Map<number,{at:number;fn:()=>void}>();
 f.ports.now=()=>time;f.ports.schedule=(fn,ms)=>{tasks.set(++next,{at:time+ms,fn});return next;};
 f.ports.cancelSchedule=handle=>tasks.delete(handle as number);
 return {tasks,async advance(ms:number){const until=time+ms;for(;;){const candidate=[...tasks.entries()].filter(([,task])=>task.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!candidate)break;time=candidate[1].at;tasks.delete(candidate[0]);candidate[1].fn();await tick();}time=until;await tick();}};
}
test('verified read-only preparation survives same-owner SPA handoff and starts once on the mirror tap',async()=>{
 const f=fixture(),value=selection(),repository={};f.controller.bindContext(OWNER,repository);f.register();readyPreflight(f);scheduler(f);
 assert.equal((await f.controller.prepareExecution(value.snapshot,value.draft)).status,'ready');
 assert.equal(f.starts.length,0);assert.equal(f.requests.filter(row=>row.path==='/api/try-on').length,0);
 await f.controller.stop(); // preparation screen cleanup only
 f.controller.bindContext(OWNER,repository);
 assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'processing');
 assert.equal(f.starts.length,1);await f.controller.stop();
 f.controller.bindContext(OWNER,{}); // replaced authenticated repository
 assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'blocked');
 assert.equal(f.starts.length,1);
});
test('preflight refuses mismatched snapshot and realtime strict-bound block without starting',async()=>{
 const f=fixture(),value=selection();f.register();readyPreflight(f);
 const original=f.ports.request;
 f.ports.request=async(...args)=>({...await original(...args),snapshot:selection(2,11).snapshot});
 await assert.rejects(f.controller.prepareExecution(value.snapshot,value.draft),/일치하지/);
 f.ports.request=async()=>({status:'blocked',reasonCode:'strict_bound_unverified',message:'strict bound unverified'});
 assert.equal((await f.controller.prepareExecution(value.snapshot,value.draft,'realtime')).status,'blocked');
 assert.equal(f.starts.length,0);
});
test('natural provider stop clears duplicate-submission cache without automatically restarting',async()=>{
 const f=fixture(),value=selection();f.register();f.live();
 await f.controller.submitSelected(value.snapshot,value.draft);
 await f.current()!.onStopped(OP);
 assert.equal(f.starts.length,1);assert.equal(f.controller.getCurrentOperation(),null);
 assert.equal(f.states.at(-1)?.status,'idle');
 await f.controller.submitSelected(value.snapshot,value.draft);
 assert.equal(f.starts.length,2);await f.controller.stop();
});
test('bounded batch polling reads the original completed job and never creates another job',async()=>{
 const f=fixture(),value=selection(),clock=scheduler(f);f.register();f.live('live-batch');
 const original=f.ports.request;let checks=0;
 f.ports.request=async(...args)=>args[0].endsWith('/status')
  ?{operation_id:OP,processing_status:'running',result:{provider_status:++checks>=2?'completed':'pending'}}
  :original(...args);
 await f.controller.submitSelected(value.snapshot,value.draft);await tick();
 assert.equal(f.starts.length,1);assert.equal(f.stats().fetches,0);
 await clock.advance(2000);
 assert.equal(f.results.at(-1)?.origin,'provider-batch');
 assert.equal(f.starts.length,1);assert.equal(checks,2);assert.equal(clock.tasks.size,0);
 await f.controller.stop();
});
test('poll timeout stays pending and repeated selection rechecks the original operation without new generation',async()=>{
 const f=fixture(),value=selection(),clock=scheduler(f);f.register();f.live('live-batch');
 const original=f.ports.request;let checks=0;
 f.ports.request=async(...args)=>{if(args[0].endsWith('/status')){checks++;return {operation_id:OP,processing_status:'running',result:{provider_status:'pending'}};}return original(...args);};
 await f.controller.submitSelected(value.snapshot,value.draft);await clock.advance(60000);
 assert.equal(checks,30);assert.equal(clock.tasks.size,0);assert.match(f.states.at(-1)!.message,/60초.*30회/);
 await f.controller.submitSelected(value.snapshot,value.draft);await tick();
 assert.equal(f.starts.length,1);assert.equal(checks,31);await f.controller.stop();assert.equal(clock.tasks.size,0);
});
test('stop cancels polling timers and a late status cannot read or display a result',async()=>{
 const f=fixture(),value=selection(),clock=scheduler(f),hold=deferred<Record<string,unknown>>();f.register();f.live('live-batch');
 const original=f.ports.request;f.ports.request=async(...args)=>args[0].endsWith('/status')?hold.promise:original(...args);
 await f.controller.submitSelected(value.snapshot,value.draft);await f.controller.stop();
 assert.equal(clock.tasks.size,0);
 hold.resolve({operation_id:OP,processing_status:'succeeded'});await tick();
 assert.equal(f.stats().fetches,0);assert.equal(f.results.at(-1),null);assert.equal(f.starts.length,1);
});

function recoveryPreflight(f:ReturnType<typeof fixture>,providerReady=true){
 const original=f.ports.request;
 f.ports.request=async(path,method,body)=>{
  if(path!=='/api/try-on/preflight')return original(path,method,body);
  const request=body as Record<string,unknown>;
  return {status:'existing_operation',mode:'live-batch',noExecution:true,snapshot:request.snapshot,
   personAssetId:request.person_asset_id,personAssetVersion:1,referenceAssetId:request.reference_asset_id,referenceAssetVersion:1,
   existingOperation:{operationId:OP,processingStatus:providerReady?'running':'unknown_submission',providerReady}};
 };
}
test('lost start response recovers exact server operation without a second tryOn even when approval is gone',async()=>{
 const f=fixture(),value=selection(),clock=scheduler(f);f.register();f.live('live-batch');
 f.ports.tryOn=async(...args)=>{f.starts.push(args);throw new Error('lost HTTP response after accepted job');};
 assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'error');
 assert.equal(f.starts.length,1);
 recoveryPreflight(f);
 assert.equal((await f.controller.prepareExecution(value.snapshot,value.draft)).status,'ready');
 const original=f.ports.request;f.ports.request=async(...args)=>args[0].endsWith('/status')
  ?{operation_id:OP,processing_status:'succeeded',file_status:'acquired'}:original(...args);
 assert.equal((await f.controller.submitSelected(value.snapshot,value.draft)).status,'processing');
 await tick();
 assert.equal(f.starts.length,1);assert.equal(f.results.at(-1)?.origin,'provider-batch');
 assert.equal(f.controller.getCurrentOperation()?.operationId,OP);assert.equal(clock.tasks.size,0);
 await f.controller.stop();
});
test('unknown existing submission only polls its original metadata until a provider ID becomes known',async()=>{
 const f=fixture(),value=selection(),clock=scheduler(f);f.register();recoveryPreflight(f,false);
 await f.controller.prepareExecution(value.snapshot,value.draft);
 const original=f.ports.request;let metadata=0,statuses=0;
 f.ports.request=async(...args)=>{
  if(args[0]==='/api/operations/'+OP){metadata++;return {operation_id:OP,processing_status:'unknown_submission',provider_id:null};}
  if(args[0].endsWith('/status')){statuses++;throw new Error('must not call unknown provider');}
  return original(...args);
 };
 await f.controller.submitSelected(value.snapshot,value.draft);await clock.advance(4000);
 assert.equal(f.starts.length,0);assert.equal(metadata,3);assert.equal(statuses,0);assert.equal(f.stats().fetches,0);
 await f.controller.stop();assert.equal(clock.tasks.size,0);
});

test('preparing an already tracked exact operation preserves its session and submission without stop or restart',async()=>{
 const f=fixture(),value=selection(),clock=scheduler(f);f.register();f.live('live-batch');
 const first=f.controller.submitSelected(value.snapshot,value.draft);await first;await tick();
 const active=f.controller.getCurrentOperation();
 recoveryPreflight(f);
 assert.equal((await f.controller.prepareExecution(value.snapshot,value.draft)).status,'ready');
 const repeated=f.controller.submitSelected(value.snapshot,value.draft);
 assert.equal(repeated,first);await repeated;await clock.advance(2000);
 assert.deepEqual(f.controller.getCurrentOperation(),active);
 assert.equal(f.starts.length,1);
 assert.equal(f.requests.filter(row=>row.path.endsWith('/stop')).length,0);
 const statuses=f.requests.filter(row=>row.path.endsWith('/status'));
 assert.equal(statuses.length,2);assert.ok(statuses.every(row=>row.path==='/api/try-on/'+OP+'/status'));
 await f.controller.stop();
});
