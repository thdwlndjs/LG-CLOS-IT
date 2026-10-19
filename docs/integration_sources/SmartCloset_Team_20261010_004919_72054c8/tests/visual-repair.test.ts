import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalLifeApp,LOCAL_LIFE_STORAGE_KEY} from '../src/localLifeStorage';
import {installReviewedVisualBindings,VISUAL_REPAIR_BACKUP_KEY,planVisualRepair} from '../src/lifeData/visualRepair';
import {garmentDisplayPresentation,VISUAL_REPAIR_VERSION,reviewedBindingFor} from '../src/lifeData/visualPresentation';
import {LOCAL_LIFE_PROFILE_IDS,localLifeId} from '../src/lifeData/localPack';
import {describeOutfitCard} from '../src/outfitCardPresentation';
import {resolvePhotoLocations,PHOTO_SCENE_SOURCE} from '../src/photoSceneMapping';
import {buildFittingSnapshot} from '../src/mirrorScene';
import type {StorageLike} from '../src/core/types';
class Store implements StorageLike{map=new Map<string,string>();writes:string[]=[];failKey='';getItem(key:string){return this.map.get(key)??null;}setItem(key:string,v:string){if(this.failKey===key)throw Error('quota');this.writes.push(key);this.map.set(key,v);}removeItem(){throw Error('must not delete');}}
const ids=LOCAL_LIFE_PROFILE_IDS,id=localLifeId,fast={delayMs:0};
const setup=()=>{const store=new Store();const {app}=createLocalLifeApp(store);return{store,app};};
const repair=(app:ReturnType<typeof setup>['app'],store:Store)=>installReviewedVisualBindings(app,store,LOCAL_LIFE_STORAGE_KEY);
const strip=(state:ReturnType<ReturnType<typeof setup>['app']['getState']>)=>{const s=structuredClone(state);delete s.localRepairs;for(const g of s.garments)delete g.displayBinding;return s;};

test('repair backs up exact private bytes and atomically adds 15 display bindings without changing user cards/events/drafts or fitting assets',async()=>{
 const {app,store}=setup();app.setActiveProfile(ids.PHW);app.loadOutfitDraft(id('outfit','LH01'));app.setOutfitItem('top',id('garment','H02'));app.editOutfitName('복구 전에 저장한 이름');await app.saveOutfit('preserve-card',fast);await app.commitCurrentSelection('2026-10-10',{...fast,intentKey:'preserve-plan'});
 const before=structuredClone(app.getState()),raw=store.getItem(LOCAL_LIFE_STORAGE_KEY)!;store.writes=[];
 const report=repair(app,store);assert.equal(report.status,'applied');assert.equal(report.changedIds.length,15);assert.equal(report.pending,17);assert.equal(report.conflicts.length,0);assert.equal(store.getItem(VISUAL_REPAIR_BACKUP_KEY),raw);assert.deepEqual(store.writes,[VISUAL_REPAIR_BACKUP_KEY,LOCAL_LIFE_STORAGE_KEY]);assert.deepEqual(strip(app.getState()),before);assert(app.getState().garments.every(g=>g.asset===null&&g.location===''));
});
test('same repair and reload preserve later edits, new records, snapshot versions and explicit clears without another write',()=>{
 const {app,store}=setup();repair(app,store);app.repository.commit(s=>{s.garments.find(g=>g.id===id('garment','S02'))!.displayBinding=null;s.garments.find(g=>g.id===id('garment','S04'))!.name='직접 정한 새 이름';});
 const raw=store.getItem(LOCAL_LIFE_STORAGE_KEY);store.writes=[];const second=createLocalLifeApp(store).app;assert.equal(repair(second,store).status,'already-applied');assert.equal(store.getItem(LOCAL_LIFE_STORAGE_KEY),raw);assert.equal(store.writes.length,0);assert.equal(garmentDisplayPresentation(second.getState().garments.find(g=>g.id===id('garment','S02'))!).asset,null);assert.equal(second.getState().garments.find(g=>g.id===id('garment','S04'))!.name,'직접 정한 새 이름');
});
test('backup or durable write failure preserves both current state and original data; retry can complete once',()=>{
 for(const fail of [VISUAL_REPAIR_BACKUP_KEY,LOCAL_LIFE_STORAGE_KEY]){const {app,store}=setup(),before=structuredClone(app.getState()),raw=store.getItem(LOCAL_LIFE_STORAGE_KEY);store.failKey=fail;assert.equal(repair(app,store).status,'unavailable');assert.deepEqual(app.getState(),before);assert.equal(store.getItem(LOCAL_LIFE_STORAGE_KEY),raw);store.failKey='';const reloaded=createLocalLifeApp(store).app;assert.equal(repair(reloaded,store).status,'applied');}
});
test('unreviewed source, corrupt store and changed repair source do not get re-seeded or overwritten',()=>{
 const {app,store}=setup();app.repository.commit(s=>{s.localDatasets!['scprep-20261009-v1'].sourceFingerprint='different';});const raw=store.getItem(LOCAL_LIFE_STORAGE_KEY);assert.equal(repair(app,store).status,'source-conflict');assert.equal(store.getItem(LOCAL_LIFE_STORAGE_KEY),raw);
 store.map.set(LOCAL_LIFE_STORAGE_KEY,'{broken');const corrupt=createLocalLifeApp(store).app;assert.equal(repair(corrupt,store).status,'unavailable');assert.equal(store.getItem(LOCAL_LIFE_STORAGE_KEY),'{broken');
 const healthy=setup();repair(healthy.app,healthy.store);healthy.app.repository.commit(s=>{s.localRepairs![VISUAL_REPAIR_VERSION].sourceFingerprint='different';});const prior=healthy.store.getItem(LOCAL_LIFE_STORAGE_KEY);assert.equal(repair(healthy.app,healthy.store).status,'source-conflict');assert.equal(healthy.store.getItem(LOCAL_LIFE_STORAGE_KEY),prior);
});
test('missing values never clear manual assets, explicit display clears or reviewed bindings; edited identity stays pending',()=>{
 const {app}=setup();app.repository.commit(s=>{const by=(ref:string)=>s.garments.find(g=>g.id===id('garment',ref))!;by('S02').asset={id:'manual-upload',version:1,source:'upload',url:'blob:personal'};by('S04').displayBinding=null;by('S09').color='black';});const p=planVisualRepair(app.getState());assert(p.preservedIds.includes(id('garment','S02')));assert(p.preservedIds.includes(id('garment','S04')));assert(p.conflicts.some(row=>row.id===id('garment','S09')));assert.equal(p.next.garments.find(g=>g.id===id('garment','S02'))!.asset!.id,'manual-upload');
});
test('raw S01/H01 never join legacy S01/H01; a shared T01 image keeps two canonical owners and cannot be copied across garments',()=>{
 const {app,store}=setup();repair(app,store);const by=(ref:string)=>app.getState().garments.find(g=>g.id===id('garment',ref))!;
 assert.equal(garmentDisplayPresentation(by('S01')).asset,null);assert.equal(garmentDisplayPresentation(by('H01')).asset!.id,'asset_T01_v1');assert.equal(garmentDisplayPresentation(by('S15')).asset!.id,'asset_S01_v1');assert.notEqual(by('S02').ownerId,by('H01').ownerId);assert.equal(garmentDisplayPresentation(by('S02')).asset!.url,garmentDisplayPresentation(by('H01')).asset!.url);
 const wrong={...by('S01'),displayBinding:by('S02').displayBinding};assert.equal(reviewedBindingFor(wrong),null);const foreign={...by('H01'),ownerId:ids.PSU};assert.equal(reviewedBindingFor(foreign),null);
});
test('existing zero-version cards resolve new example display while all original snapshot/fitting refs remain unchanged',()=>{
 const {app,store}=setup(),outfit=structuredClone(app.getState().outfits.find(o=>o.id===id('outfit','LH01'))!);repair(app,store);
 const card=describeOutfitCard({outfit,ownerId:ids.PHW,garments:app.getState().garments,externalItems:app.getState().externalItems});assert.equal(card.slots.find(row=>row.garmentId===id('garment','H01'))!.asset!.id,'asset_T01_v1');assert.equal(card.slots.find(row=>row.garmentId===id('garment','H01'))!.example,true);assert.deepEqual(app.getState().outfits.find(o=>o.id===outfit.id),outfit);
 const snapshot=buildFittingSnapshot({ownerId:ids.PHW,person:{id:'unrelated-approved-person',version:1,url:'/assets/example.png'},outfit,garments:app.getState().garments,requestVersion:1});assert.equal(snapshot.snapshot,null);assert(snapshot.issues.some(issue=>issue.code==='missing-garment-asset'));
});
test('canonical scene mapping deduplicates approved shelves, clears unknown/foreign items and preserves manually cleared locations',()=>{
 const {app,store}=setup();repair(app,store);const garments=app.getState().garments;
 assert.deepEqual(resolvePhotoLocations(garments,ids.PSU,[id('garment','S02')]).anchorIds,['L2_UPPER_GROUP']);assert.deepEqual(resolvePhotoLocations(garments,ids.PHW,[id('garment','H01'),id('garment','H02')]).anchorIds,['L2_UPPER_GROUP']);
 for(const [owner,refs]of [[ids.PSU,['S01','S15']],[ids.PHW,['S02']]]as const)assert.deepEqual(resolvePhotoLocations(garments,owner,refs.map(ref=>id('garment',ref))).anchorIds,[]);
 const cleared=structuredClone(garments);const g=cleared.find(g=>g.id===id('garment','S02'))!;g.provenance.location='user';g.location='';assert.deepEqual(resolvePhotoLocations(cleared,ids.PSU,[g.id]).anchorIds,[]);
 const bound=resolvePhotoLocations(garments,ids.PSU,[id('garment','S02')]);assert.equal(bound.sceneAssetVersion,PHOTO_SCENE_SOURCE.sceneAssetVersion);assert.equal(bound.items[0].physicalLocationVerified,false);assert.match(bound.items[0].displayLabel,/시연 위치/);
});

test('repair rejects a stale loaded state before backing up or overwriting a separate window save',()=>{
 const {app,store}=setup(),loaded=structuredClone(app.getState());
 const other=createLocalLifeApp(store).app;
 other.repository.commit(s=>{s.garments.find(g=>g.id===id('garment','S02'))!.careNotes='다른 창에서 방금 저장한 관리 메모';});
 const latest=store.getItem(LOCAL_LIFE_STORAGE_KEY);store.writes=[];
 assert.equal(repair(app,store).status,'source-conflict');
 assert.equal(store.getItem(LOCAL_LIFE_STORAGE_KEY),latest);assert.deepEqual(app.getState(),loaded);
 assert.equal(store.getItem(VISUAL_REPAIR_BACKUP_KEY),null);assert.deepEqual(store.writes,[]);
});

test('repair rechecks the exact current bytes after backup and preserves a newer interleaved save',()=>{
 const {app,store}=setup(),loaded=structuredClone(app.getState()),before=store.getItem(LOCAL_LIFE_STORAGE_KEY)!;
 const latest=structuredClone(loaded);latest.garments.find(g=>g.id===id('garment','S02'))!.careNotes='백업 사이에 다른 창이 저장한 메모';
 const rawLatest=JSON.stringify(latest),set=store.setItem.bind(store);
 store.setItem=(key,value)=>{set(key,value);if(key===VISUAL_REPAIR_BACKUP_KEY)store.map.set(LOCAL_LIFE_STORAGE_KEY,rawLatest);};
 assert.equal(repair(app,store).status,'source-conflict');assert.equal(store.getItem(LOCAL_LIFE_STORAGE_KEY),rawLatest);
 assert.equal(store.getItem(VISUAL_REPAIR_BACKUP_KEY),before);assert.deepEqual(app.getState(),loaded);
});

test('repository serialization of upload URLs and processing state is not a false concurrent-write conflict',()=>{
 const {app,store}=setup();
 app.repository.commit(s=>{s.garments.find(g=>g.id===id('garment','S02'))!.asset={id:'manual-photo',version:1,source:'upload',url:'blob:session-photo'};s.ui[ids.PSU].operations.analysis={status:'processing',message:'processing in this window'};});
 const before=structuredClone(app.getState()),raw=store.getItem(LOCAL_LIFE_STORAGE_KEY)!;
 assert.notEqual(raw,JSON.stringify(before));
 const report=repair(app,store);assert.equal(report.status,'applied');assert.equal(report.changedIds.length,14);
 assert(report.preservedIds.includes(id('garment','S02')));assert.equal(store.getItem(VISUAL_REPAIR_BACKUP_KEY),raw);
 assert.deepEqual(strip(app.getState()),before);
});