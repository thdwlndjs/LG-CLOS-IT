import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupSavedFitting} from '../src/FittingControls';
import {BackendError} from '../src/integrations/backendClient';
import {createSeed,DEMO_PROFILE,type Asset} from '../src/core/index';
import {buildFittingSnapshot,selectFittingPresentation} from '../src/mirrorScene';

const personId='11111111-1111-4111-8111-111111111111';
const referenceId='22222222-2222-4222-8222-222222222222';
const operationId='33333333-3333-4333-8333-333333333333';
const resultId='44444444-4444-4444-8444-444444444444';
const success={mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',operation_id:operationId,result_asset_id:resultId};
function inputs(){
 const seed=createSeed(),draft=seed.outfitDrafts[DEMO_PROFILE];draft.items.bottom='g-jeans';draft.items.outer='g-jacket';
 const snapshot=buildFittingSnapshot({ownerId:DEMO_PROFILE,person:{id:'fixture-photo-only',version:1,url:'blob:fixture-photo'},outfit:draft,garments:seed.garments,requestVersion:7}).snapshot!;
 const asset=(id:string):Asset=>({id,version:1,source:'storage',url:`/api/assets/${id}/content`});
 return{draft,person:asset(personId),reference:asset(referenceId),snapshot};
}
const fixtureBytes=new Uint8Array([1,2,3,4]); // Transport contract only; not a decoded video or actual provider evidence.
const media=(mime='video/mp4')=>new Response(fixtureBytes,{status:200,headers:{'content-type':mime}});

test('saved fitting sends the exact draft/input IDs in saved_result mode and only reads the returned private asset',async()=>{
 const input=inputs(),calls:string[]=[];
 const result=await lookupSavedFitting(input,{
  isCurrent:()=>true,
  request:async(path,method,body)=>{calls.push(`${method} ${path}`);assert.equal(path,'/api/try-on');assert.equal(method,'POST');
   const sent=body as Record<string,unknown>;assert.equal(sent.mode,'saved_result');assert.equal(sent.person_asset_id,personId);assert.equal(sent.reference_asset_id,referenceId);assert.equal(sent.fitting_mode,'batch');assert.deepEqual(sent.draft,input.draft);assert.equal(typeof sent.intent_key,'string');return success;},
  fetch:async(url,init)=>{calls.push(`${init?.method} ${url}`);assert.equal(String(url),`/api/assets/${resultId}/content`);assert.equal(init?.credentials,'same-origin');assert.equal(init?.cache,'no-store');return media();},
 });
 assert.equal(result.status,'ready');if(result.status!=='ready')return;
 assert.equal(result.operationId,operationId);assert.equal(result.resultId,resultId);assert.equal(result.mediaKind,'video');assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),fixtureBytes);
 assert.deepEqual(calls,['POST /api/try-on',`GET /api/assets/${resultId}/content`]);
 const view=selectFittingPresentation({current:input.snapshot,request:{snapshot:input.snapshot,status:'completed'},result:{snapshot:input.snapshot,origin:'saved',status:'ready',content:'fitting-result',operationId:result.operationId,resultId:result.resultId,media:{kind:result.mediaKind,url:'blob:fixture-result'}}});
 assert.equal(view.display,'fitting-result');assert.equal(view.label,'저장된 피팅 결과');
});

test('missing saved match remains unavailable without asset fetch, live fallback, provider polling or cancellation',async()=>{
 const calls:string[]=[];
 const result=await lookupSavedFitting(inputs(),{isCurrent:()=>true,request:async(path,_method,body)=>{calls.push(path);assert.equal((body as {mode:string}).mode,'saved_result');throw new BackendError('result_unavailable','no matching fixture',404);},fetch:async()=>{throw new Error('must not fetch any result/provider');}});
 assert.equal(result.status,'unavailable');assert.deepEqual(calls,['/api/try-on']);if(result.status==='unavailable')assert.match(result.message,/새 API 실행은 하지 않았습니다/);
});

test('selection or owner change while lookup is pending prevents even the stored-file read',async()=>{
 let current=true,fetchCount=0;
 const result=await lookupSavedFitting(inputs(),{isCurrent:()=>current,request:async()=>{current=false;return success;},fetch:async()=>{fetchCount++;return media();}});
 assert.equal(result.status,'stale');assert.equal(fetchCount,0);
});

test('stop or selection change while stored bytes are pending prevents result application',async()=>{
 let current=true;
 const result=await lookupSavedFitting(inputs(),{isCurrent:()=>current,request:async()=>success,fetch:async()=>{const response=media();response.blob=async()=>{current=false;return new Blob([fixtureBytes],{type:'video/mp4'});};return response;}});
 assert.equal(result.status,'stale');
});

test('invalid ownership, draft revision, slot selection and non-storage inputs never query the backend',async()=>{
 for(const mutate of [
  (v:ReturnType<typeof inputs>)=>{v.draft.ownerId='other-owner';},
  (v:ReturnType<typeof inputs>)=>{v.draft.revision++;},
  (v:ReturnType<typeof inputs>)=>{v.draft.items.bottom='g-slacks';},
  (v:ReturnType<typeof inputs>)=>{v.person.source='upload';},
  (v:ReturnType<typeof inputs>)=>{v.reference.id='../not-a-private-asset';},
 ]){const input=inputs();mutate(input);let queries=0;await assert.rejects(lookupSavedFitting(input,{isCurrent:()=>true,request:async()=>{queries++;return success;},fetch:async()=>media()}),/참조/);assert.equal(queries,0);}
});

test('non-saved metadata, unready results, stale apply status and unsafe result paths cannot yield a fitting file',async()=>{
 for(const patch of [
  {mode:'live'},{processing_status:'running'},{apply_status:'stale'},{operation_id:'mock-fixture'},
  {result_asset_id:null},{result_asset_id:'https://provider.invalid/result'},{result_asset_id:'../../api/try-on/result'},
 ]){let reads=0;const result=await lookupSavedFitting(inputs(),{isCurrent:()=>true,request:async()=>({...success,...patch}),fetch:async()=>{reads++;return media();}});assert.equal(result.status,'unavailable');assert.equal(reads,0);}
});

test('saved images keep image semantics; missing, empty or unsupported files remain unavailable',async()=>{
 const result=await lookupSavedFitting(inputs(),{isCurrent:()=>true,request:async()=>success,fetch:async()=>media('image/png')});
 assert.equal(result.status,'ready');if(result.status==='ready')assert.equal(result.mediaKind,'image');
 for(const response of [new Response(null,{status:404}),media('text/html'),new Response(null,{status:200,headers:{'content-type':'video/mp4'}})]){
  const missing=await lookupSavedFitting(inputs(),{isCurrent:()=>true,request:async()=>success,fetch:async()=>response});assert.equal(missing.status,'unavailable');
 }
});

test('authentication/network failures remain distinct from an absent saved match',async()=>{
 const expired=new BackendError('session_expired','fixture session expired',401);
 await assert.rejects(lookupSavedFitting(inputs(),{isCurrent:()=>true,request:async()=>{throw expired;},fetch:async()=>media()}),error=>error===expired);
 await assert.rejects(lookupSavedFitting(inputs(),{isCurrent:()=>true,request:async()=>success,fetch:async()=>new Response(null,{status:403})}),/접근 권한/);
});
