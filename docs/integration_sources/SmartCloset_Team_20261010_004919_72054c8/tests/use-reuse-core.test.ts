import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoApp,createSeed,type StorageLike} from '../src/core';
import {captureSelectionSubmission} from '../src/core/selectionScenario';
import {garmentWearSummary} from '../src/core/wearScenario';
import {PreparedMockRunner,type OutfitRecommendationInput} from '../src/core/mock';
import {outfitInput,outfitFrom} from '../server/domain';
import {parseProposal,type AgentInput} from '../server/providers';
const day='2026-10-09',fast={delayMs:0},copy=<T>(x:T):T=>structuredClone(x);
class Store implements StorageLike{data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}}
const setup=()=>{const storage=new Store();return{storage,app:new DemoApp(storage)};};

test('R10/R11 explicit card save and today selection are independent and technical snapshots stay out of the card collection after reload',async()=>{
 const{app,storage}=setup(),before=app.cardOutfits().length,original=copy(app.outfits()[0]);
 const selection=await app.commitCurrentSelection(day,fast);assert.equal(app.cardOutfits().length,before);assert.equal(app.events().length,1);assert.equal(app.events()[0].kind,'plan');assert.equal(app.outfit(selection.savedOutfit.id).purpose,'selection');
 const saved=await app.saveOutfit('keep-card',fast);assert.equal(app.cardOutfits().length,before+1);assert.notEqual(saved.receipt.id,app.receipts().find(r=>r.entityId===selection.event.id)?.id);assert.equal(app.events().length,1);
 const reload=new DemoApp(storage);assert.equal(reload.cardOutfits().length,before+1);assert.deepEqual(reload.outfit(selection.savedOutfit.id).items,selection.savedOutfit.items);assert.deepEqual(reload.outfit(original.id),original);
 const duplicate=await reload.saveOutfit('mistaken-new-card-key',fast);assert.equal(duplicate.replayed,true);assert.equal(duplicate.entity.id,saved.entity.id);assert.equal(reload.cardOutfits().length,before+1);
});
test('R12 same intent retries recover, distinct same-day intents and same-content new drafts are not collapsed',async()=>{
 const{app}=setup();const[first,twice]=await Promise.all([app.commitCurrentSelection(day,{...fast,intentKey:'morning'}),app.commitCurrentSelection(day,{...fast,intentKey:'morning'})]);assert.equal(first.event.id,twice.event.id);
 const second=await app.commitCurrentSelection(day,{...fast,intentKey:'evening'});assert.notEqual(second.event.id,first.event.id);assert.equal(app.events().length,2);
 app.loadOutfitDraft(app.cardOutfits()[0].id,{reuse:true});const third=await app.commitCurrentSelection(day,fast);app.loadOutfitDraft(app.cardOutfits()[0].id,{reuse:true});const fourth=await app.commitCurrentSelection(day,fast);assert.notEqual(third.event.id,fourth.event.id);
 const nextDate=await app.commitCurrentSelection('2026-10-10',fast);assert.notEqual(nextDate.event.id,fourth.event.id);assert.equal(app.events().filter(e=>e.kind==='wear').length,0);
});
test('R12 same original key with changed input conflicts before any snapshot or event insertion',async()=>{
 const{app}=setup();await app.commitCurrentSelection(day,{...fast,intentKey:'one-original-intent'});app.setOutfitItem('bottom','g-jeans');const before=copy(app.getState());
 await assert.rejects(app.commitCurrentSelection(day,{...fast,intentKey:'one-original-intent'}),/같은 저장 키/);assert.deepEqual(app.getState(),before);
 await assert.rejects(app.commitCurrentSelection('2026-10-10',{...fast,intentKey:'one-original-intent'}),/같은 저장 키/);assert.deepEqual(app.getState(),before);
});
test('R09 automatic names follow selected items, user and unknown legacy titles remain unchanged, and reselect is a no-op',async()=>{
 const{app}=setup(),legacy=app.outfitDraft()!.name;app.setOutfitItem('bottom','g-jeans');assert.equal(app.outfitDraft()!.name,legacy);
 app.startBlankOutfit();app.setOutfitItem('top','g-knit');app.setOutfitItem('bottom','g-jeans');const draft=copy(app.outfitDraft()!);assert.equal(draft.nameOrigin,'auto');assert.match(draft.name,/데님/);app.setOutfitItem('bottom','g-jeans');assert.deepEqual(app.outfitDraft(),draft);
 app.setOutfitItem('bottom','g-slacks');assert.notEqual(app.outfitDraft()!.name,draft.name);app.editOutfitName('직접 정한 이름');app.setOutfitItem('bottom','g-jeans');assert.equal(app.outfitDraft()!.name,'직접 정한 이름');assert.equal(app.outfitDraft()!.nameOrigin,'user');
 app.editOutfitName('');const saved=await app.saveOutfit('nameless',fast);assert.equal(saved.entity.nameOrigin,'auto');assert.match(saved.entity.name,/데님/);
});
test('R14 saved original and earlier plan remain immutable after partial edit and saving a new card',async()=>{
 const{app}=setup(),original=copy(app.outfits()[0]),selection=await app.commitCurrentSelection(day,fast);const event=copy(selection.event),snapshot=copy(selection.savedOutfit);
 app.loadOutfitDraft(original.id,{reuse:true});app.setOutfitItem('bottom','g-jeans');const saved=await app.saveOutfit('new-version',fast);assert.notEqual(saved.entity.id,original.id);assert.deepEqual(app.outfit(original.id),original);assert.deepEqual(app.outfit(snapshot.id),snapshot);assert.deepEqual(app.events().find(e=>e.id===event.id),event);
});
test('R15 actual-wear prefill is read-only, ambiguous plans require a choice, confirmation and later card saving create no duplicate wear',async()=>{
 const{app}=setup();assert.equal(app.actualWearPrefill(day).status,'no-plan');const first=await app.commitCurrentSelection(day,{...fast,intentKey:'plan-one'});const before=copy(app.getState()),prefill=app.actualWearPrefill(day);assert.equal(prefill.status,'ready');assert.equal(prefill.plan?.id,first.event.id);assert.deepEqual(app.getState(),before);
 await app.commitCurrentSelection(day,{...fast,intentKey:'plan-two'});assert.equal(app.actualWearPrefill(day).status,'choose-plan');const explicit=app.actualWearPrefill(day,first.event.id);assert.equal(explicit.status,'ready');assert.equal(app.actualWearPrefill('2026-10-10',first.event.id).status,'unavailable');
 const wore=await app.recordWear(explicit.outfit!.id,day,'confirmed-first',fast);assert.equal((await app.recordWear(explicit.outfit!.id,day,'confirmed-first',fast)).entity.id,wore.entity.id);await app.saveOutfit('after-wear-card',fast);assert.equal(app.events().filter(e=>e.kind==='wear').length,1);await app.recordWear(explicit.outfit!.id,day,'separate-confirmation',fast);assert.equal(app.events().filter(e=>e.kind==='wear').length,2);assert.equal(garmentWearSummary('g-knit',app.getState().activeProfileId,app.outfits(),app.events()).wearDays,1);
});
test('R16 external candidates remain plan/card references, and are blocked from actual wear',async()=>{
 const{app}=setup(),owner=app.getState().activeProfileId;app.repository.commit(s=>{s.externalItems=[{id:'already-provided',ownerId:owner,name:'제공 후보',category:'outer',asset:null,sourceLabel:'기존 후보',sourceUrl:null}];});app.setExternalOutfitItem('outer','already-provided');const plan=await app.commitCurrentSelection(day,fast);assert.equal(app.actualWearPrefill(day,plan.event.id).status,'unavailable');await assert.rejects(app.recordWear(plan.savedOutfit.id,day,'must-not-wear',fast),/구매 후보/);assert.equal(app.events().filter(e=>e.kind==='wear').length,0);
});
test('R17 unchanged asset version with changed asset ID blocks saving until explicit re-selection, without changing the original card',async()=>{
 const{app}=setup();const saved=await app.saveOutfit('original-assets',fast);app.loadOutfitDraft(saved.entity.id);const original=copy(app.outfit(saved.entity.id));app.repository.commit(s=>{s.garments.find(g=>g.id==='g-knit')!.asset!.id='replacement-asset-same-version';});const count=app.outfits().length;await assert.rejects(app.saveOutfit('stale-assets',fast),/사진이 바뀌었/);assert.equal(app.outfits().length,count);assert.deepEqual(app.outfit(saved.entity.id),original);app.setOutfitItem('top','g-knit');const newCard=await app.saveOutfit('confirmed-current-asset',fast);assert.equal(newCard.entity.assetIds?.['g-knit'],'replacement-asset-same-version');assert.deepEqual(app.outfit(saved.entity.id),original);
});
test('R17 missing or other-owner selection cannot save or prefill and does not substitute another garment',async()=>{
 for(const change of ['missing','other-owner'] as const){const{app}=setup(),plan=await app.commitCurrentSelection(day,fast),original=copy(plan.savedOutfit);app.loadOutfitDraft(plan.savedOutfit.id);app.repository.commit(s=>{if(change==='missing')s.garments=s.garments.filter(g=>g.id!=='g-knit');else s.garments.find(g=>g.id==='g-knit')!.ownerId='other';});const before=app.outfits().length;assert.equal(app.actualWearPrefill(day,plan.event.id).status,'unavailable');await assert.rejects(app.saveOutfit('invalid-reference',fast),/같은 의류/);assert.equal(app.outfits().length,before);assert.deepEqual(app.outfit(original.id),original);assert.equal(app.outfitDraft()!.items.top,'g-knit');}
});
test('R18 scoped recommendation keeps all other slots and permanent locks, and stale proposals never apply',async()=>{
 let seen:OutfitRecommendationInput|undefined;class Runner extends PreparedMockRunner{override async recommend(input:OutfitRecommendationInput){seen=copy(input);return{top:'g-knit',bottom:'g-jeans'};}}
 const app=new DemoApp(new Store(),createSeed,new Runner()),before=copy(app.outfitDraft()!);const proposal=await app.proposeOutfit({weather:'unavailable',temperatureC:0,occasion:'상의'},undefined,{editableSlot:'top'});assert.equal(seen?.editableSlot,'top');assert.deepEqual(seen?.draft,before);assert.equal(proposal.status,'success');if(proposal.status!=='success')return;assert.deepEqual(proposal.data.items,before.items);assert.deepEqual(app.outfitDraft(),before);app.setOutfitItem('bottom','g-jeans');assert.throws(()=>app.applyOutfitSuggestion(proposal.data.source,proposal.data.items),/바뀌었/);
});
test('R18 provider output cannot change a preserved slot or an explicit permanent lock',()=>{
 const scope:AgentInput={task:'outfit',context:{editable_slot:'top',preserved_items:{bottom:'bottom'},selected_items:{top:'top',bottom:'bottom'},locked_slots:{bottom:true}},allowedGarmentIds:['top','bottom','other-bottom'],allowedEvidenceIds:['confirmed'],garmentScope:[{garmentId:'top',category:'top',availability:'available',availabilitySource:'user_confirmation',availabilityEvidenceId:'confirmed'},{garmentId:'bottom',category:'bottom',availability:'available',availabilitySource:'user_confirmation',availabilityEvidenceId:'confirmed'},{garmentId:'other-bottom',category:'bottom',availability:'available',availabilitySource:'user_confirmation',availabilityEvidenceId:'confirmed'}]};const output={kind:'proposal',items:[{slot:'top',garment_id:'top'}],explanation:'현재 상의 후보',evidence_ids:['confirmed'],unknown_fields:[]};assert.equal(parseProposal(output,scope).kind,'proposal');assert.throws(()=>parseProposal({...output,items:[...output.items,{slot:'bottom',garment_id:'other-bottom'}]},scope));
});
