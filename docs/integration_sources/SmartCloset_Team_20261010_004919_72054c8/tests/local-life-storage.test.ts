import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalLifeApp,LOCAL_LIFE_STORAGE_KEY} from '../src/localLifeStorage';
import {buildLocalLifePack,LOCAL_LIFE_NAMESPACE,LOCAL_LIFE_PROFILE_IDS,localLifeId} from '../src/lifeData/localPack';
import {STORAGE_KEY} from '../src/core/seed';
import {DemoError} from '../src/core/repository';
import {parseCareEvidence,type CareEvidenceItem} from '../src/careEvidence';
import type {StorageLike} from '../src/core/types';

class Store implements StorageLike {
 values=new Map<string,string>([[STORAGE_KEY,'legacy byte-for-byte sentinel that is not JSON']]);
 access:{operation:'get'|'set'|'remove';key:string}[]=[];
 fail=false;
 getItem(key:string){this.access.push({operation:'get',key});return this.values.get(key)??null;}
 setItem(key:string,value:string){this.access.push({operation:'set',key});if(this.fail){const error=new Error('Quota exceeded');error.name='QuotaExceededError';throw error;}this.values.set(key,value);}
 removeItem(key:string){this.access.push({operation:'remove',key});this.values.delete(key);}
}
const fast={delayMs:0},ids=LOCAL_LIFE_PROFILE_IDS,id=localLifeId;

test('installation writes only the separate local area and never reads or mutates legacy user storage',()=>{
 const storage=new Store(),before=storage.values.get(STORAGE_KEY),{app,installation}=createLocalLifeApp(storage);
 assert.equal(installation.status,'installed');assert.equal(app.persistence.status,'ready');assert.equal(storage.values.get(STORAGE_KEY),before);
 assert(storage.access.every(call=>call.key===LOCAL_LIFE_STORAGE_KEY));assert.equal(storage.access.filter(call=>call.operation==='set').length,1);assert(!storage.access.some(call=>call.operation==='remove'));
 const stored=JSON.parse(storage.values.get(LOCAL_LIFE_STORAGE_KEY)!);assert.equal(stored.garments.length,32);assert.equal(stored.outfits.length,18);assert.equal(stored.events.length,70);
 const receipt=stored.localDatasets[LOCAL_LIFE_NAMESPACE];assert.equal(receipt.version,installation.version);assert.equal(receipt.sourceFingerprint,installation.sourceFingerprint);assert(Number.isFinite(Date.parse(receipt.installedAt)));
 assert.deepEqual(stored.receipts,[]); // A pack installation is not a fabricated care or card action.
});
test('unchanged pack restart restores the same installed state without another seed write or duplicate rows',()=>{
 const storage=new Store(),first=createLocalLifeApp(storage),raw=storage.values.get(LOCAL_LIFE_STORAGE_KEY)!;storage.access=[];
 const second=createLocalLifeApp(storage);assert.equal(second.installation.status,'restored');assert.equal(second.app.persistence.status,'ready');
 assert.deepEqual(second.app.getState(),first.app.getState());assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),raw);assert.deepEqual(storage.access,[{operation:'get',key:LOCAL_LIFE_STORAGE_KEY}]);
 assert.equal(second.app.getState().events.length,70);assert.equal(second.app.getState().outfits.length,18);
});
test('profile drafts, edited card, care and selection records survive profile round trips and independent app reinstantiation',async()=>{
 const storage=new Store(),{app}=createLocalLifeApp(storage);
 app.loadOutfitDraft(id('outfit','LS01'));app.editOutfitName('수진 보관한 초안');app.setCalendarDate('2026-10-04');app.setScreen('care');
 const suDraft=structuredClone(app.outfitDraft());const care=await app.recordActualCare(id('garment','S01'),'환기 완료','local-storage-su-care',fast);
 app.setActiveProfile(ids.PHW);app.loadOutfitDraft(id('outfit','LH01'));app.setOutfitItem('top',id('garment','H02'));app.editOutfitName('휘재 직접 바꾼 셔츠 코디');
 const saved=await app.saveOutfit('local-storage-hw-card',fast),selected=await app.commitCurrentSelection('2026-10-09',{...fast,intentKey:'local-storage-hw-selected'});
 app.setCalendarDate('2026-10-09');app.setScreen('calendar');const hwDraft=structuredClone(app.outfitDraft());
 const originalCounts={outfits:app.getState().outfits.length,events:app.getState().events.length,receipts:app.getState().receipts.length};
 app.setActiveProfile(ids.PSU);assert.deepEqual(app.outfitDraft(),suDraft);assert.equal(app.ui().calendarDate,'2026-10-04');assert(app.events().some(e=>e.id===care.entity.id));assert(!app.events().some(e=>e.id===selected.event.id));
 app.setActiveProfile(ids.PHW);assert.deepEqual(app.outfitDraft(),hwDraft);
 for(let run=0;run<3;run++){
  const restarted=createLocalLifeApp(storage);assert.equal(restarted.installation.status,'restored');const state=restarted.app.getState();
  assert.equal(state.activeProfileId,ids.PHW);assert.deepEqual(state.outfitDrafts[ids.PSU],suDraft);assert.deepEqual(state.outfitDrafts[ids.PHW],hwDraft);assert.equal(state.ui[ids.PSU].calendarDate,'2026-10-04');assert.equal(state.ui[ids.PHW].calendarDate,'2026-10-09');assert.equal(state.ui[ids.PHW].screen,'calendar');
  assert.equal(state.outfits.find(o=>o.id===saved.entity.id)!.name,'휘재 직접 바꾼 셔츠 코디');assert.equal(state.outfits.find(o=>o.id===saved.entity.id)!.items.top,id('garment','H02'));
  assert(state.events.some(e=>e.id===care.entity.id&&e.ownerId===ids.PSU));assert(state.events.some(e=>e.id===selected.event.id&&e.ownerId===ids.PHW&&e.kind==='plan'));assert.equal(state.events.filter(e=>e.kind==='wear').length,26);
  assert.deepEqual({outfits:state.outfits.length,events:state.events.length,receipts:state.receipts.length},originalCounts);
 }
 assert(storage.access.every(call=>call.key===LOCAL_LIFE_STORAGE_KEY));assert.equal(storage.values.get(STORAGE_KEY),'legacy byte-for-byte sentinel that is not JSON');
});
test('changed source fingerprint or version preserves saved edits and reports source-changed without writing',()=>{
 for(const change of ['fingerprint','version'] as const){
  const storage=new Store(),first=createLocalLifeApp(storage);first.app.repository.commit(state=>{state.garments[0].name='사용자 편집 이름';});const raw=storage.values.get(LOCAL_LIFE_STORAGE_KEY)!;
  const pack=buildLocalLifePack();if(change==='fingerprint')pack.report.sourceFingerprint='different-source';else pack.report.version='next-version';pack.state.garments[0].name='새 팩 기본값';storage.access=[];
  const restored=createLocalLifeApp(storage,pack);assert.equal(restored.installation.status,'source-changed');assert.equal(restored.app.getState().garments[0].name,'사용자 편집 이름');assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),raw);assert.deepEqual(storage.access,[{operation:'get',key:LOCAL_LIFE_STORAGE_KEY}]);
 }
});
test('an existing valid local area with no installation receipt is a conflict and is not overwritten',()=>{
 const storage=new Store(),{app}=createLocalLifeApp(storage);app.repository.commit(state=>{delete state.localDatasets;state.garments[0].name='영수증 없는 기존 편집';});
 const raw=storage.values.get(LOCAL_LIFE_STORAGE_KEY)!;storage.access=[];const restored=createLocalLifeApp(storage);
 assert.equal(restored.installation.status,'conflict');assert.equal(restored.app.persistence.status,'ready');assert.equal(restored.app.getState().garments[0].name,'영수증 없는 기존 편집');assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),raw);assert.deepEqual(storage.access,[{operation:'get',key:LOCAL_LIFE_STORAGE_KEY}]);
});
test('corrupt local storage remains untouched while the fallback is explicitly memory-only',async()=>{
 for(const raw of ['{broken json',JSON.stringify({schemaVersion:1,profiles:[]})]){
  const storage=new Store();storage.values.set(LOCAL_LIFE_STORAGE_KEY,raw);const {app,installation}=createLocalLifeApp(storage);
  assert.equal(installation.status,'memory-only');assert.equal(app.persistence.status,'memory-only');assert.equal(app.persistence.reason,'corrupt');assert.equal(app.getState().garments.length,32);
  app.setActiveProfile(ids.PHW);app.loadOutfitDraft(id('outfit','LH01'));app.editOutfitName('복구되지 않은 메모리 초안');
  await assert.rejects(app.saveOutfit('corrupt-never-overwrite',fast),(error:unknown)=>error instanceof DemoError&&error.code==='STORAGE');
  assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),raw);assert.equal(app.getState().outfits.length,18);assert(!storage.access.some(call=>call.operation==='set'||call.operation==='remove'));
 }
});
test('quota denial cannot claim installation or persist a new card and keeps previous durable bytes',async()=>{
 const firstStorage=new Store();firstStorage.fail=true;const first=createLocalLifeApp(firstStorage);
 assert.equal(first.installation.status,'memory-only');assert.equal(first.app.persistence.status,'memory-only');assert.equal(first.app.persistence.reason,'quota');assert.equal(first.app.getState().localDatasets,undefined);assert(!firstStorage.values.has(LOCAL_LIFE_STORAGE_KEY));
 const storage=new Store(),{app}=createLocalLifeApp(storage);app.setActiveProfile(ids.PHW);app.loadOutfitDraft(id('outfit','LH01'));app.editOutfitName('용량 부족 때 보존할 초안');const raw=storage.values.get(LOCAL_LIFE_STORAGE_KEY)!;storage.fail=true;
 app.editOutfitName('메모리에만 남는 수정');await assert.rejects(app.saveOutfit('quota-card',fast),(error:unknown)=>error instanceof DemoError&&error.code==='STORAGE');
 assert.equal(app.persistence.status,'memory-only');assert.equal(app.persistence.reason,'quota');assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),raw);assert.equal(app.getState().outfits.length,18);assert.equal(app.receipts().length,0);assert.equal(app.outfitDraft()!.name,'메모리에만 남는 수정');
});
test('scoped local care evidence accepts exact owner and garment but rejects a cross-profile or namespace response',()=>{
 const {state}=buildLocalLifePack(),evidence=state.careEvidence!.find(e=>e.garmentId===id('garment','S01'))!;
 const response={ownerId:evidence.ownerId,garmentId:evidence.garmentId,evidence:[evidence]};const parsed=parseCareEvidence(response,evidence.ownerId,evidence.garmentId);assert.deepEqual(parsed,response);assert.notEqual(parsed.evidence[0],evidence);
 const variants=[{...response,ownerId:ids.PHW},{...response,garmentId:id('garment','H01')},{...response,evidence:[{...evidence,ownerId:ids.PHW}]},{...response,evidence:[{...evidence,garmentId:id('garment','H01')}]},{...response,evidence:[{...evidence,id:'local:another-pack:evidence:EV-S01'}]},{...response,evidence:[{...evidence,id:'local:scprep-20261009-v1:evidence:../EV-S01'}]}];
 for(const candidate of variants)assert.throws(()=>parseCareEvidence(candidate,evidence.ownerId,evidence.garmentId));
 assert.throws(()=>parseCareEvidence({...response,evidence:[evidence,evidence]},evidence.ownerId,evidence.garmentId));
});
test('remote UUID owner and garment retain UUID-only evidence and strict physical label asset validation',()=>{
 const ownerId='11111111-1111-4111-8111-111111111111',garmentId='22222222-2222-4222-8222-222222222222';
 const remote:CareEvidenceItem={id:'33333333-3333-4333-8333-333333333333',ownerId,garmentId,kind:'official_guidance',originalText:'Retained official guidance',sourceRef:'official-source',observedAt:'2026-10-09T00:00:00+09:00',asset:null};
 assert.equal(parseCareEvidence({ownerId,garmentId,evidence:[remote]},ownerId,garmentId).evidence.length,1);
 for(const evidenceId of ['local:scprep-20261009-v1:evidence:EV-S01','arbitrary-non-uuid'])assert.throws(()=>parseCareEvidence({ownerId,garmentId,evidence:[{...remote,id:evidenceId}]},ownerId,garmentId));
 const local=buildLocalLifePack().state.careEvidence![0];
 assert.throws(()=>parseCareEvidence({ownerId:local.ownerId,garmentId:local.garmentId,evidence:[{...local,kind:'label',asset:{id:'local:scprep-20261009-v1:asset:fake-label',version:1,url:'/assets/fake.png',mimeType:'image/png'}}]},local.ownerId,local.garmentId));
});
test('read repair fills only missing imported null-photo versions and durably preserves new cards and edited events',async()=>{
 const storage=new Store(),{app}=createLocalLifeApp(storage);
 app.setActiveProfile(ids.PHW);app.loadOutfitDraft(id('outfit','LH01'));app.setOutfitItem('top',id('garment','H02'));app.editOutfitName('보완 이전에 저장한 사용자 카드');
 const saved=await app.saveOutfit('before-read-repair-card',fast);
 app.repository.commit(state=>{const event=state.events.find(e=>e.sourceRef==='HW-WEAR-BLUE-AM')!;event.revision=2;event.value='사용자가 확인한 기존 사건 수정';event.details={...event.details,userNote:'이 기록을 그대로 보존'};state.outfits.find(o=>o.id===id('outfit','LH01'))!.name='사용자가 수정한 원본 카드 이름';});
 const oldState=JSON.parse(storage.values.get(LOCAL_LIFE_STORAGE_KEY)!);
 for(const outfit of oldState.outfits)if(outfit.id.startsWith(`local:${LOCAL_LIFE_NAMESPACE}:outfit:`))outfit.assetVersions={};
 // An existing value is a retained snapshot; repairing a missing entry must not reset it.
 const firstSource=oldState.outfits.find((o:{id:string})=>o.id===id('outfit','LH01')),firstGarment=Object.values(firstSource.items)[0] as string;firstSource.assetVersions[firstGarment]=7;
 const expected=structuredClone(oldState);
 for(const outfit of expected.outfits)if(outfit.id.startsWith(`local:${LOCAL_LIFE_NAMESPACE}:outfit:`))for(const garmentId of Object.values(outfit.items) as string[])if(!Object.hasOwn(outfit.assetVersions,garmentId))outfit.assetVersions[garmentId]=0;
 storage.values.set(LOCAL_LIFE_STORAGE_KEY,JSON.stringify(oldState));storage.access=[];
 const repaired=createLocalLifeApp(storage);assert.equal(repaired.installation.status,'restored');assert.equal(repaired.app.persistence.status,'ready');
 assert.deepEqual(repaired.app.getState(),expected);assert.deepEqual(JSON.parse(storage.values.get(LOCAL_LIFE_STORAGE_KEY)!),expected);assert.equal(storage.access.filter(call=>call.operation==='set').length,1);
 assert.equal(repaired.app.getState().outfits.find(o=>o.id===saved.entity.id)!.name,'보완 이전에 저장한 사용자 카드');assert.equal(repaired.app.getState().outfits.find(o=>o.id===id('outfit','LH01'))!.assetVersions[firstGarment],7);
 assert.equal(repaired.app.getState().events.find(e=>e.sourceRef==='HW-WEAR-BLUE-AM')!.revision,2);
 const persisted=storage.values.get(LOCAL_LIFE_STORAGE_KEY);storage.access=[];assert.equal(createLocalLifeApp(storage).installation.status,'restored');assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),persisted);assert(!storage.access.some(call=>call.operation==='set'));
});
test('read repair cannot overwrite existing nonzero versions or repair invalid ownership and unmatched receipts',()=>{
 const storage=new Store();createLocalLifeApp(storage);const initial=JSON.parse(storage.values.get(LOCAL_LIFE_STORAGE_KEY)!);
 const versioned=structuredClone(initial),versionedOutfit=versioned.outfits[0],garmentId=Object.values(versionedOutfit.items)[0] as string;versionedOutfit.assetVersions[garmentId]=9;
 const versionedRaw=JSON.stringify(versioned);storage.values.set(LOCAL_LIFE_STORAGE_KEY,versionedRaw);storage.access=[];const intact=createLocalLifeApp(storage);assert.equal(intact.installation.status,'restored');assert.equal(intact.app.getState().outfits[0].assetVersions[garmentId],9);assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),versionedRaw);assert(!storage.access.some(call=>call.operation==='set'));
 for(const variant of ['wrong-owner','receipt-version','receipt-fingerprint','missing-null-asset-binding'] as const){
  const invalid=structuredClone(initial),outfit=invalid.outfits[0];outfit.assetVersions={};
  if(variant==='wrong-owner')outfit.ownerId=ids.PHW;
  if(variant==='receipt-version')invalid.localDatasets[LOCAL_LIFE_NAMESPACE].version='unmatched-version';
  if(variant==='receipt-fingerprint')invalid.localDatasets[LOCAL_LIFE_NAMESPACE].sourceFingerprint='unmatched-source';
  if(variant==='missing-null-asset-binding')outfit.assetIds={};
  const raw=JSON.stringify(invalid);storage.values.set(LOCAL_LIFE_STORAGE_KEY,raw);storage.access=[];const rejected=createLocalLifeApp(storage);
  assert.equal(rejected.installation.status,'memory-only',variant);assert.equal(rejected.app.persistence.reason,'corrupt',variant);assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),raw,variant);assert(!storage.access.some(call=>call.operation==='set'||call.operation==='remove'),variant);
 }
});
test('multi-garment care reload rejects cross-profile, empty and duplicate garment snapshots without rewriting original bytes',()=>{
 const storage=new Store();createLocalLifeApp(storage);const initial=JSON.parse(storage.values.get(LOCAL_LIFE_STORAGE_KEY)!);
 for(const variant of ['cross-owner','empty','duplicate'] as const){
  const invalid=structuredClone(initial),care=invalid.events.find((e:{sourceRef:string})=>e.sourceRef==='SU-W04-W');assert.equal(care.garmentId,undefined);assert.equal(care.garmentIds.length,6);
  if(variant==='cross-owner')care.garmentIds.push(id('garment','H01'));if(variant==='empty')care.garmentIds=[];if(variant==='duplicate')care.garmentIds.push(care.garmentIds[0]);
  const raw=JSON.stringify(invalid);storage.values.set(LOCAL_LIFE_STORAGE_KEY,raw);storage.access=[];const rejected=createLocalLifeApp(storage);
  assert.equal(rejected.installation.status,'memory-only',variant);assert.equal(rejected.app.persistence.reason,'corrupt',variant);assert.equal(storage.values.get(LOCAL_LIFE_STORAGE_KEY),raw,variant);assert.deepEqual(storage.access,[{operation:'get',key:LOCAL_LIFE_STORAGE_KEY}]);
 }
});
