import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoApp } from '../src/core/app';
import { createSeed, emptyUI } from '../src/core/seed';
import { captureSelectionSnapshot, captureSelectionSubmission, isSelectionSnapshotDraft, selectionSnapshotDraft } from '../src/core/selectionScenario';
import { garmentWearSummary } from '../src/core/wearScenario';
import type { DemoEvent, DemoState, Outfit, OutfitDraft, Receipt, SaveResult, StorageLike } from '../src/core/types';
import type { RemoteBackend } from '../src/integrations/backendClient';

const day='2026-10-09',fast={delayMs:0},copy=<T>(value:T):T=>structuredClone(value);
class Storage implements StorageLike{
  rows=new Map<string,string>();fail=false;
  getItem(key:string){return this.rows.get(key)??null;}
  setItem(key:string,value:string){if(this.fail)throw Error('quota exceeded');this.rows.set(key,value);}
  removeItem(key:string){this.rows.delete(key);}
}
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{resolve,promise};};
function local(){const storage=new Storage();return{app:new DemoApp(storage),storage};}
function result<T extends Outfit|DemoEvent>(entity:T,draft?:OutfitDraft,replayed=false):SaveResult<T>{
  const receipt:Receipt={id:'receipt-'+entity.id,ownerId:entity.ownerId,operation:'kind'in entity?entity.kind:'saveOutfit',entityId:entity.id,draftId:draft?.draftId??'event',revision:draft?.revision??1,fingerprint:'fixture',createdAt:new Date().toISOString(),result:copy(entity)};
  return{entity:copy(entity),receipt,replayed};
}
function remoteFixture(){
  const state=createSeed(),{app,storage}=local(),saves=new Map<string,SaveResult<Outfit>>(),events=new Map<string,SaveResult<DemoEvent>>();
  let eventCalls=0;
  const remote:RemoteBackend={mode:'mock',state:async()=>copy(state),putDraft:async()=>{},discardDraft:async()=>{},saveGarment:async()=>{throw Error('unused');},
    saveOutfit:async(draft,key)=>{if(saves.has(key))return{...copy(saves.get(key)!),replayed:true};
      const outfit:Outfit={id:`saved-${saves.size}`,ownerId:draft.ownerId,name:draft.name,items:copy(draft.items),revision:draft.revision,assetVersions:Object.fromEntries(Object.values(draft.items).map(id=>[id,state.garments.find(g=>g.id===id)!.asset?.version??0]))};
      const saved=result(outfit,draft);saves.set(key,saved);state.outfits.push(copy(outfit));state.receipts.push(copy(saved.receipt));return copy(saved);},
    recordEvent:async(kind,target,value,date,key)=>{eventCalls++;if(events.has(key))return{...copy(events.get(key)!),replayed:true};
      const outfit=state.outfits.find(o=>o.id===target)!;
      const saved=result({id:`event-${events.size}`,ownerId:outfit.ownerId,kind,outfitId:target,value,date});events.set(key,saved);state.events.push(copy(saved.entity));state.receipts.push(copy(saved.receipt));return copy(saved);},
    analyze:async()=>null,recommend:async()=>null,care:async()=>{throw Error('unused');},tryOn:async()=>({})};
  return{app,storage,state,remote,saves,events,eventCalls:()=>eventCalls};
}
const wearDays=(app:DemoApp,id='g-knit')=>garmentWearSummary(id,app.getState().activeProfileId,app.outfits(),app.events()).wearDays;

test('B5 commits a plan for the complete clicked composition/assets/revision, without changing wear, original outfit, draft or UI',async()=>{
  const{app,storage}=local();const original=copy(app.outfits()[0]);app.setOutfitItem('bottom','g-jeans');app.setScreen('tryOn');app.setCalendarDate('2026-12-07');app.selectOutfit(original.id);
  const before=copy(app.outfitDraft()!),ui=copy(app.ui()),snapshot=captureSelectionSnapshot(before,day,app.garments());
  const selected=await app.commitCurrentSelection(day,fast);
  assert.equal(selected.event.kind,'plan');assert.equal(selected.event.date,day);assert.equal(selected.event.outfitId,selected.savedOutfit.id);
  assert.deepEqual(selected.submittedSnapshot,snapshot);assert.deepEqual(selected.savedOutfit.items,before.items);assert.deepEqual(selected.savedOutfit.assetVersions,snapshot.assetVersions);assert.equal(selected.savedOutfit.revision,before.revision);
  assert.deepEqual(selected.garmentIds.sort(),Object.values(before.items).sort());assert.equal(selected.replayed,false);
  assert.deepEqual(app.outfitDraft(),before);assert.deepEqual(app.outfit(original.id),original);assert.deepEqual(app.ui(),ui);assert.equal(wearDays(app),0);
  const restored=new DemoApp(storage);assert.deepEqual(restored.events(),app.events());assert.deepEqual(restored.outfit(selected.savedOutfit.id),selected.savedOutfit);assert.equal(wearDays(restored),0);
});

test('double click, same-revision resend and reload reuse one plan and one immutable saved outfit',async()=>{
  const{app,storage}=local();const[first,duplicate]=await Promise.all([app.commitCurrentSelection(day,{delayMs:15}),app.commitCurrentSelection(day,fast)]);
  assert.equal(first.event.id,duplicate.event.id);assert.equal(duplicate.replayed,true);assert.equal(app.events().length,1);assert.equal(app.outfits().length,2);
  const restored=new DemoApp(storage),replay=await restored.commitCurrentSelection(day,fast);assert.equal(replay.event.id,first.event.id);assert.equal(replay.replayed,true);assert.equal(restored.events().length,1);assert.equal(wearDays(restored),0);
});

test('selection keys bind owner/day/all slots/assets/look revision and do not identify a similarly named user draft',async()=>{
  const state=createSeed(),draft=state.outfitDrafts[state.activeProfileId],snapshot=captureSelectionSnapshot(draft,day,state.garments),first=await selectionSnapshotDraft(snapshot);
  assert.equal(first.draftId,(await selectionSnapshotDraft(copy(snapshot))).draftId);assert.equal(first.revision,draft.revision);
  for(const change of [{ownerId:'another-owner'},{date:'2026-10-10'},{items:{...snapshot.items,bottom:'g-jeans'}},{assetVersions:{...snapshot.assetVersions,'g-knit':2}},{lookRevision:snapshot.lookRevision+1}])assert.notEqual(first.draftId,(await selectionSnapshotDraft({...snapshot,...change})).draftId);
  assert.equal(await isSelectionSnapshotDraft(first,snapshot.assetVersions),true);assert.equal(await isSelectionSnapshotDraft({...first,draftId:crypto.randomUUID()},snapshot.assetVersions),false);
});

test('draft edits while saving remain separate from the already submitted original selection',async()=>{
  const f=remoteFixture();await f.app.configureRemote(f.remote);const started=deferred<void>(),pending=deferred<void>(),save=f.remote.saveOutfit;
  f.remote.saveOutfit=async(...args)=>{started.resolve();await pending.promise;return save(...args);};
  const before=copy(f.app.outfitDraft()!),selected=f.app.commitCurrentSelection(day,fast);await started.promise;
  f.app.setOutfitItem('bottom','g-jeans');f.app.editOutfitName('새 비교');f.app.setScreen('wardrobe');const edited=copy(f.app.outfitDraft());pending.resolve();
  const finished=await selected;assert.equal(finished.event.kind,'plan');assert.deepEqual(finished.savedOutfit.items,before.items);assert.equal(finished.source.revision,before.revision);
  assert.deepEqual(f.app.outfitDraft(),edited);assert.equal(f.app.ui().screen,'wardrobe');assert.equal(f.app.events().length,1);assert.equal(wearDays(f.app),0);
});

test('late plan completion does not revert a new draft or navigate away from the current screen',async()=>{
  const f=remoteFixture();await f.app.configureRemote(f.remote);const started=deferred<void>(),pending=deferred<void>(),record=f.remote.recordEvent;
  f.remote.recordEvent=async(...args)=>{started.resolve();await pending.promise;return record(...args);};
  const selected=f.app.commitCurrentSelection(day,fast);await started.promise;f.app.openOutfitProposal({top:'g-knit',bottom:'g-jeans'},'다른 후보');f.app.setScreen('care');const next=copy(f.app.outfitDraft());pending.resolve();
  const finished=await selected;assert.equal(finished.savedOutfit.items.bottom,'g-slacks');assert.deepEqual(f.app.outfitDraft(),next);assert.equal(f.app.ui().screen,'care');assert.equal(wearDays(f.app),0);
});

test('profile changes and same-adapter reconnect cancel the old plan before event submission',async()=>{
  for(const change of ['profile','away-back','reconnect'] as const){
    const f=remoteFixture();f.state.profiles.push({id:'other',name:'other'});f.state.ui.other=emptyUI();await f.app.configureRemote(f.remote);
    const started=deferred<void>(),pending=deferred<void>(),save=f.remote.saveOutfit;f.remote.saveOutfit=async(...args)=>{started.resolve();await pending.promise;return save(...args);};
    const selected=f.app.commitCurrentSelection(day,fast);await started.promise;
    if(change==='reconnect')await f.app.configureRemote(f.remote);else{const original=f.state.activeProfileId;assert.throws(()=>f.app.setActiveProfile('other'),/허용/);f.state.activeProfileId='other';await f.app.configureRemote(f.remote);if(change==='away-back'){f.state.activeProfileId=original;await f.app.configureRemote(f.remote);}}
    pending.resolve();await assert.rejects(selected,/세션/);assert.equal(f.eventCalls(),0);assert.equal(f.app.events().length,0);
  }
});

test('an already submitted plan response cannot populate another active profile',async()=>{
  const f=remoteFixture();f.state.profiles.push({id:'other',name:'other'});f.state.ui.other=emptyUI();await f.app.configureRemote(f.remote);
  const started=deferred<void>(),pending=deferred<void>(),record=f.remote.recordEvent;f.remote.recordEvent=async(...args)=>{started.resolve();await pending.promise;return record(...args);};
  const selected=f.app.commitCurrentSelection(day,fast);await started.promise;const originalOwner=f.state.activeProfileId;assert.throws(()=>f.app.setActiveProfile('other'),/허용/);f.state.activeProfileId='other';await f.app.configureRemote(f.remote);const ui=copy(f.app.ui());pending.resolve();
  const finished=await selected;assert.equal(finished.event.ownerId,originalOwner);assert.equal(f.app.getState().activeProfileId,'other');assert.deepEqual(f.app.ui(),ui);assert.equal(f.app.events().length,0);assert.equal(f.events.size,1);
});

test('save response loss and plan response loss recover one plan without inventing wear',async()=>{
  const f=remoteFixture();await f.app.configureRemote(f.remote);let loseSave=true,losePlan=true;const save=f.remote.saveOutfit,record=f.remote.recordEvent;
  f.remote.saveOutfit=async(...args)=>{const value=await save(...args);if(loseSave){loseSave=false;throw Error('save response lost');}return value;};
  f.remote.recordEvent=async(...args)=>{const value=await record(...args);if(losePlan){losePlan=false;throw Error('plan response lost');}return value;};
  await assert.rejects(f.app.commitCurrentSelection(day,fast),/save response lost/);assert.equal(f.eventCalls(),0);assert.equal(f.app.outfits().length,1);assert.equal(f.app.events().length,0);
  await assert.rejects(f.app.commitCurrentSelection(day,fast),/plan response lost/);assert.equal(f.app.outfits().length,2);assert.equal(f.app.events().length,0);
  const retry=await f.app.commitCurrentSelection(day,fast);assert.equal(retry.replayed,true);assert.equal(f.saves.size,1);assert.equal(f.events.size,1);assert.equal(wearDays(f.app),0);
  await f.app.configureRemote(f.remote);assert.equal((await f.app.commitCurrentSelection(day,fast)).event.id,retry.event.id);assert.equal(f.app.events().length,1);
});

test('snapshot save and plan failure are distinguishable; local storage failure reports no saved success',async()=>{
  const f=remoteFixture();await f.app.configureRemote(f.remote);const record=f.remote.recordEvent;f.remote.recordEvent=async()=>{throw Error('plan unavailable');};const draft=copy(f.app.outfitDraft());
  await assert.rejects(f.app.commitCurrentSelection(day,fast),/plan unavailable/);assert.equal(f.app.outfits().length,2);assert.equal(f.app.events().length,0);assert.deepEqual(f.app.outfitDraft(),draft);
  f.remote.recordEvent=record;await f.app.commitCurrentSelection(day,fast);assert.equal(f.app.outfits().length,2);assert.equal(f.app.events().length,1);assert.equal(wearDays(f.app),0);
  const{app,storage}=local();storage.fail=true;await assert.rejects(app.commitCurrentSelection(day,fast),/저장|용량/);assert.equal(app.outfits().length,1);assert.equal(app.events().length,0);
});

test('remote snapshot version mismatch never produces a plan for a different result',async()=>{
  for(const field of ['assets','revision'] as const){const f=remoteFixture();await f.app.configureRemote(f.remote);const save=f.remote.saveOutfit,before=copy(f.app.outfitDraft());
    f.remote.saveOutfit=async(...args)=>{const saved=await save(...args);if(field==='assets')saved.entity.assetVersions['g-knit']++;else saved.receipt.revision++;return saved;};
    await assert.rejects(f.app.commitCurrentSelection(day,fast),/버전/);assert.equal(f.eventCalls(),0);assert.equal(f.app.events().length,0);assert.deepEqual(f.app.outfitDraft(),before);
  }
});

test('existing actual wear stays independent: selection does not add a wear date or change care/movement',async()=>{
  const{app}=local();const wore=await app.wearCurrentOutfit('2026-10-08',fast);await app.recordActualCare('g-knit','세탁 완료','care-existing',fast);
  const before=copy(app.garment('g-knit')),days=wearDays(app),wearEvents=app.events().filter(e=>e.kind==='wear').length;
  const selected=await app.commitCurrentSelection(day,fast);assert.equal(selected.event.kind,'plan');assert.notEqual(selected.event.id,wore.event.id);assert.equal(wearDays(app),days);
  assert.equal(app.events().filter(e=>e.kind==='wear').length,wearEvents);assert.deepEqual(app.garment('g-knit'),before);assert.equal(app.events().filter(e=>e.kind==='care').length,1);
});

test('selection capture is detached and validates date, ownership and category',()=>{
  const state=createSeed(),draft=state.outfitDrafts[state.activeProfileId],captured=captureSelectionSnapshot(draft,day,state.garments);
  draft.items.bottom='g-jeans';state.garments.find(g=>g.id==='g-knit')!.asset!.version=9;
  assert.equal(captured.items.bottom,'g-slacks');assert.equal(captured.assetVersions['g-knit'],1);
  assert.throws(()=>captureSelectionSnapshot(draft,'2026-02-31',state.garments),/날짜/);
  assert.throws(()=>captureSelectionSnapshot({...draft,ownerId:'other'},day,state.garments),/사용자/);
  assert.throws(()=>captureSelectionSnapshot({...draft,items:{top:'g-slacks',bottom:'g-jeans'}},day,state.garments),/종류/);
});

test('retry after a lost plan response recovers the original submission while preserving the newly edited draft',async()=>{
  const f=remoteFixture();await f.app.configureRemote(f.remote);const submission=captureSelectionSubmission(f.app.outfitDraft()!,day,f.app.garments());
  const started=deferred<void>(),pending=deferred<void>(),record=f.remote.recordEvent;let lose=true;
  f.remote.recordEvent=async(...args)=>{const saved=await record(...args);if(lose){lose=false;started.resolve();await pending.promise;throw Error('original plan response lost');}return saved;};
  const first=f.app.commitCurrentSelection(day,fast);await started.promise;f.app.setOutfitItem('bottom','g-jeans');const edited=copy(f.app.outfitDraft());pending.resolve();
  await assert.rejects(first,/original plan response lost/);assert.equal(f.app.events().length,0);
  const retried=await f.app.retrySelection(submission,fast);assert.equal(retried.replayed,true);assert.deepEqual(retried.submittedSnapshot,submission.submittedSnapshot);assert.equal(retried.savedOutfit.items.bottom,'g-slacks');
  assert.deepEqual(f.app.outfitDraft(),edited);assert.equal(f.saves.size,1);assert.equal(f.events.size,1);assert.equal(wearDays(f.app),0);
  await f.app.configureRemote(f.remote);const replay=await f.app.retrySelection(submission,fast);assert.equal(replay.event.id,retried.event.id);assert.equal(f.events.size,1);
});

test('retry validates original owner/slot/asset evidence and detaches the caller submission before waiting',async()=>{
  const f=remoteFixture();await f.app.configureRemote(f.remote);const submission=captureSelectionSubmission(f.app.outfitDraft()!,day,f.app.garments());
  for(const altered of [
    {...submission,source:{...submission.source,ownerId:'other'}},
    {...submission,submittedSnapshot:{...submission.submittedSnapshot,ownerId:'other'}},
    {...submission,source:{...submission.source,revision:99}},
    {...submission,submittedSnapshot:{...submission.submittedSnapshot,assetVersions:{}}},
    {...submission,submittedSnapshot:{...submission.submittedSnapshot,assetVersions:{...submission.submittedSnapshot.assetVersions,'g-knit':-1}}},
    {...submission,submittedSnapshot:{...submission.submittedSnapshot,items:{top:'g-slacks',bottom:'g-knit'}}},
  ])await assert.rejects(f.app.retrySelection(altered,fast));
  assert.equal(f.saves.size,0);assert.equal(f.events.size,0);
  const started=deferred<void>(),pending=deferred<void>(),save=f.remote.saveOutfit;f.remote.saveOutfit=async(...args)=>{started.resolve();await pending.promise;return save(...args);};
  const expected=copy(submission),retry=f.app.retrySelection(submission,fast);await started.promise;submission.submittedSnapshot.items.bottom='g-jeans';submission.source.revision=88;pending.resolve();
  const completed=await retry;assert.deepEqual(completed.submittedSnapshot,expected.submittedSnapshot);assert.deepEqual(completed.source,expected.source);assert.equal(completed.savedOutfit.items.bottom,'g-slacks');assert.equal(wearDays(f.app),0);
});
