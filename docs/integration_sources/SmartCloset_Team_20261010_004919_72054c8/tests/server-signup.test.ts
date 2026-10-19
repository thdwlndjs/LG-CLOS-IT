// Injected Auth responses only: never creates a real account or sends email.
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SupabaseGateway,type FetchPort} from '../server/supabase';
import {readConfig} from '../server/config';
import {createApiServer} from '../server/http';
import {AppError} from '../server/errors';
import {HttpRemoteBackend} from '../src/integrations/backendClient';
const config=readConfig({SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only'});
const email='fixture@example.invalid',password='fixture-only-password',userId='10000000-0000-4000-8000-000000000001';
const accepted={accepted:true,confirmation_required:true};
function fixture(override?:(path:string,init:RequestInit)=>Response|undefined){const calls:string[]=[];const transport:FetchPort=async(url,init)=>{const path=new URL(url).pathname;calls.push(path);const custom=override?.(path,init);if(custom)return custom;if(path==='/auth/v1/settings')return Response.json({external:{email:true},mailer_autoconfirm:false});if(path==='/auth/v1/signup'||path==='/auth/v1/resend')return Response.json({id:userId,email});if(path==='/auth/v1/token')return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});if(path==='/auth/v1/user')return Response.json({id:userId});throw Error('Unexpected fixture request');};return{calls,transport,gateway:new SupabaseGateway(config,transport)};}
async function withServer(transport:FetchPort,run:(base:string)=>Promise<void>){const server=createApiServer(config,{databaseFetch:transport,providerFetch:async()=>{throw Error('Provider forbidden');}});server.listen(0,'127.0.0.1');await once(server,'listening');try{await run(`http://127.0.0.1:${(server.address()as{port:number}).port}`);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}}
const headers={Origin:config.origin,'Content-Type':'application/json'};
const post=(base:string,path:string,body:unknown,extra:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});

test('signup uses the public Auth contract and fixed local redirect without returning an upstream session',async()=>{
 const calls:string[]=[];const gateway=new SupabaseGateway(config,async(url,init)=>{const endpoint=new URL(url);calls.push(endpoint.pathname);assert.equal(new Headers(init.headers).get('apikey'),config.publishableKey);assert.equal(new Headers(init.headers).has('Authorization'),false);if(endpoint.pathname==='/auth/v1/settings')return Response.json({external:{email:true},mailer_autoconfirm:false});assert.equal(endpoint.pathname,'/auth/v1/signup');assert.equal(endpoint.searchParams.get('redirect_to'),config.origin+'/');assert.deepEqual(JSON.parse(String(init.body)),{email,password});return Response.json({user:{id:userId,email},access_token:'fixture-not-returned',refresh_token:'fixture-not-returned'});});
 assert.deepEqual(await gateway.signup(' '+email+' ',password),accepted);assert.deepEqual(calls,['/auth/v1/settings','/auth/v1/signup']);
});

test('confirmation resend is signup-only, same-origin, and never a password or session request',async()=>{
 let observed=false;const gateway=new SupabaseGateway(config,async(url,init)=>{const endpoint=new URL(url);if(endpoint.pathname==='/auth/v1/settings')return Response.json({external:{email:true},mailer_autoconfirm:false});observed=true;assert.equal(endpoint.pathname,'/auth/v1/resend');assert.equal(endpoint.searchParams.get('redirect_to'),config.origin+'/');assert.deepEqual(JSON.parse(String(init.body)),{type:'signup',email});return Response.json({message_id:'fixture-not-returned'});});assert.deepEqual(await gateway.resendConfirmation(email),accepted);assert.equal(observed,true);
});

test('disabled or unknown confirmation policy blocks signup before any account-creation request',async()=>{
 for(const settings of[{external:{email:true},mailer_autoconfirm:true},{external:{email:true}},{external:{email:false},mailer_autoconfirm:false}]){const f=fixture(path=>path==='/auth/v1/settings'?Response.json(settings):undefined);await assert.rejects(f.gateway.signup(email,password),(error:unknown)=>error instanceof AppError&&['auth_confirmation_required','auth_method_disabled'].includes(error.code));assert.deepEqual(f.calls,['/auth/v1/settings']);}
 const f=fixture();await assert.rejects(f.gateway.signup('invalid-address',password),(error:unknown)=>error instanceof AppError&&error.code==='email_invalid');assert.deepEqual(f.calls,[]);
});

test('signup errors distinguish mail restriction, throttling, weak password and disabled signup without raw upstream text',async()=>{
 for(const[upstream,status,expected]of[['email_address_not_authorized',400,'email_delivery_restricted'],['over_email_send_rate_limit',429,'email_rate_limited'],['weak_password',422,'weak_password'],['signup_disabled',422,'signup_disabled'],['email_address_invalid',422,'email_invalid'],['captcha_failed',400,'auth_captcha_required'],['user_already_exists',422,'account_exists']]as const){const f=fixture(path=>path==='/auth/v1/signup'?Response.json({code:upstream,message:'fixture private response must not escape'}, {status}):undefined);await assert.rejects(f.gateway.signup(email,password),(error:unknown)=>{assert.ok(error instanceof AppError);assert.equal(error.code,expected);assert.equal(error.message.includes('fixture private'),false);assert.equal(error.diagnostic?.upstream_code,upstream);return true;});}
});

test('HTTP signup and resend accept explicit signed-out requests without creating a cookie or DB profile',async()=>{
 const f=fixture();await withServer(f.transport,async base=>{for(const[path,body]of[['/api/signup',{email,password}],['/api/signup/resend',{email}]]as const){const response=await post(base,path,body);assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.deepEqual(await response.json(),accepted);}assert.equal((await fetch(base+'/api/session')).status,401);});assert.ok(f.calls.every(path=>['/auth/v1/settings','/auth/v1/signup','/auth/v1/resend'].includes(path)));
});

test('foreign Origin and caller-selected redirect are refused before upstream signup',async()=>{
 const f=fixture();await withServer(f.transport,async base=>{assert.equal((await post(base,'/api/signup',{email,password},{Origin:'https://other.invalid'})).status,403);assert.equal((await post(base,'/api/signup',{email,password,redirect_to:'https://other.invalid'})).status,400);});assert.deepEqual(f.calls,[]);
});

test('signup cannot replace an existing browser session and does not clear its cookie',async()=>{
 const f=fixture();await withServer(f.transport,async base=>{const login=await post(base,'/api/session',{email,password});const cookie=login.headers.get('set-cookie')!.split(';')[0];for(const path of['/api/signup','/api/signup/resend']){const response=await post(base,path,path.endsWith('resend')?{email}:{email,password},{Cookie:cookie});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'signup_signed_in');assert.equal(response.headers.get('set-cookie'),null);}const session=await fetch(base+'/api/session',{headers:{Cookie:cookie}});assert.deepEqual(await session.json(),{authenticated:true,user_id:userId});});assert.equal(f.calls.includes('/auth/v1/signup'),false);assert.equal(f.calls.includes('/auth/v1/resend'),false);assert.equal(f.calls.some(path=>path.includes('logout')),false);
});

test('local mail limit is shared by signup and resend and stops a fourth send request',async()=>{
 const f=fixture();await withServer(f.transport,async base=>{for(let i=0;i<3;i++)assert.equal((await post(base,'/api/signup/resend',{email})).status,200);const response=await post(base,'/api/signup',{email,password});assert.equal(response.status,429);assert.equal((await response.json()).error.code,'email_rate_limited');});assert.equal(f.calls.filter(path=>path==='/auth/v1/resend').length,3);assert.equal(f.calls.includes('/auth/v1/signup'),false);
});

test('browser signup methods submit only explicit credentials and do not change the current adapter mode',async()=>{
 const requests:{path:string;body:unknown}[]=[];const client=new HttpRemoteBackend(async(path,init)=>{requests.push({path:String(path),body:JSON.parse(String(init?.body))});return Response.json(accepted);});client.bindSession('existing-owner');client.mode='saved_result';assert.deepEqual(requests,[]);await client.signup(email,password);await client.resendConfirmation(email);assert.equal(client.mode,'saved_result');assert.deepEqual(requests,[{path:'/api/signup',body:{email,password}},{path:'/api/signup/resend',body:{email}}]);
});