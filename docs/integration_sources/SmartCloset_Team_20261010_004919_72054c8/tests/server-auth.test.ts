// Auth/HTTP contracts against injected responses. These are not real-user login claims.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {BrowserSessions,SupabaseGateway,type FetchPort} from '../server/supabase';
import {readConfig,PROJECT_REF} from '../server/config';
import {AppError} from '../server/errors';
import {createApiServer} from '../server/http';
import {BackendError,HttpRemoteBackend,onBackendSessionExpired} from '../src/integrations/backendClient';
const USER='10000000-0000-4000-8000-000000000001';
const config=readConfig({SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only'});
const json=(body:unknown,status=200)=>Response.json(body,{status});
const tokens={access_token:'fixture-access-private',refresh_token:'fixture-refresh-private',expires_in:3600};
function fixture(overrides?:(path:string,init:RequestInit)=>Promise<Response|undefined>){const calls:string[]=[];const transport:FetchPort=async(url,init)=>{const p=new URL(url).pathname+new URL(url).search;calls.push(p);const override=await overrides?.(p,init);if(override)return override;if(p.startsWith('/auth/v1/token'))return json(tokens);if(p==='/auth/v1/user')return json({id:USER});if(p==='/auth/v1/logout?scope=local')return new Response(null,{status:204});if(p==='/auth/v1/settings')return json({external:{email:true,google:false},mailer_autoconfirm:false,unrelated:'do not expose'});throw new Error('unexpected fixture path');};return{gateway:new SupabaseGateway(config,transport),transport,calls};}
async function withServer(transport:FetchPort,run:(base:string)=>Promise<void>){const server=createApiServer(config,{databaseFetch:transport,providerFetch:async()=>{throw new Error('provider forbidden');}});server.listen(0,'127.0.0.1');await once(server,'listening');try{await run(`http://127.0.0.1:${(server.address()as{port:number}).port}`);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}}
const credentials={email:'fixture@example.invalid',password:'fixture-only-password'};
const writeHeaders={Origin:config.origin,'Content-Type':'application/json'};

test('fixed existing project is preconfigured without credentials or live activation',()=>{const c=readConfig({});assert.equal(c.supabaseUrl,`https://${PROJECT_REF}.supabase.co`);assert.equal(c.publishableKey,'');assert.equal(c.liveEnabled,false);assert.throws(()=>readConfig({SUPABASE_URL:'https://other.supabase.co'}));});

test('Auth code/status are sanitized; invalid credentials, email confirmation and transport failures differ',async()=>{
 for(const[upstream,status,expected]of[['invalid_credentials',400,'invalid_credentials'],['email_not_confirmed',422,'email_not_confirmed'],['captcha_failed',400,'auth_captcha_required'],['email_provider_disabled',400,'auth_method_disabled'],['untrusted-secret-text',500,'auth_unavailable']]as const){
  const{gateway}=fixture(async()=>json({error_code:upstream,msg:'private user/email/password body must not escape'},status));
  await assert.rejects(gateway.login(credentials.email,credentials.password),(error:unknown)=>{assert.ok(error instanceof AppError);assert.equal(error.code,expected);assert.equal(error.diagnostic?.stage,'auth');assert.equal(error.diagnostic?.upstream_status,status);assert.equal(JSON.stringify(error).includes('private user'),false);assert.equal(JSON.stringify(error).includes('untrusted-secret-text'),false);return true;});
 }
 const gateway=new SupabaseGateway(config,async()=>{throw new Error('private transport failure');});await assert.rejects(gateway.login(credentials.email,credentials.password),(e:unknown)=>e instanceof AppError&&e.code==='auth_unavailable');
});

test('login stores only opaque cookie; reload restores identity; local logout revokes and prevents reuse',async()=>{
 const f=fixture();await withServer(f.transport,async base=>{
  const login=await fetch(base+'/api/session',{method:'POST',headers:writeHeaders,body:JSON.stringify(credentials)});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!;assert.match(cookie,/^sc_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/api; Max-Age=604800$/);assert.ok(!cookie.includes(tokens.access_token));const content=await login.text();assert.ok(!content.includes('token'));assert.match(login.headers.get('cache-control')!,/private, no-store/);
  const current=await fetch(base+'/api/session',{headers:{Cookie:cookie.split(';')[0]}});assert.deepEqual(await current.json(),{authenticated:true,user_id:USER});
  const logout=await fetch(base+'/api/session',{method:'DELETE',headers:{...writeHeaders,Cookie:cookie.split(';')[0]}});assert.deepEqual(await logout.json(),{authenticated:false,revocation:'confirmed'});assert.match(logout.headers.get('set-cookie')!,/Max-Age=0/);assert.ok(f.calls.includes('/auth/v1/logout?scope=local'));
  assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie.split(';')[0]}})).status,401);
 });
});

test('initial request and malformed/restarted process cookie stay unauthenticated without network',async()=>{const f=fixture();await withServer(f.transport,async base=>{for(const cookie of['','sc_session=%xx','sc_session='+'a'.repeat(43)])assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie}})).status,401);});assert.equal(f.calls.length,0);});

test('Auth success is independent from DB/RLS failure',async()=>{const f=fixture(async path=>path.startsWith('/rest/')?json({code:'42501',message:'permission denied private details'},403):undefined);await withServer(f.transport,async base=>{const r=await fetch(base+'/api/session',{method:'POST',headers:writeHeaders,body:JSON.stringify(credentials)});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie')!.split(';')[0];const state=await fetch(base+'/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,403);assert.equal((await state.json()).error.code,'unauthorized_target');assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie}})).status,200);});});

test('Data API 401 after verified Auth does not masquerade as an expired login',async()=>{const f=fixture(async path=>path.startsWith('/rest/')?json({code:'PGRST301',message:'database token details'},401):undefined);await withServer(f.transport,async base=>{const r=await fetch(base+'/api/session',{method:'POST',headers:writeHeaders,body:JSON.stringify(credentials)});const cookie=r.headers.get('set-cookie')!.split(';')[0];const state=await fetch(base+'/api/state',{headers:{Cookie:cookie}}),failure=await state.json();assert.equal(state.status,503);assert.equal(failure.error.code,'database_unavailable');assert.deepEqual(failure.error.diagnostic,{stage:'database',upstream_status:401});assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie}})).status,200);});});

test('refresh has one request for concurrent reads and uses the rotated token',async()=>{
 let now=0,refreshes=0;const f=fixture(async(path,init)=>{if(path.includes('grant_type=refresh_token')){refreshes++;assert.deepEqual(JSON.parse(String(init.body)),{refresh_token:tokens.refresh_token});await new Promise(r=>setTimeout(r,10));return json({...tokens,access_token:'rotated-access',refresh_token:'rotated-refresh'});}if(path==='/auth/v1/user'&&refreshes)assert.equal(new Headers(init.headers).get('Authorization'),'Bearer rotated-access');});
 const sessions=new BrowserSessions(f.gateway,()=>now),s=await sessions.open(credentials.email,credentials.password);now=3580000;const users=await Promise.all([sessions.resolve(s.id),sessions.resolve(s.id),sessions.resolve(s.id)]);assert.equal(refreshes,1);assert.ok(users.every(u=>u.token==='rotated-access'));await sessions.resolve(s.id);assert.equal(refreshes,1);
});

test('failed/expired refresh clears the local session and never returns stale success',async()=>{let now=0;const f=fixture(async path=>path.includes('grant_type=refresh_token')?json({error_code:'refresh_token_not_found'},400):undefined);const sessions=new BrowserSessions(f.gateway,()=>now),s=await sessions.open(credentials.email,credentials.password);now=3580000;await assert.rejects(sessions.resolve(s.id),(e:unknown)=>e instanceof AppError&&e.code==='session_expired');const calls=f.calls.length;await assert.rejects(sessions.resolve(s.id));assert.equal(f.calls.length,calls);});

test('both access validation and refresh reject a changed owner instead of reusing a session',async()=>{
 for(const refresh of[false,true]){let now=0,changed=false;const f=fixture(async path=>path==='/auth/v1/user'&&changed?json({id:'20000000-0000-4000-8000-000000000002'}):undefined);const sessions=new BrowserSessions(f.gateway,()=>now),s=await sessions.open(credentials.email,credentials.password);changed=true;if(refresh)now=3580000;await assert.rejects(sessions.resolve(s.id),(e:unknown)=>e instanceof AppError&&e.code==='session_expired');const count=f.calls.length;await assert.rejects(sessions.resolve(s.id));assert.equal(f.calls.length,count);}
});

test('logout racing refresh cannot restore or retain an authorized session',async()=>{
 let now=0,release!:()=>void,entered!:()=>void;const seen=new Promise<void>(resolve=>{entered=resolve;});const wait=new Promise<void>(resolve=>{release=resolve;});let signedOutToken='';
 const f=fixture(async(path,init)=>{if(path.includes('grant_type=refresh_token')){entered();await wait;return json({...tokens,access_token:'rotated-after-logout'});}if(path.includes('/logout'))signedOutToken=new Headers(init.headers).get('Authorization')??'';});
 const sessions=new BrowserSessions(f.gateway,()=>now),s=await sessions.open(credentials.email,credentials.password);now=3580000;const pending=sessions.resolve(s.id);await seen;const closing=sessions.close(s.id);release();await assert.rejects(pending);assert.equal(await closing,'confirmed');assert.equal(signedOutToken,'Bearer rotated-after-logout');await assert.rejects(sessions.resolve(s.id));
});

test('logout upstream failure still closes browser access and reports unconfirmed revocation',async()=>{const f=fixture(async path=>path.includes('/logout')?json({},503):undefined);const sessions=new BrowserSessions(f.gateway),s=await sessions.open(credentials.email,credentials.password);assert.equal(await sessions.close(s.id),'unconfirmed');await assert.rejects(sessions.resolve(s.id));});

test('public Auth status returns only nonidentifying allowed fields',async()=>{const f=fixture();await withServer(f.transport,async base=>{const r=await fetch(base+'/api/auth-status');assert.deepEqual(await r.json(),{project_ref:PROJECT_REF,email_password_enabled:true,email_confirmation_required:true});});});

test('client distinguishes missing app server from Auth errors and publishes expiry once per response',async()=>{const unavailable=new HttpRemoteBackend(async()=>{throw new Error('secret network details');});await assert.rejects(unavailable.session(),(e:unknown)=>e instanceof BackendError&&e.code==='backend_unavailable'&&!e.message.includes('secret'));let expired=0;const off=onBackendSessionExpired(()=>{expired++;});try{const client=new HttpRemoteBackend(async()=>json({error:{code:'session_expired',message:'expired',diagnostic:{stage:'auth',upstream_status:401,upstream_code:'bad_jwt'}}},401));await assert.rejects(client.session(),(e:unknown)=>e instanceof BackendError&&e.status===401&&e.diagnostic?.stage==='auth');assert.equal(expired,1);}finally{off();}});

test('late expiry from a previous login cannot clear the new owner; owner change resets execution mode',async()=>{
 let release!:(value:Response)=>void;const client=new HttpRemoteBackend(()=>new Promise(resolve=>{release=resolve;}));let expired=0;const off=onBackendSessionExpired(()=>{expired++;});try{client.bindSession('owner-a');client.mode='live';const pending=client.session();client.bindSession('owner-b');release(json({error:{code:'session_expired',message:'old session'}},401));await assert.rejects(pending);assert.equal(expired,0);assert.equal(client.mode,'mock');}finally{off();}
});

test('client does not apply a state response belonging to another owner or superseded binding',async()=>{
 let release!:(value:Response)=>void;const client=new HttpRemoteBackend(()=>new Promise(resolve=>{release=resolve;}));let expired=0;const off=onBackendSessionExpired(()=>{expired++;});try{client.bindSession('owner-a');const wrong=client.state();release(json({activeProfileId:'owner-b'}));await assert.rejects(wrong,(e:unknown)=>e instanceof BackendError&&e.code==='session_expired');assert.equal(expired,1);const old=client.state();client.bindSession('owner-b');release(json({activeProfileId:'owner-a'}));await assert.rejects(old);assert.equal(expired,1);}finally{off();}
});
