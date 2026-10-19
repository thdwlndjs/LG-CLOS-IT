// Existing PostgreSQL/RLS sources in an in-memory PGlite only; no external database or real credentials.
import test from 'node:test';
import {AppError} from '../server/errors';
const code=(expected:string)=>(error:unknown)=>error instanceof AppError&&error.code===expected||error instanceof Error&&error.message===expected;
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {asRole,createTestDatabase,OWNER} from './db-harness';
import {DatabaseRepository} from '../server/repository';
import {outfitInput} from '../server/domain';
import type {SupabaseGateway,UserContext} from '../server/supabase';
import {DemoApp} from '../src/core/app';
import type {Garment,Outfit,OutfitDraft,RegistrationDraft,SaveResult,StorageLike} from '../src/core/types';
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
 const initialAsset=randomUUID();await asRole(db,'postgres');
 await db.query("insert into public.sc_assets(id,owner_id,storage_key,mime_type,byte_size,sha256,provenance,kind,status,finalized_at) values($1,$2,$3,'image/png',1,$4,'user_upload','garment','finalized',now())",[initialAsset,OWNER,OWNER+'/'+initialAsset+'/fixture.png','1'.repeat(64)]);
 await db.query('update public.sc_garments set asset_id=$1,asset_version=1 where id=$2',[initialAsset,top.entity.id]);await asRole(db,'authenticated',OWNER);
 const draft:OutfitDraft={draftId:randomUUID(),ownerId:OWNER,revision:1,name:'사용자가 정한 이름',nameOrigin:'user',purpose:'card',items:{top:top.entity.id,bottom:bottom.entity.id},topLocked:false,assetIds:{[top.entity.id]:initialAsset,[bottom.entity.id]:null},assetVersions:{[top.entity.id]:1,[bottom.entity.id]:0}};await repo.putDraft(draft);
 const remote:RemoteBackend={mode:'mock',state:()=>repo.state(),putDraft:async value=>{await repo.putDraft('items'in value?outfitInput(value,OWNER):value);},discardDraft:async value=>{await repo.discardDraft(value.draftId,value.revision);},saveGarment:(value,key)=>repo.save('saveGarment',value,key)as Promise<SaveResult<Garment>>,saveOutfit:(value,key)=>repo.save('saveOutfit',outfitInput(value,OWNER),key)as Promise<SaveResult<Outfit>>,recordEvent:(kind,targetId,value,date,intentKey)=>repo.event(kind==='wear'?'recordWear':'planOutfit',{targetId,value,date,intentKey,clientEventId:intentKey,inputSource:'user_confirmed'}),analyze:async()=>null,recommend:async()=>null,care:async()=>{throw Error('unused');},tryOn:async()=>({})};
 const app=new DemoApp();await app.configureRemote(remote);return{db,repo,remote,app,draft};
}
class MemoryStore implements StorageLike{values=new Map<string,string>();getItem(key:string){return this.values.get(key)??null;}setItem(key:string,value:string){this.values.set(key,value);}removeItem(key:string){this.values.delete(key);}}
const fast={delayMs:0};
function local(){const app=new DemoApp(new MemoryStore());app.startBlankOutfit();app.setOutfitItem('top','g-knit');app.setOutfitItem('bottom','g-jeans');return app;}
function changeLocalPhoto(app:DemoApp){app.repository.commit(s=>{const asset=s.garments.find(g=>g.id==='g-knit')!.asset!;asset.id='replacement-same-version';});}

test('R12 local committed card and wear receipts recover after exact-ID drift without recreating either record',async()=>{
 const app=local(),card=await app.saveOutfit('original-card',fast),wear=await app.recordWear(card.entity.id,day,'original-wear',fast);changeLocalPhoto(app);
 const cardRetry=await app.saveOutfit('original-card',fast),alias=await app.saveOutfit('accidental-new-card-key',fast),wearRetry=await app.recordWear(card.entity.id,day,'original-wear',fast);
 assert.equal(cardRetry.replayed,true);assert.equal(cardRetry.receipt.id,card.receipt.id);assert.equal(alias.receipt.id,card.receipt.id);assert.deepEqual(cardRetry.entity,card.entity);assert.equal(wearRetry.receipt.id,wear.receipt.id);assert.equal(wearRetry.replayed,true);assert.equal(app.events().filter(e=>e.kind==='wear').length,1);
});

test('R12 local receipt recovery still rejects changed request/name/date and new stale intents',async()=>{
 const app=local(),card=await app.saveOutfit('original-card',fast);await app.recordWear(card.entity.id,day,'original-wear',fast);changeLocalPhoto(app);
 await assert.rejects(app.recordWear(card.entity.id,'2026-10-10','original-wear',fast),/같은 저장 키/);
 await assert.rejects(app.recordWear(card.entity.id,day,'new-wear',fast),/사진이 바뀌었/);
 const owner=app.getState().activeProfileId;app.repository.commit(s=>{s.outfitDrafts[owner].name='changed payload';});await assert.rejects(app.saveOutfit('original-card',fast),/같은 저장 키/);
 app.loadOutfitDraft(card.entity.id,{reuse:true});await assert.rejects(app.saveOutfit('new-card',fast),/사진이 바뀌었/);
 assert.equal(app.events().filter(e=>e.kind==='wear').length,1);
});

async function changeSqlPhoto(f:Awaited<ReturnType<typeof fixture>>){
 const asset=randomUUID();await asRole(f.db,'postgres');
 await f.db.query("insert into public.sc_assets(id,owner_id,storage_key,mime_type,byte_size,sha256,provenance,kind,status,finalized_at) values($1,$2,$3,'image/png',1,$4,'user_upload','garment','finalized',now())",[asset,OWNER,OWNER+'/'+asset+'/fixture.png','2'.repeat(64)]);
 await f.db.query('update public.sc_garments set asset_id=$1,asset_version=1 where id=$2',[asset,f.draft.items.top]);await asRole(f.db,'authenticated',OWNER);await f.app.reloadRemote();return asset;
}

test('R12 actual SQL lost card response recovers the immutable original receipt after photo drift, including alias key',async()=>{
 const f=await fixture();try{
  const save=f.remote.saveOutfit;let lose=true,committed:SaveResult<Outfit>|null=null;
  f.remote.saveOutfit=async(...args)=>{const result=await save(...args);committed=result;if(lose){lose=false;throw Error('fixture card response lost');}return result;};
  await assert.rejects(f.app.saveOutfit('original-card'),/response lost/);assert.ok(committed);const original=structuredClone(committed as SaveResult<Outfit>);
  await changeSqlPhoto(f);
  const restored=await f.app.saveOutfit('original-card'),alias=await f.app.saveOutfit('alias-card');
  assert.equal(restored.replayed,true);assert.equal(restored.receipt.id,original.receipt.id);assert.equal(alias.receipt.id,original.receipt.id);assert.deepEqual(restored.entity,original.entity);
  assert.equal((await f.db.query<{count:number}>('select count(*)::int count from public.sc_outfits')).rows[0].count,1);
  assert.equal((await f.db.query<{count:number}>('select count(*)::int count from public.sc_activity_events')).rows[0].count,0);
 }finally{await f.db.close();}
});

test('R12 SQL receipt recovery never accepts changed client payload, owner, target/date or a new stale save/wear',async()=>{
 const f=await fixture();try{
  const card=await f.app.saveOutfit('original-card');const wear=await f.app.recordWear(card.entity.id,day,'original-wear');await changeSqlPhoto(f);
  const replay=await f.app.recordWear(card.entity.id,day,'original-wear');assert.equal(replay.receipt.id,wear.receipt.id);assert.equal(replay.replayed,true);
  for(const patch of [{name:'different'},{revision:2},{ownerId:randomUUID()},{assetIds:{...f.draft.assetIds,[f.draft.items.top!]:randomUUID()}},{items:{top:f.draft.items.bottom,bottom:f.draft.items.top}}])await assert.rejects(f.repo.save('saveOutfit',{...f.draft,...patch},'original-card'),code('conflict'));
  await assert.rejects(f.app.recordWear(card.entity.id,'2026-10-10','original-wear'),code('conflict'));
  await assert.rejects(f.app.recordWear(card.entity.id,day,'new-wear'),code('stale_revision'));
  await assert.rejects(f.repo.save('saveOutfit',{...f.draft,draftId:randomUUID()},'new-card'),code('stale_revision'));
  assert.equal((await f.db.query<{count:number}>('select count(*)::int count from public.sc_outfits')).rows[0].count,1);
  assert.equal((await f.db.query<{count:number}>('select count(*)::int count from public.sc_activity_events')).rows[0].count,1);
 }finally{await f.db.close();}
});

test('R12 SQL lost wear response recovers its original intent after current assets change',async()=>{
 const f=await fixture();try{
  const card=await f.app.saveOutfit('card'),record=f.remote.recordEvent;let lose=true;
  f.remote.recordEvent=async(...args)=>{const result=await record(...args);if(lose){lose=false;throw Error('fixture wear response lost');}return result;};
  await assert.rejects(f.app.recordWear(card.entity.id,day,'original-wear'),/response lost/);await changeSqlPhoto(f);
  const replay=await f.app.recordWear(card.entity.id,day,'original-wear');assert.equal(replay.replayed,true);
  assert.equal((await f.db.query<{count:number}>('select count(*)::int count from public.sc_activity_events')).rows[0].count,1);
 }finally{await f.db.close();}
});
