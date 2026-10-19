import test from 'node:test';
import assert from 'node:assert/strict';
import {FittingResultRecovery,type FittingRecoveryIdentity} from '../src/fittingResultRecovery';
import {buildFittingSnapshot,selectFittingPresentation,type FittingCandidate} from '../src/mirrorScene';
import {createWardrobePackBundle,PACK_PERSON,PACK_PROFILE_ID} from '../src/wardrobePack';

function fixture(){
  const bundle=createWardrobePackBundle();
  const snapshot=buildFittingSnapshot({ownerId:PACK_PROFILE_ID,person:PACK_PERSON,outfit:bundle.outfitDraft,
    garments:bundle.garments,requestVersion:1}).snapshot!;
  const identity:FittingRecoveryIdentity={snapshot,inputFingerprint:'same-owner-person-reference-and-full-draft'};
  const result:FittingCandidate={snapshot:structuredClone(snapshot),origin:'saved',status:'ready',
    content:'fitting-result',resultId:'saved-result-1',media:{kind:'image',url:'blob:successful-result'}};
  const released:string[]=[];
  return{identity,result,released,recovery:new FittingResultRecovery(url=>released.push(url))};
}

test('a retry failure restores the exact prior complete result without releasing its valid URL',()=>{
  const {identity,result,released,recovery}=fixture();
  recovery.replace(identity,result);
  const duringRetry=recovery.read(identity)!;
  assert.equal(selectFittingPresentation({current:identity.snapshot,request:{snapshot:identity.snapshot,status:'processing'},result:duringRetry.result}).display,'fitting-result');
  const restored=recovery.read(identity)!;
  assert.equal(restored.request.status,'completed');
  assert.deepEqual(restored.result,result);
  assert.equal(selectFittingPresentation({current:identity.snapshot,request:restored.request,result:restored.result}).display,'fitting-result');
  assert.deepEqual(released,[]);
});

test('different owner, person, every full-snapshot identity and input asset invalidate recovery permanently',()=>{
  const mutations:((identity:FittingRecoveryIdentity)=>void)[]=[
    value=>{value.snapshot.ownerId='other-owner';},
    value=>{value.snapshot.person.assetId='other-person';},
    value=>{value.snapshot.person.assetVersion++;},
    value=>{value.snapshot.outfit.draftId='other-draft';},
    value=>{value.snapshot.outfit.revision++;},
    value=>{value.snapshot.outfit.items[0].garmentId='another-garment';},
    value=>{value.snapshot.outfit.items[0].assetId='another-asset';},
    value=>{value.snapshot.outfit.items[0].assetVersion++;},
    value=>{value.snapshot.outfit.items.pop();},
    value=>{value.snapshot.requestVersion++;},
    value=>{value.inputFingerprint='different-person-video-or-reference';},
  ];
  for(const mutate of mutations){
    const {identity,result,released,recovery}=fixture();recovery.replace(identity,result);
    const next=structuredClone(identity);mutate(next);
    assert.equal(recovery.read(next),null);
    assert.deepEqual(released,['blob:successful-result']);
    assert.equal(recovery.read(identity),null,'returning to a former selection does not revive released media');
  }
});

test('explicit stop and logout release retained media once and never restore it',()=>{
  for(const invalidation of ['stop','logout'] as const){
    const {identity,result,released,recovery}=fixture();recovery.replace(identity,result);
    if(invalidation==='stop')recovery.clear();else assert.equal(recovery.read(null),null);
    recovery.clear();
    assert.equal(recovery.read(identity),null);
    assert.deepEqual(released,['blob:successful-result']);
  }
});

test('a verified replacement releases the previous URL only after the new result is retained',()=>{
  const {identity,result,released,recovery}=fixture();recovery.replace(identity,result);
  const replacement:FittingCandidate={...result,origin:'provider-batch',resultId:undefined,operationId:'operation-2',media:{kind:'video',url:'blob:new-result'}};
  recovery.replace(identity,replacement);
  assert.deepEqual(released,['blob:successful-result']);
  assert.deepEqual(recovery.read(identity)?.result,replacement);
  recovery.replace(identity,replacement);
  assert.deepEqual(released,['blob:successful-result'],'reusing the same valid URL does not release it');
});

test('invalid, stale, incomplete and stream candidates cannot displace a previous valid result',()=>{
  const {identity,result,released,recovery}=fixture();recovery.replace(identity,result);
  const stale=structuredClone(result);stale.snapshot.outfit.items[0].garmentId='old-outfit';
  const cases:FittingCandidate[]=[
    stale,{...result,status:'failed'},{...result,status:'processing'},
    {...result,content:'outfit-card'},{...result,media:null},{...result,resultId:undefined},
    {...result,origin:'provider-batch',resultId:undefined,operationId:undefined},
    {...result,origin:'provider-realtime',operationId:'stream-1',media:{kind:'stream',streamId:'stream-1'}},
  ];
  for(const candidate of cases)assert.throws(()=>recovery.replace(identity,candidate),/정상 피팅 결과/);
  assert.deepEqual(recovery.read(identity)?.result,result);
  assert.deepEqual(released,[]);
});

test('captured and returned recovery values are isolated from later caller edits',()=>{
  const {identity,result,recovery}=fixture();
  const expected=structuredClone(identity);recovery.replace(identity,result);
  identity.snapshot.outfit.items[0].garmentId='mutated-input';
  result.snapshot.person.assetId='mutated-result';
  const first=recovery.read(expected)!;first.result.snapshot.person.assetId='mutated-read';
  assert.equal(recovery.read(expected)?.result.snapshot.person.assetId,expected.snapshot.person.assetId);
});

