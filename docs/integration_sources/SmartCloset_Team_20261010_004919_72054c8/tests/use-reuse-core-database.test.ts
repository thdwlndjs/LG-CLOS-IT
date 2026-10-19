// Existing PostgreSQL/RLS sources in an in-memory PGlite only; no external database or real credentials.
import test from 'node:test';
import {AppError} from '../server/errors';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {asRole,createTestDatabase,OWNER} from './db-harness';
import {DatabaseRepository} from '../server/repository';
import {outfitInput} from '../server/domain';
import type {SupabaseGateway,UserContext} from '../server/supabase';
import {DemoApp} from '../src/core/app';
import type {Garment,Outfit,OutfitDraft,RegistrationDraft,SaveResult} from '../src/core/types';
import type {RemoteBackend} from '../src/integrations/backendClient';
const day='2026-10-09';
async function fixture(){
 const db=await createTestDatabase();await asRole(db,'authenticated',OWNER);
 const gateway={
  async rpc(_user:UserContext,name:string,args:Record<string,unknown>){assert.match(name,/^sc_[a-z_]+$/);const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^p_[a-z_]+$/));return(await db.query<{result:unknown}>(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]))).rows[0].result;},
  async rows(_user:UserContext,table:string,query:string){assert.match(table,/^sc_[a-z_]+$/);const clauses:string[]=[],values:unknown[]=[];for(const[key,value]of new URLSearchParams(query)){if(key==='select'||key==='limit')continue;const column=key==='snapshot_json->_client->>revision'?"snapshot_json -> '_client' ->> 'revision'":key;if(column===key)assert.match(key,/^[a-z_]+$/);assert.ok(value.startsWith('eq.'));values.push(value.slice(3));clauses.push(`${column}=$${values.length}`);}return(await db.query<Record<string,unknown>>(`select * from public.${table}${clauses.length?' where '+clauses.join(' and '):''}`,values)).rows;},
  async one(user:UserContext,table:string,id:string){const rows=await this.rows(user,table,`id=eq.${id}&select=*`);assert.ok(rows[0]);return rows[0];}
 };
 const repo=new DatabaseRepository(gateway as unknown as SupabaseGateway,{id:OWNER,token:'isolated-fixture'});
 function garment(category:'top'|'bottom'):RegistrationDraft{return{draftId:randomUUID(),ownerId:OWNER,revision:1,name:category,category,asset:null,color:'',features:[],material:'',size:'',location:'',careNotes:'',manualFields:{},provenance:{location:'unconfirmed',size:'unconfirmed',care:'unconfirmed'}};}
 const top=await repo.save('saveGarment',garment('top'),randomUUID()),bottom=await repo.save('saveGarment',garment('bottom'),randomUUID());
 const draft:OutfitDraft={draftId:randomUUID(),ownerId:OWNER,revision:1,name:'사용자가 정한 이름',nameOrigin:'user',purpose:'card',items:{top:top.entity.id,bottom:bottom.entity.id},topLocked:false,assetIds:{[top.entity.id]:null,[bottom.entity.id]:null},assetVersions:{[top.entity.id]:0,[bottom.entity.id]:0}};await repo.putDraft(draft);
 const remote:RemoteBackend={mode:'mock',state:()=>repo.state(),putDraft:async value=>{await repo.putDraft('items'in value?outfitInput(value,OWNER):value);},discardDraft:async value=>{await repo.discardDraft(value.draftId,value.revision);},saveGarment:(value,key)=>repo.save('saveGarment',value,key)as Promise<SaveResult<Garment>>,saveOutfit:(value,key)=>repo.save('saveOutfit',outfitInput(value,OWNER),key)as Promise<SaveResult<Outfit>>,recordEvent:(kind,targetId,value,date,intentKey)=>repo.event(kind==='wear'?'recordWear':'planOutfit',{targetId,value,date,intentKey,clientEventId:intentKey,inputSource:'user_confirmed'}),analyze:async()=>null,recommend:async()=>null,care:async()=>{throw Error('unused');},tryOn:async()=>({})};
 const app=new DemoApp();await app.configureRemote(remote);return{db,repo,remote,app,draft};
}
test('R10/R11/R12/R14 existing SQL metadata separates card and plan, rejects reused keys with changed input and recovers a lost event response',async()=>{
 const{db,repo,remote,app,draft}=await fixture();try{
  const selected=await app.commitCurrentSelection(day,{intentKey:'original-intent'});assert.equal(app.cardOutfits().length,0);assert.equal(app.outfits().length,1);assert.equal(selected.savedOutfit.purpose,'selection');
  const card=await app.saveOutfit('original-intent');assert.equal(card.entity.nameOrigin,'user');assert.equal(card.entity.purpose,'card');assert.deepEqual(card.entity.assetIds,draft.assetIds);assert.equal(app.cardOutfits().length,1);assert.equal(app.events().length,1);
  await app.configureRemote(remote);assert.equal(app.cardOutfits().length,1);assert.equal(app.outfit(selected.savedOutfit.id).purpose,'selection');assert.deepEqual(app.outfitDraft()?.items,draft.items);
  const duplicate=await app.saveOutfit('different-key-same-card-intent');assert.equal(duplicate.entity.id,card.entity.id);assert.equal(duplicate.replayed,true);
  const again=await app.commitCurrentSelection(day,{intentKey:'evening-intent'});assert.notEqual(again.event.id,selected.event.id);assert.equal(app.cardOutfits().length,1);
  const counts=()=>db.query('select (select count(*) from public.sc_outfits) as outfits,(select count(*) from public.sc_activity_events) as events,(select count(*) from public.sc_drafts) as drafts');const before=(await counts()).rows;
  await assert.rejects(app.commitCurrentSelection('2026-10-10',{intentKey:'original-intent'}),error=>error instanceof AppError&&error.code==='conflict'||error instanceof Error&&error.message==='conflict');assert.deepEqual((await counts()).rows,before);
  let lose=true;const record=remote.recordEvent;remote.recordEvent=async(...args)=>{const result=await record(...args);if(lose){lose=false;throw Error('fixture response lost');}return result;};
  await assert.rejects(app.commitCurrentSelection(day,{intentKey:'recover-original'}),/response lost/);const recovered=await app.commitCurrentSelection(day,{intentKey:'recover-original'});assert.equal(recovered.replayed,true);assert.equal(app.cardOutfits().length,1);
  await app.configureRemote(remote);assert.equal(app.events().length,3);assert.equal(app.cardOutfits().length,1);assert.equal(app.events().filter(e=>e.kind==='wear').length,0);assert.deepEqual(app.outfit(card.entity.id).items,draft.items);
  const state=await repo.state();assert.equal(state.outfits.filter(o=>o.purpose==='selection').length,3);assert.equal(state.outfits.filter(o=>o.purpose==='card').length,1);
 }finally{await db.close();}
});
test('R15 existing SQL confirmation keeps distinct wear intents, and reading a prefill or later card save never records wear',async()=>{
 const{db,app,remote}=await fixture();try{const selection=await app.commitCurrentSelection(day);const prefill=app.actualWearPrefill(day,selection.event.id);assert.equal(prefill.status,'ready');assert.equal(app.events().filter(e=>e.kind==='wear').length,0);
 const first=await app.recordWear(prefill.outfit!.id,day,'actual-first');const replay=await app.recordWear(prefill.outfit!.id,day,'actual-first');assert.equal(replay.entity.id,first.entity.id);await app.recordWear(prefill.outfit!.id,day,'actual-second');await app.saveOutfit('keep-after-wear');await app.configureRemote(remote);assert.equal(app.events().filter(e=>e.kind==='wear').length,2);assert.equal(app.cardOutfits().length,1);assert.equal(app.events().filter(e=>e.kind==='plan').length,1);
 }finally{await db.close();}
});
