import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoApp} from '../src/core/app';
import {createSeed,emptyUI} from '../src/core/seed';
import {completeOutfit} from '../src/core/externalOutfits';
import {describeOutfitCard} from '../src/outfitCardPresentation';
import {buildFittingSnapshot,OUTFIT_SLOTS} from '../src/mirrorScene';
import {CATEGORIES,outfitInput} from '../server/domain';
import type {DemoState,Garment,Outfit,StorageLike} from '../src/core/types';

class MemoryStorage implements StorageLike {
 rows=new Map<string,string>();getItem(k:string){return this.rows.get(k)??null;}setItem(k:string,v:string){this.rows.set(k,v);}removeItem(k:string){this.rows.delete(k);}
}
const fast={delayMs:0},day='2026-10-09';
function seed():DemoState {
 const state=createSeed(),owner=state.activeProfileId;
 const dress:Garment={id:'local-life.S14',ownerId:owner,name:'지난 계절의 원피스',category:'dress',asset:null,color:'블랙',features:[],material:'',size:'',location:'',provenance:{care:'unconfirmed',size:'unconfirmed',location:'unconfirmed'},careNotes:'',revision:1};
 const look:Outfit={id:'local-life.LS07',ownerId:owner,name:'지난 계절의 원피스',items:{dress:dress.id,shoes:'g-shoes'},assetIds:{[dress.id]:null,'g-shoes':state.garments.find(g=>g.id==='g-shoes')!.asset!.id},assetVersions:{[dress.id]:0,'g-shoes':1},revision:1,purpose:'card',nameOrigin:'legacy'};
 state.garments.push(dress);state.outfits.push(look);state.profiles.push({id:'other-profile',name:'다른 시연 사용자'});state.ui['other-profile']=emptyUI();return state;
}
function fixture(){const storage=new MemoryStorage(),app=new DemoApp(storage,seed);app.loadOutfitDraft('local-life.LS07');return{storage,app};}

test('local dress card keeps the original one-piece reference and missing-photo truth',()=>{
 const{app}=fixture(),card=describeOutfitCard({outfit:app.outfit('local-life.LS07'),ownerId:app.getState().activeProfileId,garments:app.garments()});
 assert.deepEqual(card.slots.map(s=>s.slot).sort(),['dress','shoes']);const dress=card.slots.find(s=>s.slot==='dress')!;
 assert.equal(dress.name,'지난 계절의 원피스');assert.equal(dress.garmentId,'local-life.S14');assert.equal(dress.asset,null);assert.equal(dress.status,'missing-photo');assert.equal(completeOutfit(app.outfitDraft()!),true);
});

test('dress reuse, new card, selection, owner round-trip and reload retain the original card',async()=>{
 const{app,storage}=fixture(),original=structuredClone(app.outfit('local-life.LS07')),owner=app.getState().activeProfileId;
 app.editOutfitName('직접 고친 원피스 코디');const saved=await app.saveOutfit('dress-new-card',fast);assert.notEqual(saved.entity.id,original.id);
 const selected=await app.commitCurrentSelection(day,fast);assert.equal(selected.event.kind,'plan');assert.equal(app.events().filter(e=>e.kind==='wear').length,0);assert.equal(app.cardOutfits().length,3);assert.deepEqual(app.outfit(original.id),original);
 const draft=structuredClone(app.outfitDraft());app.setActiveProfile('other-profile');assert.equal(app.garments().length,0);assert.equal(app.events().length,0);app.setActiveProfile(owner);assert.deepEqual(app.outfitDraft(),draft);
 const restored=new DemoApp(storage);assert.equal(restored.persistence.status,'ready');assert.deepEqual(restored.outfit(original.id),original);assert.deepEqual(restored.outfitDraft(),draft);assert.equal(restored.events().length,1);assert.equal(restored.garment('local-life.S14').category,'dress');
 const replay=await restored.commitCurrentSelection(day,fast);assert.equal(replay.event.id,selected.event.id);assert.equal(replay.replayed,true);
});

test('switching dress and separates requires explicit removal and never discards locked items',()=>{
 const{app}=fixture();app.toggleSlotLock('dress');const before=structuredClone(app.outfitDraft());assert.throws(()=>app.setOutfitItem('top','g-knit'),/원피스.*먼저 빼/);assert.deepEqual(app.outfitDraft(),before);assert.throws(()=>app.removeOutfitItem('dress'),/고정/);
 app.toggleSlotLock('dress');app.removeOutfitItem('dress');app.setOutfitItem('top','g-knit');app.setOutfitItem('bottom','g-slacks');app.toggleSlotLock('top');const separates=structuredClone(app.outfitDraft());assert.throws(()=>app.setOutfitItem('dress','local-life.S14'),/상의·하의.*먼저 빼/);assert.deepEqual(app.outfitDraft(),separates);
 assert.equal(completeOutfit({items:{dress:'d',top:'t',bottom:'b'}}),false);assert.equal(completeOutfit({items:{dress:'d',bottom:'b'}}),false);
});

test('dress filter and explicit wear remain local and persist across reload',async()=>{
 const{app,storage}=fixture();app.setSearchFilters({category:'dress'});const found=await app.searchGarments('원피스',fast);assert.equal(found.status,'success');if(found.status==='success')assert.deepEqual(found.data.map(g=>g.id),['local-life.S14']);
 const wore=await app.wearCurrentOutfit(day,fast);assert.equal(wore.event.kind,'wear');assert.deepEqual(wore.savedOutfit.items,{dress:'local-life.S14',shoes:'g-shoes'});const restored=new DemoApp(storage);assert.equal(restored.persistence.status,'ready');assert.equal(restored.events().filter(e=>e.kind==='wear').length,1);
});

test('local dress support does not expand server slots or fabricate a fitting result',async()=>{
 const{app}=fixture();assert.equal(CATEGORIES.includes('dress'),false);assert.equal(OUTFIT_SLOTS.includes('dress'),false);
 const owner=crypto.randomUUID(),draftId=crypto.randomUUID(),top=crypto.randomUUID(),bottom=crypto.randomUUID();const wire={ownerId:owner,draftId,revision:1,name:'remote test',items:{top,bottom},topLocked:false};assert.deepEqual(outfitInput(wire,owner).items,{top,bottom});assert.throws(()=>outfitInput({...wire,items:{dress:top}},owner),{code:'invalid_input'});
 const snapshot=buildFittingSnapshot({ownerId:app.getState().activeProfileId,person:{id:'person-test',version:1,url:'/assets/test.png'},outfit:app.outfitDraft()!,garments:app.garments(),requestVersion:1});assert.equal(snapshot.snapshot,null);assert(snapshot.issues.some(issue=>issue.code==='invalid-slot'));
 const generated=await app.startTryOn(undefined,fast);assert.equal(generated.status,'unavailable');assert.equal(app.events().length,0);
});
