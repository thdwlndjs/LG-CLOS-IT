import { randomBytes } from 'node:crypto';
import { AppError, record, text, uuid, type SafeDiagnostic } from './errors';
import type { ServerConfig } from './config';
export type FetchPort=(url:string,init:RequestInit)=>Promise<Response>;
export interface UserContext { id:string; token:string; }
export interface AuthSession {user:UserContext;refreshToken?:string;expiresIn:number;}
const authCodes=new Set(['invalid_credentials','email_not_confirmed','email_provider_disabled','provider_disabled','signup_disabled','captcha_failed','refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','bad_jwt','user_not_found','user_banned','over_request_rate_limit','over_email_send_rate_limit','unexpected_failure','weak_password','email_address_invalid','email_address_not_authorized','user_already_exists','email_exists']);
export class SupabaseGateway {
 constructor(readonly config:ServerConfig,private transport:FetchPort=fetch){}
 private configured(){if(!this.config.supabaseUrl||!this.config.publishableKey)throw new AppError('configuration_required',503);}
 async request(path:string,init:RequestInit={},token?:string,control=false):Promise<unknown>{
  this.configured();if(!/^\/(rest|auth|storage)\/v1\//.test(path)||path.includes('..'))throw new AppError('invalid_input');
  const key=control?this.config.serverKey:this.config.publishableKey;if(!key)throw new AppError('configuration_required',503);
  const headers=new Headers(init.headers);headers.set('apikey',key);const bearer=control?(key.startsWith('sb_')?null:key):token??(key.startsWith('sb_')?null:key);if(bearer)headers.set('Authorization',`Bearer ${bearer}`);headers.set('Accept','application/json');
  if(init.body && typeof init.body==='string')headers.set('Content-Type','application/json');
  const auth=path.startsWith('/auth/v1/');
  let response:Response;try{response=await this.transport(this.config.supabaseUrl+path,{...init,headers,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new AppError(auth?'auth_unavailable':'database_unavailable',503,{stage:auth?'auth':'database'});}
  if(!response.ok){let message='';let code='';try{const body=record(await response.json());message=String(body.message??body.error??'');code=String(body.error_code??body.code??'');}catch{}
   if(auth){
    const diagnostic:SafeDiagnostic={stage:'auth',upstream_status:response.status,...(authCodes.has(code)?{upstream_code:code}:{})};
    if(code==='over_email_send_rate_limit'||response.status===429&&/^\/auth\/v1\/(signup|resend)(\?|$)/.test(path))throw new AppError('email_rate_limited',429,diagnostic);
     if(response.status===429)throw new AppError('rate_limited',429,diagnostic);
     if(code==='signup_disabled')throw new AppError('signup_disabled',403,diagnostic);
     if(code==='weak_password')throw new AppError('weak_password',422,diagnostic);
     if(code==='email_address_invalid')throw new AppError('email_invalid',422,diagnostic);
     if(code==='email_address_not_authorized')throw new AppError('email_delivery_restricted',403,diagnostic);
     if(['user_already_exists','email_exists'].includes(code))throw new AppError('account_exists',409,diagnostic);
    if(code==='invalid_credentials')throw new AppError('invalid_credentials',401,diagnostic);
    if(code==='email_not_confirmed')throw new AppError('email_not_confirmed',403,diagnostic);
    if(['email_provider_disabled','provider_disabled'].includes(code))throw new AppError('auth_method_disabled',403,diagnostic);
    if(code==='captcha_failed')throw new AppError('auth_captcha_required',403,diagnostic);
    if(['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','bad_jwt','user_not_found','user_banned'].includes(code))throw new AppError('session_expired',401,diagnostic);
    if(response.status>=500)throw new AppError('auth_unavailable',503,diagnostic);
    if(path==='/auth/v1/user'&&response.status===401)throw new AppError('session_expired',401,diagnostic);
    throw new AppError('auth_failed',response.status===401?401:400,diagnostic);
   }
   if(message.includes('stale_revision'))throw new AppError('stale_revision',409);
   if(message.includes('budget_exceeded'))throw new AppError('budget_exceeded',409);
   if(message.includes('approval_required'))throw new AppError('approval_required',403);
   if(code==='23505'||message.includes('conflict')||response.status===409)throw new AppError('conflict',409);
   // Auth has already been checked separately. A Data API/key/RLS failure is not a failed login.
   if(response.status===401)throw new AppError('database_unavailable',503,{stage:'database',upstream_status:401});
   if(response.status===403||code==='42501'||message.includes('unauthorized'))throw new AppError('unauthorized_target',403,{stage:'database',upstream_status:response.status});
   if(response.status===429)throw new AppError('rate_limited',429);
   if(code.startsWith('22')||code.startsWith('23')||message.includes('invalid_input'))throw new AppError('invalid_input');
   throw new AppError('database_unavailable',503,{stage:'database',upstream_status:response.status});
  }
  if(response.status===204)return null;
  const mime=response.headers.get('content-type')??'';if(!mime.includes('json'))return response;
  try{return await response.json();}catch{throw new AppError(auth?'auth_unavailable':'database_unavailable',503,{stage:auth?'auth':'database'});}
 }
 async authenticate(token:string):Promise<UserContext>{if(!token||token.length>20000)throw new AppError('unauthorized',401);const user=record(await this.request('/auth/v1/user',{},token));return{id:uuid(user.id),token};}
 private async authSession(value:unknown):Promise<AuthSession>{const s=record(value),token=text(s.access_token,20000);return{user:await this.authenticate(token),...(typeof s.refresh_token==='string'?{refreshToken:text(s.refresh_token,20000)}:{}),expiresIn:typeof s.expires_in==='number'&&Number.isFinite(s.expires_in)?Math.max(1,Math.min(s.expires_in,3600)):3600};}
 async login(email:string,password:string){text(email,320);text(password,512);email=email.trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError('invalid_input');return this.authSession(await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})}));}
 private signupEmail(email:string){email=text(email,320).trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError('email_invalid');return email;}
 private async confirmationEnabled(){const settings=await this.authSettings();if(settings.email_password_enabled===false)throw new AppError('auth_method_disabled',403);if(settings.email_confirmation_required!==true)throw new AppError('auth_confirmation_required',503);}
 async signup(email:string,password:string){
  email=this.signupEmail(email);text(password,512);await this.confirmationEnabled();
  // Only the validated local origin is eligible. Client redirects and admin keys are never used.
  await this.request(`/auth/v1/signup?redirect_to=${encodeURIComponent(this.config.origin+'/')}`,{method:'POST',body:JSON.stringify({email,password})});
  // Never expose or install the upstream user/session, including an unexpected autoconfirm response.
  return{accepted:true as const,confirmation_required:true as const};
 }
 async resendConfirmation(email:string){
  email=this.signupEmail(email);await this.confirmationEnabled();
  await this.request(`/auth/v1/resend?redirect_to=${encodeURIComponent(this.config.origin+'/')}`,{method:'POST',body:JSON.stringify({type:'signup',email})});
  return{accepted:true as const,confirmation_required:true as const};
 }
 async refresh(refreshToken:string){return this.authSession(await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:text(refreshToken,20000)})}));}
 async logout(user:UserContext){await this.request('/auth/v1/logout?scope=local',{method:'POST'},user.token);}
 async authSettings(){const settings=record(await this.request('/auth/v1/settings')),external=settings.external&&typeof settings.external==='object'?record(settings.external):{};return{email_password_enabled:typeof external.email==='boolean'?external.email:null,email_confirmation_required:typeof settings.mailer_autoconfirm==='boolean'?!settings.mailer_autoconfirm:null};}
 async rpc(user:UserContext,name:string,args:Record<string,unknown>){if(!/^sc_[a-z_]+$/.test(name))throw new AppError('invalid_input');return this.request(`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(args)},user.token);}
 async rows(user:UserContext,table:string,query='select=*'){if(!/^sc_[a-z_]+$/.test(table))throw new AppError('invalid_input');const result=await this.request(`/rest/v1/${table}?${query}`,{},user.token);if(!Array.isArray(result))throw new AppError('database_unavailable',503);return result.map(record);}
 async one(user:UserContext,table:string,id:string){const rows=await this.rows(user,table,`id=eq.${uuid(id)}&select=*`);if(!rows.length)throw new AppError('unauthorized_target',404);return rows[0];}
 /** Restricted server key surface. No general CRUD, SQL, or caller-selected endpoint. */
 async control(name:string,args:Record<string,unknown>){const allow=['sc_sync_execution_approval','sc_finalize_asset','sc_prepare_generated_asset','sc_reserve_job','sc_update_job','sc_settle_job','sc_issue_realtime_lease','sc_record_tool_call'];if(!allow.includes(name))throw new AppError('invalid_input');return this.request(`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(args)},undefined,true);}
}

interface BrowserSession {auth:AuthSession;expiresAt:number;absoluteEnd:number;pending?:Promise<UserContext>;}
/** Single local BFF process. Tokens stay in memory; the browser holds only a random HttpOnly handle.
 * Browser reloads retain this session. API process restart deliberately requires a new sign-in. */
export class BrowserSessions {
 private entries=new Map<string,BrowserSession>();
 constructor(private gateway:SupabaseGateway,private now:()=>number=Date.now){}
 async open(email:string,password:string){
  for(const[id,s]of this.entries)if(s.absoluteEnd<=this.now())this.entries.delete(id);
  if(this.entries.size>=256)throw new AppError('rate_limited',429);
  const auth=await this.gateway.login(email,password),id=randomBytes(32).toString('base64url');
  const maxAge=auth.refreshToken?7*24*3600:auth.expiresIn;
  this.entries.set(id,{auth,expiresAt:this.now()+auth.expiresIn*1000,absoluteEnd:this.now()+maxAge*1000});
  return{id,maxAge,userId:auth.user.id};
 }
 async resolve(id:string):Promise<UserContext>{
  const session=this.entries.get(id);
  if(!session||session.absoluteEnd<=this.now()){this.entries.delete(id);throw new AppError(id?'session_expired':'unauthorized',401,{stage:'auth'});}
  if(session.pending)return session.pending;
  const refresh=async()=>{
   if(!session.auth.refreshToken)throw new AppError('session_expired',401,{stage:'auth'});
   const next=await this.gateway.refresh(session.auth.refreshToken);
   if(next.user.id!==session.auth.user.id)throw new AppError('session_expired',401,{stage:'auth'});
   session.auth=next;session.expiresAt=this.now()+next.expiresIn*1000;
   return next.user;
  };
  const pending=(async()=>{
   let user:UserContext;
   try{
    if(session.expiresAt-this.now()<=30000)user=await refresh();
    else try{user=await this.gateway.authenticate(session.auth.user.token);}catch(e){if(e instanceof AppError&&e.code==='session_expired')user=await refresh();else throw e;}
    if(user.id!==session.auth.user.id||this.entries.get(id)!==session)throw new AppError('session_expired',401,{stage:'auth'});
    return user;
   }catch(e){if(e instanceof AppError&&['session_expired','unauthorized'].includes(e.code))this.entries.delete(id);throw e;}
  })();
  session.pending=pending;
  try{return await pending;}finally{if(session.pending===pending)session.pending=undefined;}
 }
 async close(id:string):Promise<'confirmed'|'unconfirmed'|'not_needed'>{
  const session=this.entries.get(id);this.entries.delete(id);if(!session)return'not_needed';
  // Remove locally before awaiting a refresh so an in-flight request cannot re-open this session.
  if(session.pending)try{await session.pending;}catch{}
  try{await this.gateway.logout(session.auth.user);return'confirmed';}catch(e){return e instanceof AppError&&e.code==='session_expired'?'confirmed':'unconfirmed';}
 }
}
