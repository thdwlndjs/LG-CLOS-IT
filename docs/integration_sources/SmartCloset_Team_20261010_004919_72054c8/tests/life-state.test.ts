import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrateLifeState} from '../server/lifeState';
import {emptyRemoteState} from '../server/domain';
import {DemoApp} from '../src/core/app';
import {createSeed} from '../src/core/seed';
import type {RemoteBackend} from '../src/integrations/backendClient';
import {PreparedMockRunner,type OutfitRecommendationInput} from '../src/core/mock';
import type {CareGuide,Garment,StorageLike} from '../src/core/types';
import type {LifeProfileData} from '../src/lifeSnapshot';
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',GARMENT='33333333-3333-4333-8333-333333333333',EVIDENCE='44444444-4444-4444-8444-444444444444',ASSET='55555555-5555-4555-8555-555555555555',SECOND='66666666-6666-4666-8666-666666666666';
const garment=(ownerId=OWNER):Garment=>({id:GARMENT,ownerId,name:'Isolated item',category:'top',color:'',features:[],material:'',size:'',location:'',careNotes:'',revision:1,provenance:{location:'unconfirmed',size:'unconfirmed',care:'unconfirmed'},asset:null});
const state=()=>{const s=emptyRemoteState(OWNER,'Isolated profile');s.garments=[garment()];return s;};
const profile=():LifeProfileData=>({ownerId:OWNER,namespace:'isolated-test',provenance:'scenario_fixture',revision:1,preferences:[],contexts:[]});
const row=(patch:Record<string,unknown>={})=>({id:EVIDENCE,owner_id:OWNER,garment_id:GARMENT,evidence_kind:'official_guidance',original_text:'Cool wash. No numeric conversion. Bleaching not specified. '.repeat(8),source_ref:'official-product-source#care',observed_at:'2026-10-08T10:00:00+09:00',asset_id:null,...patch});
const asset=(patch:Record<string,unknown>={})=>({id:ASSET,owner_id:OWNER,version:2,kind:'label',status:'finalized',mime_type:'image/png',...patch});

test('server hydration retains full source and labels official guidance without manufacturing a label image',()=>{
 const source=row(),s=hydrateLifeState(state(),OWNER,[{id:OWNER,settings:{lifeData:profile()}}],[source],[]);
 assert.deepEqual(s.lifeData?.[OWNER],profile());assert.equal(s.careEvidence?.length,1);const e=s.careEvidence![0];assert.equal(e.originalText,source.original_text);assert(e.originalText.length>140);assert.equal(e.sourceRef,source.source_ref);assert.equal(e.kind,'official_guidance');assert.equal(e.asset,null);
});
test('server hydration rejects other profile evidence, unbound garments and unsupported synthetic observation kinds',()=>{
 const s=state();s.garments.push({...garment(OTHER),id:SECOND});
 hydrateLifeState(s,OWNER,[{id:OTHER,settings:{lifeData:{...profile(),ownerId:OTHER}}}],[row(),row({id:SECOND,owner_id:OTHER}),row({id:ASSET,garment_id:SECOND}),row({id:'77777777-7777-4777-8777-777777777777',evidence_kind:'demo_evidence'})],[]);
 assert.equal(s.lifeData,undefined);assert.equal(s.careEvidence?.length,1);assert.equal(s.careEvidence![0].ownerId,OWNER);assert.equal(s.careEvidence![0].garmentId,GARMENT);
});
test('only finalized owner-matched label images retain content routes; other images cannot masquerade as labels',()=>{
 const label=row({evidence_kind:'label',asset_id:ASSET});
 const valid=hydrateLifeState(state(),OWNER,[],[label],[asset()]);assert.deepEqual(valid.careEvidence![0].asset,{id:ASSET,version:2,url:'/api/assets/'+ASSET+'/content',mimeType:'image/png'});
 for(const patch of [{owner_id:OTHER},{kind:'catalog'},{status:'staged'},{mime_type:'image/svg+xml'}])assert.equal(hydrateLifeState(state(),OWNER,[],[label],[asset(patch)]).careEvidence![0].asset,null);
 assert.equal(hydrateLifeState(state(),OWNER,[],[row({asset_id:ASSET})],[asset()]).careEvidence![0].asset,null);
});
test('invalid evidence fails closed without substituting another garment source',()=>{
 const s=hydrateLifeState(state(),OWNER,[],[row(),row({id:SECOND,observed_at:'not-a-date'})],[]);assert.deepEqual(s.careEvidence,[]);
});
test('malformed and cross-owner settings are not accepted as life context',()=>{
 for(const settings of [null,'untrusted',{lifeData:{...profile(),ownerId:OTHER}},{lifeData:{...profile(),revision:0}},{lifeData:{...profile(),preferences:[{id:'wrong',ownerId:OTHER}]}}])assert.equal(hydrateLifeState(state(),OWNER,[{id:OWNER,settings}],[],[]).lifeData,undefined);
});
test('rehydrating a previously populated state removes withdrawn life settings instead of keeping stale claims',()=>{
 const s=hydrateLifeState(state(),OWNER,[{id:OWNER,settings:{lifeData:profile()}}],[row()],[]);assert.ok(s.lifeData);
 hydrateLifeState(s,OWNER,[{id:OWNER,settings:{lifeData:null}}],[],[]);assert.equal(s.lifeData,undefined);assert.deepEqual(s.careEvidence,[]);
});
class Store implements StorageLike{data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}}
const deferred=<T>()=>{let resolve!:(v:T|PromiseLike<T>)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
class HoldCare extends PreparedMockRunner {started=deferred<void>();released=deferred<void>();override async careGuide(g:Garment):Promise<CareGuide>{this.started.resolve();await this.released.promise;return {garmentId:g.id,title:'Isolated delayed guide',advice:'Retained source',source:'prepared-demo',actualCareRecorded:false};}}
class HoldRecommendation extends PreparedMockRunner {started=deferred<void>();released=deferred<void>();override async recommend(input:OutfitRecommendationInput){this.started.resolve();await this.released.promise;return structuredClone(input.draft.items);}}
const conditions={weather:'sunny',temperatureC:11,occasion:'work'},fast={delayMs:0};

test('care response arriving after a lifestyle event changed is stale and creates no implicit care action',async()=>{
 const runner=new HoldCare(),app=new DemoApp(new Store(),undefined,runner),before=structuredClone(app.outfitDraft());const pending=app.requestCareGuide('g-knit');await runner.started.promise;
 await app.recordActualCare('g-knit','건조 완료','explicit-care',fast);runner.released.resolve();assert.equal((await pending).status,'stale');assert.equal(app.events().length,1);assert.deepEqual(app.outfitDraft(),before);
});
test('pending recommendation cannot replace the draft after care history changed',async()=>{
 const runner=new HoldRecommendation(),app=new DemoApp(new Store(),undefined,runner),before=structuredClone(app.outfitDraft());const pending=app.proposeOutfit(conditions);await runner.started.promise;
 await app.recordActualCare('g-knit','세탁 완료','explicit-wash',fast);runner.released.resolve();assert.equal((await pending).status,'stale');assert.deepEqual(app.outfitDraft(),before);
});
test('direct recommendation request checks the same life revision before automatically applying its result',async()=>{
 const runner=new HoldRecommendation(),app=new DemoApp(new Store(),undefined,runner),before=structuredClone(app.outfitDraft());const pending=app.generateOutfits(conditions);await runner.started.promise;
 await app.recordActualCare('g-knit','세탁 완료','explicit-wash',fast);runner.released.resolve();assert.equal((await pending).status,'stale');assert.deepEqual(app.outfitDraft(),before);
});
test('a reviewed proposal cannot be applied after its original care/history evidence changed',async()=>{
 const runner=new HoldRecommendation(),app=new DemoApp(new Store(),undefined,runner);const pending=app.proposeOutfit(conditions);await runner.started.promise;runner.released.resolve();const result=await pending;assert.equal(result.status,'success');if(result.status!=='success')throw Error('Expected isolated proposal');
 await app.recordActualCare('g-knit','환기 완료','explicit-airing',fast);const before=structuredClone(app.outfitDraft());assert.throws(()=>app.applyOutfitSuggestion(result.data.source,result.data.items),/생활 기록|관리 근거/);assert.deepEqual(app.outfitDraft(),before);
});
test('revoked plan is unavailable to actual-wear prefill and cannot add wear while inspected',async()=>{
 const app=new DemoApp(new Store()),day='2026-10-09',selection=await app.commitCurrentSelection(day,fast);assert.equal(app.actualWearPrefill(day,selection.event.id).status,'ready');
 app.repository.commit(s=>{const event=s.events.find(e=>e.id===selection.event.id)!;event.revision=2;event.voided=true;});
 const before=structuredClone(app.getState());const prefill=app.actualWearPrefill(day,selection.event.id);assert.equal(prefill.status,'unavailable');assert.deepEqual(prefill.plans,[]);assert.deepEqual(app.getState(),before);assert.equal(app.events().filter(e=>e.kind==='wear').length,0);
});

test('laundry-pending and drying-unconfirmed block immediate recommendations but not manual composition or card save',async()=>{
 for(const blocked of ['laundry','drying'] as const){
  const runner=new HoldRecommendation(),app=new DemoApp(new Store(),undefined,runner),owner=app.getState().activeProfileId;
  app.repository.commit(s=>s.events.push({id:'isolated-block-'+blocked,ownerId:owner,kind:'care',garmentId:'g-knit',garmentIds:['g-knit'],date:'2026-10-08',occurredAt:'2026-10-08T12:00:00+09:00',inputSource:'user_confirmed',revision:1,lifeKind:blocked==='laundry'?'user_observation':'wash_completed',value:blocked==='laundry'?'사용자 세탁 대기':'세탁 완료',details:blocked==='laundry'?{laundry_review_requested:true}:{}}));
  const original=structuredClone(app.outfitDraft()!),beforeCards=app.cardOutfits().length;runner.released.resolve();
  const proposal=await app.proposeOutfit(conditions);assert.equal(proposal.status,'no-result');assert.deepEqual(app.outfitDraft(),original);
  const generated=await app.generateOutfits(conditions);assert.equal(generated.status,'no-result');assert.deepEqual(app.outfitDraft(),original);
  assert.throws(()=>app.applyOutfitSuggestion(original,original.items),/세탁|건조/);assert.deepEqual(app.outfitDraft(),original);
  app.setOutfitItem('bottom','g-jeans');assert.equal(app.outfitDraft()!.items.top,'g-knit');assert.equal(app.outfitDraft()!.items.bottom,'g-jeans');
  const saved=await app.saveOutfit('explicit-manual-'+blocked,fast);assert.equal(saved.entity.items.top,'g-knit');assert.equal(saved.entity.items.bottom,'g-jeans');assert.equal(app.cardOutfits().length,beforeCards+1);assert.equal(app.events().filter(e=>e.kind==='wear').length,0);assert.equal(app.events().length,1);
 }
});
test('lack of a cleanliness confirmation alone is not a global exclusion from local prepared assistance',async()=>{
 const runner=new HoldRecommendation(),app=new DemoApp(new Store(),undefined,runner);runner.released.resolve();const result=await app.proposeOutfit(conditions);assert.equal(result.status,'success');assert.equal(app.events().length,0);
});
function adaptingRemote(){
 const initial=createSeed(),started=deferred<void>(),released=deferred<void>();let submissions=0,writes=0;
 const noWrite=async()=>{writes++;throw Error('Isolated read test prohibits remote writes');};
 const remote:RemoteBackend={mode:'mock',state:async()=>structuredClone(initial),putDraft:noWrite,discardDraft:noWrite,saveGarment:noWrite,saveOutfit:noWrite,recordEvent:noWrite,analyze:async()=>null,care:async()=>{throw Error('unused');},tryOn:async()=>{throw Error('unused');},recommend:async draft=>{submissions++;started.resolve();await released.promise;return structuredClone(draft.items);}};
 return {remote,started,released,calls:()=>({submissions,writes})};
}
test('style adaptation response is stale when lifestyle history changes while its request is pending',async()=>{
 const fixture=adaptingRemote(),app=new DemoApp(new Store());await app.configureRemote(fixture.remote);const original=structuredClone(app.outfitDraft()!),owner=app.getState().activeProfileId;
 const pending=app.adaptStyleToWardrobe('existing-authorized-reference');await fixture.started.promise;
 app.repository.commit(s=>s.events.push({id:'readback-update',ownerId:owner,kind:'care',garmentId:'g-knit',date:'2026-10-08',value:'환기 완료',inputSource:'user_confirmed'}));
 fixture.released.resolve();assert.equal((await pending).status,'stale');assert.deepEqual(app.outfitDraft(),original);assert.deepEqual(fixture.calls(),{submissions:1,writes:0});
});
test('style adaptation cannot apply a prepared result containing a garment already awaiting drying',async()=>{
 const fixture=adaptingRemote(),app=new DemoApp(new Store());await app.configureRemote(fixture.remote);const owner=app.getState().activeProfileId;
 app.repository.commit(s=>s.events.push({id:'wash-readback',ownerId:owner,kind:'care',garmentId:'g-knit',date:'2026-10-08',value:'세탁 완료',inputSource:'user_confirmed'}));
 const original=structuredClone(app.outfitDraft()!);fixture.released.resolve();const result=await app.adaptStyleToWardrobe('existing-authorized-reference');assert.equal(result.status,'unavailable');assert.deepEqual(app.outfitDraft(),original);assert.deepEqual(fixture.calls(),{submissions:1,writes:0});
});
