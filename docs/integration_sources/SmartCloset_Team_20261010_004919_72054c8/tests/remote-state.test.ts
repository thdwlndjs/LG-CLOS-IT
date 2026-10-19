import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoApp,createSeed,STORAGE_KEY,type Garment,type Outfit,type OutfitDraft,type DemoEvent,type SaveResult,type RegistrationDraft} from '../src/core/index';
import type {RemoteBackend} from '../src/integrations/backendClient';
import {HttpRemoteBackend} from '../src/integrations/backendClient';
const copy=<T>(v:T):T=>structuredClone(v);
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
function result<T extends Garment|Outfit|DemoEvent>(entity:T,draft:RegistrationDraft|OutfitDraft|undefined,replayed=false):SaveResult<T>{return{entity:copy(entity),replayed,receipt:{id:'receipt-'+entity.id,ownerId:entity.ownerId,operation:'kind'in entity?entity.kind:'items'in entity?'saveOutfit':'saveGarment',entityId:entity.id,draftId:draft?.draftId??'event',revision:draft?.revision??1,createdAt:new Date().toISOString(),fingerprint:'fixture',result:copy(entity)}};}
function setup(){const state=createSeed(),writes=new Map<string,string>();const app=new DemoApp({getItem:k=>writes.get(k)??null,setItem:(k,v)=>{writes.set(k,v);},removeItem:k=>{writes.delete(k);}});const drafts:RegistrationDraft[]=[],discarded:string[]=[];const remote:RemoteBackend={mode:'mock',state:async()=>copy(state),putDraft:async d=>{if('category'in d)drafts.push(copy(d));},discardDraft:async d=>{discarded.push(d.draftId);},saveGarment:async d=>result({...d,id:'saved'} as Garment,d),saveOutfit:async()=>{throw Error('unused');},recordEvent:async()=>{throw Error('unused');},analyze:async()=>null,recommend:async()=>null,care:async()=>{throw Error('unused');},tryOn:async()=>({})};return{app,remote,state,writes,drafts,discarded};}
test('remote session leaves original durable local state intact and restores it on disconnect',async()=>{const{app,remote,writes}=setup();app.editRegistration({name:'keep local'});const original=writes.get(STORAGE_KEY);await app.configureRemote(remote);app.editRegistration({name:'remote only'});await tick();assert.equal(writes.get(STORAGE_KEY),original);await app.configureRemote();assert.equal(app.registrationDraft()?.name,'keep local');assert.equal(writes.get(STORAGE_KEY),original);});
test('late save cannot mark a different new draft with the same revision as saved',async()=>{const{app,remote,discarded}=setup();await app.configureRemote(remote);const draft=copy(app.beginRegistration()),pending=deferred<SaveResult<Garment>>();remote.saveGarment=()=>pending.promise;const save=app.saveGarment('late');await tick();app.discardRegistration();const next=app.beginRegistration();assert.equal(next.revision,draft.revision);pending.resolve(result({...draft,id:'saved-old'} as Garment,draft));await save;await tick();assert.equal(app.registrationDraft()?.draftId,next.draftId);assert.equal(app.registrationDraft()?.savedGarmentId,undefined);assert.ok(discarded.includes(draft.draftId));});
test('same adapter reconnection invalidates earlier save responses',async()=>{const{app,remote}=setup();await app.configureRemote(remote);const draft=copy(app.beginRegistration()),pending=deferred<SaveResult<Garment>>();remote.saveGarment=()=>pending.promise;const save=app.saveGarment('late');await tick();await app.configureRemote(remote);pending.resolve(result({...draft,id:'stale-owner-session'} as Garment,draft));await save;assert.equal(app.garments().some(g=>g.id==='stale-owner-session'),false);});
test('old replay receipts cannot overwrite a later garment location or repeat movement',async()=>{const{app,remote,state}=setup();await app.configureRemote(remote);const draft=app.beginRegistration(),old=copy(state.garments[0]);app.repository.commit(s=>{s.garments[0].location='newer location';});remote.saveGarment=async()=>result(old,draft,true);await app.saveGarment('old');assert.equal(app.garment(old.id).location,'newer location');const revision=app.garment(old.id).revision;remote.recordEvent=async()=>result({id:'old-move',ownerId:old.ownerId,kind:'movement',garmentId:old.id,value:'old location',date:'2026-01-01'},undefined,true);await app.recordMovementConfirmed(old.id,'old location','old');assert.equal(app.garment(old.id).location,'newer location');assert.equal(app.garment(old.id).revision,revision);});
test('remote user-confirmed event date is today and repeated stop keeps cleanup registered',async()=>{const{app,remote}=setup();await app.configureRemote(remote);let date='';remote.recordEvent=async(kind,target,value,d)=>{date=d;return result({id:'event-new',ownerId:app.getState().activeProfileId,kind,garmentId:target,value,date:d},undefined);};await app.recordActualCare(app.garments()[0].id,'checked','today');const now=new Date();assert.equal(date,new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now));let stopped=0;const unregister=app.registerTryOnCleanup(()=>{stopped++;});app.stopTryOn();app.stopTryOn();assert.equal(stopped,2);unregister();app.stopTryOn();assert.equal(stopped,2);});
test('disconnect while connecting prevents a late remote state from replacing local state',async()=>{const{app,remote}=setup(),pending=deferred<ReturnType<typeof createSeed>>();remote.state=()=>pending.promise;const connect=app.configureRemote(remote);await app.configureRemote();pending.resolve(createSeed());await connect;assert.equal(app.connection.kind,'local');});
test('default browser fetch transport preserves global receiver',async()=>{const original=globalThis.fetch;globalThis.fetch=function(this:unknown){assert.equal(this,globalThis);return Promise.resolve(Response.json({database_configured:false}));} as typeof fetch;try{assert.equal((await new HttpRemoteBackend().config()).database_configured,false);}finally{globalThis.fetch=original;}});

test('garment retry restores a committed result after its first response was lost',async()=>{
  const{app,remote}=setup();await app.configureRemote(remote);
  const draft=copy(app.beginRegistration()),entity={...draft,id:'recovered-garment',name:'Recovered garment'} as Garment;
  let attempts=0;remote.saveGarment=async()=>{if(++attempts===1)throw Error('response lost after commit');return result(entity,draft,true);};
  await assert.rejects(app.saveGarment('recover-garment'),/response lost/);
  assert.equal(app.garments().some(g=>g.id===entity.id),false);
  const recovered=await app.saveGarment('recover-garment');
  assert.equal(recovered.replayed,true);assert.deepEqual(app.garment(entity.id),entity);
  assert.equal(app.registrationDraft()?.savedGarmentId,entity.id);assert.ok(app.ui().searchResultIds.includes(entity.id));
  await app.saveGarment('recover-garment');
  assert.equal(app.garments().filter(g=>g.id===entity.id).length,1);assert.equal(app.receipts().filter(r=>r.id===recovered.receipt.id).length,1);
});

test('outfit retry restores a selectable saved card without overwriting a newer local result',async()=>{
  const{app,remote}=setup();await app.configureRemote(remote);
  const draft=copy(app.outfitDraft()!),entity:Outfit={...copy(app.outfits()[0]),id:'recovered-outfit',name:'Recovered outfit',revision:draft.revision,items:copy(draft.items)};
  let attempts=0;remote.saveOutfit=async()=>{if(++attempts===1)throw Error('response lost after commit');return result(entity,draft,true);};
  await assert.rejects(app.saveOutfit('recover-outfit'),/response lost/);
  assert.equal(app.outfits().some(o=>o.id===entity.id),false);
  const recovered=await app.saveOutfit('recover-outfit');
  app.selectOutfit(recovered.entity.id);assert.equal(app.ui().selectedOutfitId,entity.id);
  assert.equal(app.outfitDraft()?.savedOutfitId,entity.id);assert.deepEqual(app.outfit(entity.id),entity);
  app.repository.commit(s=>{const current=s.outfits.find(o=>o.id===entity.id)!;current.name='Newer saved outfit';current.revision++;});
  const latest=copy(app.outfit(entity.id));await app.saveOutfit('recover-outfit');
  assert.deepEqual(app.outfit(entity.id),latest);assert.equal(app.outfits().filter(o=>o.id===entity.id).length,1);
  assert.equal(app.receipts().filter(r=>r.id===recovered.receipt.id).length,1);assert.equal(app.events().length,0);
});

test('wear retry restores a committed calendar event exactly once after response loss',async()=>{
  const{app,remote}=setup();await app.configureRemote(remote);const outfit=app.outfits()[0];
  const entity:DemoEvent={id:'recovered-wear',ownerId:outfit.ownerId,kind:'wear',outfitId:outfit.id,value:'실제 착용 확인',date:'2026-10-08'};
  let attempts=0;remote.recordEvent=async()=>{if(++attempts===1)throw Error('response lost after commit');return result(entity,undefined,true);};
  await assert.rejects(app.recordWear(outfit.id,entity.date,'recover-wear'),/response lost/);
  assert.equal(app.events().some(e=>e.id===entity.id),false);
  const recovered=await app.recordWear(outfit.id,entity.date,'recover-wear');
  assert.deepEqual(app.events().find(e=>e.id===entity.id),entity);
  await app.recordWear(outfit.id,entity.date,'recover-wear');
  assert.equal(app.events().filter(e=>e.id===entity.id).length,1);assert.equal(app.receipts().filter(r=>r.id===recovered.receipt.id).length,1);
});