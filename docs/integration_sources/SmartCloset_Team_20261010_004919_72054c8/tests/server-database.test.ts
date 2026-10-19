// Real HTTP handlers/repository + actual PostgreSQL WASM; Auth/REST transport are local fixtures.
// No external network, real Auth login, provider execution, or remote persistence is claimed.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { PGlite } from '@electric-sql/pglite';
import { createApiServer } from '../server/http';
import { readConfig, PROJECT_REF } from '../server/config';
import type { FetchPort } from '../server/supabase';
import { asRole, createTestDatabase, OWNER, OTHER } from './db-harness';
import type { RegistrationDraft } from '../src/core/types';

const fixtureTokens:Record<string,string>={'fixture-only-owner-token':OWNER,'fixture-only-other-token':OTHER};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const config=readConfig({SUPABASE_URL:`https://${PROJECT_REF}.supabase.co`,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',AI_MODE:'mock',LIVE_ENABLED:'false'});
let db:PGlite,server:Server,base:string,cookie:string,otherCookie:string,providerCalls=0,authChecks=0;
const databaseCalls:{path:string;owner:string}[]=[];
let queue:Promise<unknown>=Promise.resolve();

const fakeDatabaseTransport:FetchPort=async(address,init)=>{
 const url=new URL(address);assert.equal(url.origin,`https://${PROJECT_REF}.supabase.co`);
 const headers=new Headers(init.headers),bearer=(headers.get('authorization')??'').replace(/^Bearer /,'');
 if(url.pathname==='/auth/v1/token'){
  const body=JSON.parse(String(init.body));if(body.password!=='fixture-only-password'||!['owner@example.invalid','other@example.invalid'].includes(body.email))return json({error:'invalid credentials'},400);
  return json({access_token:body.email.startsWith('owner')?'fixture-only-owner-token':'fixture-only-other-token',expires_in:3600});
 }
 if(url.pathname==='/auth/v1/user'){authChecks++;return fixtureTokens[bearer]?json({id:fixtureTokens[bearer]}):json({error:'unauthorized'},401);}
 const owner=fixtureTokens[bearer];if(!owner)return json({message:'unauthorized'},401);
 databaseCalls.push({path:url.pathname,owner});
 // PostgREST has one user role/context per DB transaction. Serialize this one-connection fixture.
 const next=queue.then(async()=>{
  await asRole(db,'authenticated',owner);
  try{
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const name=url.pathname.split('/').at(-1)!;assert.match(name,/^sc_[a-z_]+$/);
    const args=JSON.parse(String(init.body)) as Record<string,unknown>;const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^p_[a-z_]+$/));
    const values=keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);
    const rows=await db.query<{result:unknown}>(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,values);
    return json(rows.rows[0].result);
   }
   const table=url.pathname.split('/').at(-1)!;assert.match(table,/^sc_[a-z_]+$/);assert.equal(init.method??'GET','GET');
   const values:unknown[]=[],clauses:string[]=[];let limit=1000;let order='';
   for(const [key,value] of url.searchParams){
    if(key==='select'){assert.equal(value,'*');continue;}
    if(key==='limit'){limit=Math.min(1000,Number(value));assert.ok(Number.isSafeInteger(limit)&&limit>=0);continue;}
    if(key==='order'){const parts=value.split('.');assert.match(parts[0],/^[a-z_]+$/);assert.ok(['asc','desc'].includes(parts[1]??'asc'));order=` order by ${parts[0]} ${parts[1]??'asc'}`;continue;}
    const expression=key==='snapshot_json->_client->>revision'?"snapshot_json -> '_client' ->> 'revision'":key;
    if(expression===key)assert.match(key,/^[a-z_]+$/);assert.ok(value.startsWith('eq.'),`unsupported fixture filter ${value}`);values.push(value.slice(3));clauses.push(`${expression}=$${values.length}`);
   }
   const result=await db.query(`select * from public.${table}${clauses.length?' where '+clauses.join(' and '):''}${order} limit ${limit}`,values);
   return json(result.rows);
  }catch(error){const e=error as {code?:string;message?:string};return json({code:e.code??'P0001',message:e.message??'fixture database error'},e.code==='42501'?403:400);}
 });
 queue=next.catch(()=>undefined);return next;
};

async function start(){server=createApiServer(config,{databaseFetch:fakeDatabaseTransport,providerFetch:async()=>{providerCalls++;throw new Error('External provider transport forbidden in server/database tests');}});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');base=`http://127.0.0.1:${address.port}`;}
async function stop(){await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}
async function call(path:string,method='GET',value?:unknown,session=cookie,extra:Record<string,string>={}){
 const headers:Record<string,string>={Origin:config.origin,...(session?{Cookie:session}:{}),...extra};if(value!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+path,{method,headers,body:value===undefined?undefined:JSON.stringify(value)});return{status:response.status,body:await response.json() as any,headers:response.headers};
}
function draft(name:string,category:'top'|'bottom'='top'):RegistrationDraft{return{draftId:randomUUID(),ownerId:OWNER,revision:1,name,category,asset:null,color:'검정',features:['단추'],material:'미확인',size:'',location:'행거 A',careNotes:'',manualFields:{name:true,color:true,location:true},provenance:{location:'user',size:'unconfirmed',care:'unconfirmed'}};}

async function signInFixtures(){
 const a=await call('/api/session','POST',{email:'owner@example.invalid',password:'fixture-only-password'},'');assert.equal(a.status,200);cookie=a.headers.get('set-cookie')!.split(';')[0];assert.match(a.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict; Path=\/api/);
 const b=await call('/api/session','POST',{email:'other@example.invalid',password:'fixture-only-password'},'');assert.equal(b.status,200);otherCookie=b.headers.get('set-cookie')!.split(';')[0];
}
before(async()=>{db=await createTestDatabase();await start();await signInFixtures();});
after(async()=>{if(server)await stop();if(db)await db.close();assert.equal(providerCalls,0);});

test('real HTTP → repository → SQL registration, manual correction, duplicate save, search and restart',async()=>{
 const d=draft('등록 전 이름');let result=await call('/api/registrations','POST',{draft:d});assert.equal(result.status,201);assert.equal(result.body.revision,1);
 d.name='수동 수정 재킷';d.location='행거 B';d.revision=2;result=await call(`/api/drafts/${d.draftId}`,'PUT',{kind:'registration',draft:d});assert.equal(result.status,200);assert.equal(result.body.state_json.name,'수동 수정 재킷');
 const key=randomUUID();const first=await call('/api/garments','POST',{intent_key:key,draft:d});assert.equal(first.status,200);assert.equal(first.body.entity.name,d.name);assert.equal(first.body.entity.location,'행거 B');
 const second=await call('/api/garments','POST',{intent_key:key,draft:d});assert.equal(second.status,200);assert.equal(second.body.replayed,true);assert.deepEqual(second.body.receipt,first.body.receipt);
 const alias=await call('/api/garments','POST',{intent_key:randomUUID(),draft:d});assert.equal(alias.body.receipt.id,first.body.receipt.id);
 const search=await call('/api/garments?q='+encodeURIComponent('수동 수정'));assert.equal(search.status,200);assert.equal(search.body.garments.length,1);assert.equal(search.body.garments[0].id,first.body.entity.id);
 await stop();await start();assert.equal((await call('/api/session')).status,401);await signInFixtures();const restored=await call('/api/state');assert.equal(restored.status,200);const found=restored.body.garments.find((g:any)=>g.id===first.body.entity.id);assert.equal(found.name,d.name);assert.equal(restored.body.receipts.filter((r:any)=>r.id===first.body.receipt.id).length,1);
 assert.equal(providerCalls,0);assert.ok(authChecks>=8);assert.ok(databaseCalls.some(c=>c.path==='/rest/v1/rpc/sc_commit_action'&&c.owner===OWNER));
});

test('old saved intent/revision is replayed after newer draft edits without replacing those edits',async()=>{
 const d=draft('saved original');const key=randomUUID();const first=await call('/api/garments','POST',{intent_key:key,draft:d});assert.equal(first.status,200);
 const edited={...d,revision:2,name:'new unsaved edit'};assert.equal((await call(`/api/drafts/${d.draftId}`,'PUT',{kind:'registration',draft:edited})).status,200);
 const repeated=await call('/api/garments','POST',{intent_key:key,draft:d});assert.equal(repeated.status,200);assert.equal(repeated.body.receipt.id,first.body.receipt.id);assert.equal(repeated.body.entity.name,'saved original');
 const alias=await call('/api/garments','POST',{intent_key:randomUUID(),draft:d});assert.equal(alias.status,200);assert.equal(alias.body.receipt.id,first.body.receipt.id);
 const conflict=await call('/api/garments','POST',{intent_key:key,draft:{...d,name:'changed old input'}});assert.equal(conflict.status,409);assert.equal(conflict.body.error.code,'conflict');
 const state=await call('/api/state');assert.equal(state.body.registrationDrafts[OWNER].name,'new unsaved edit');
});

test('saved and editing drafts soft-discard without deleting saved entities, then another registration becomes current',async()=>{
 const d={...draft('보존할 저장 의류'),revision:3};const key=randomUUID();const first=await call('/api/garments','POST',{intent_key:key,draft:d});assert.equal(first.status,200);
 const savedState=await call('/api/state');assert.equal(savedState.status,200);assert.equal(savedState.body.registrationDrafts[OWNER].savedGarmentId,first.body.entity.id);assert.equal(savedState.body.receipts.find((r:any)=>r.id===first.body.receipt.id).revision,3);
 const stale=await call(`/api/drafts/${d.draftId}/discard`,'POST',{revision:2});assert.equal(stale.status,409);assert.equal(stale.body.error.code,'stale_revision');
 const other=await call(`/api/drafts/${d.draftId}/discard`,'POST',{revision:3},otherCookie);assert.equal(other.status,404);
 const discarded=await call(`/api/drafts/${d.draftId}/discard`,'POST',{revision:3});assert.equal(discarded.status,200);assert.equal(discarded.body.status,'discarded');assert.equal(discarded.body.revision,1);
 const again=await call(`/api/drafts/${d.draftId}/discard`,'POST',{revision:3});assert.equal(again.status,200);assert.deepEqual(again.body,discarded.body);
 const late=await call(`/api/drafts/${d.draftId}`,'PUT',{kind:'registration',draft:{...d,revision:4,name:'폐기 후 늦은 자동저장'}});assert.equal(late.status,409);assert.equal(late.body.error.code,'conflict');
 const newDraft=draft('다른 옷 새 등록');assert.equal((await call('/api/registrations','POST',{draft:newDraft})).status,201);
 const state=await call('/api/state');assert.equal(state.body.registrationDrafts[OWNER].draftId,newDraft.draftId);assert.equal(state.body.garments.find((g:any)=>g.id===first.body.entity.id).name,'보존할 저장 의류');assert.ok(state.body.receipts.some((r:any)=>r.id===first.body.receipt.id));
 const replay=await call('/api/garments','POST',{intent_key:key,draft:d});assert.equal(replay.status,200);assert.equal(replay.body.receipt.id,first.body.receipt.id);
 assert.equal((await call(`/api/drafts/${newDraft.draftId}/discard`,'POST',{revision:1})).status,200);
 const after=await call('/api/state');assert.notEqual(after.body.registrationDrafts[OWNER]?.draftId,newDraft.draftId);assert.equal(after.body.garments.filter((g:any)=>g.name==='다른 옷 새 등록').length,0);
});

test('HTTP owner forgery and other-user object reads are denied using SQL RLS context',async()=>{
 const d=draft('owner-only');const saved=await call('/api/garments','POST',{intent_key:randomUUID(),draft:d});assert.equal(saved.status,200);
 const forged=await call('/api/garments','POST',{intent_key:randomUUID(),draft:{...draft('forged'),ownerId:OTHER}});assert.equal(forged.status,403);assert.equal(forged.body.error.code,'unauthorized_target');
 const other=await call(`/api/garments/${saved.body.entity.id}`,'GET',undefined,otherCookie);assert.equal(other.status,404);assert.equal(other.body.error.code,'unauthorized_target');
 const otherState=await call('/api/state','GET',undefined,otherCookie);assert.equal(otherState.body.garments.length,0);assert.equal(otherState.body.receipts.length,0);
 const noSession=await call('/api/state','GET',undefined,'');assert.equal(noSession.status,401);
});

test('Origin, cross-site, body size and owner schema guards run before storage mutation',async()=>{
 const beforeCount=databaseCalls.filter(c=>c.path.endsWith('sc_commit_action')).length;
 const wrong=await call('/api/garments','POST',{intent_key:randomUUID(),draft:draft('wrong origin')},cookie,{Origin:'https://attacker.invalid'});assert.equal(wrong.status,403);
 const cross=await call('/api/state','GET',undefined,cookie,{'Sec-Fetch-Site':'cross-site'});assert.equal(cross.status,403);
 const large=await call('/api/garments','POST',{intent_key:randomUUID(),draft:{...draft('large'),careNotes:'x'.repeat(70_000)}});assert.equal(large.status,413);
 const extra=await call('/api/garments','POST',{intent_key:randomUUID(),draft:draft('extra'),owner_id:OTHER});assert.equal(extra.status,400);
 assert.equal(databaseCalls.filter(c=>c.path.endsWith('sc_commit_action')).length,beforeCount);
});

test('outfit save and plan/wear events use ordinary SQL; duplicate event returns one receipt',async()=>{
 const top=await call('/api/garments','POST',{intent_key:randomUUID(),draft:draft('코디 상의')});const bottom=await call('/api/garments','POST',{intent_key:randomUUID(),draft:draft('코디 하의','bottom')});
 const o={draftId:randomUUID(),ownerId:OWNER,revision:1,name:'SQL 연결 코디',topLocked:true,items:{top:top.body.entity.id,bottom:bottom.body.entity.id}};
 const outfit=await call('/api/outfits','POST',{intent_key:randomUUID(),draft:o});assert.equal(outfit.status,200);assert.deepEqual(outfit.body.entity.items,o.items);
 const savedState=await call('/api/state');assert.equal(savedState.body.outfitDrafts[OWNER].savedOutfitId,outfit.body.entity.id);
 const event={intent_key:randomUUID(),target_id:outfit.body.entity.id,value:'출근 계획',date:'2026-10-13',client_event_id:randomUUID(),input_source:'user_confirmed'};
 const plan=await call('/api/outfit-plans','POST',event);assert.equal(plan.status,200);assert.equal(plan.body.entity.kind,'plan');
 const repeat=await call('/api/outfit-plans','POST',{...event,intent_key:randomUUID()});assert.equal(repeat.body.receipt.id,plan.body.receipt.id);
 const wear=await call('/api/wear-events','POST',{...event,intent_key:randomUUID(),client_event_id:randomUUID(),value:'실제 착용'});assert.equal(wear.status,200);assert.equal(wear.body.entity.kind,'wear');assert.notEqual(wear.body.entity.id,plan.body.entity.id);
 assert.equal(providerCalls,0);
});

test('local configuration remains mock and live-off; returned config contains no fixture secret values',async()=>{
 const c=await call('/api/config','GET',undefined,'');assert.equal(c.status,200);assert.equal(c.body.ai_mode,'mock');assert.equal(c.body.live_enabled,false);assert.equal(c.body.key_present.openai,false);assert.equal(c.body.key_present.decart,false);
 assert.ok(!JSON.stringify(c.body).includes('sb_publishable_fixture_only'));assert.ok(!JSON.stringify(c.body).includes('fixture-only-password'));assert.equal(providerCalls,0);
});
