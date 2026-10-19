import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {DemoApp} from './core/app';
import {BackendError,HttpRemoteBackend,onBackendSessionExpired,type BackendMode} from './integrations/backendClient';

const client=new HttpRemoteBackend();
const emailReturnMessage='메일 링크에서 돌아왔어요. 이메일 확인을 마친 뒤 같은 이메일과 비밀번호로 로그인해 주세요. 링크가 만료됐다면 확인 메일을 다시 요청해 주세요.';
type ConnectionPhase='checking'|'signed_out'|'authenticated'|'connected'|'auth_error'|'database_error'|'configuration_error';
type SessionView={phase:ConnectionPhase;message:string;userId?:string;busy?:boolean;diagnostic?:BackendError;config?:Awaited<ReturnType<HttpRemoteBackend['config']>>;authSettings?:Awaited<ReturnType<HttpRemoteBackend['authStatus']>>};
let sessionView:SessionView={phase:'checking',message:'기존 로그인을 확인하고 있어요.'};
const subscribers=new Set<()=>void>();
const subscribe=(fn:()=>void)=>{subscribers.add(fn);return()=>{subscribers.delete(fn);};};
const getSnapshot=()=>sessionView;
function update(next:Partial<SessionView>){sessionView={...sessionView,diagnostic:undefined,...next};for(const fn of subscribers)fn();}
const init=new WeakMap<DemoApp,Promise<void>>();
let generation=0;
function describe(error:unknown,authenticated=false){
 const e=error instanceof BackendError?error:undefined;
 if(authenticated&&!(e&&['unauthorized','session_expired'].includes(e.code)))update({phase:'database_error',message:`로그인은 확인됐지만 내 옷장 데이터를 불러오지 못했어요. ${e?.message??'다시 조회해 주세요.'}`,diagnostic:e});
 else update({phase:e?.code==='configuration_required'?'configuration_error':'auth_error',message:e?.message??'연결을 확인하지 못했어요.',diagnostic:e});
}
async function connect(app:DemoApp,userId:string,current=++generation){
 if(current!==generation)return;
 if(sessionView.userId&&sessionView.userId!==userId)await app.configureRemote();
 client.bindSession(userId);update({phase:'authenticated',userId,message:'로그인을 확인했어요. 내 옷장을 불러오고 있어요.'});
 try{await app.configureRemote(client);if(current===generation)update({phase:'connected',message:'내 계정의 옷장을 불러왔어요.'});}catch(e){if(current===generation)describe(e,true);}
}
/** Render once beside the main app. Mounting account/tools panels never submits a login. */
export function BackendSessionBootstrap({app}:{app:DemoApp}){
 useEffect(()=>{
  if(!init.has(app)){
   // Discard the whole return fragment without parsing, logging or saving any token it may contain.
   const emailReturn=!!window.location.hash;if(emailReturn){window.history.replaceState(null,'',window.location.pathname);app.setScreen('my');}
   const current=++generation;
   init.set(app,(async()=>{
    try{
     const config=await client.config();if(current!==generation)return;update({config});
     if(!config.database_configured){update({phase:'configuration_error',message:'서버의 Supabase 연결 설정이 필요해요.'});return;}
     void client.authStatus().then(authSettings=>{if(current===generation)update({authSettings});}).catch(()=>{});
     const session=await client.session();if(current!==generation)return;
     if(session.authenticated)await connect(app,session.user_id,current);else update({phase:'signed_out',userId:undefined,message:emailReturn?emailReturnMessage:'앱에 등록된 이메일로 로그인해 주세요.'});
    }catch(e){if(current!==generation)return;if(e instanceof BackendError&&['unauthorized','session_expired'].includes(e.code))update({phase:'signed_out',message:emailReturn?emailReturnMessage:e.code==='session_expired'?e.message:'앱에 등록된 이메일로 로그인해 주세요.'});else describe(e);}
   })());
  }
  const unsubscribe=onBackendSessionExpired(()=>{if(!['connected','authenticated','database_error'].includes(sessionView.phase))return;generation++;client.bindSession();void app.configureRemote();update({phase:'auth_error',userId:undefined,message:'로그인 세션이 종료됐어요. 다시 로그인해 주세요. 로컬 시연 데이터는 보존됐어요.'});});
  let validating=false;
  const validate=()=>{if(validating||sessionView.busy||!['connected','authenticated','database_error'].includes(sessionView.phase))return;const current=generation;validating=true;void client.session().then(async session=>{if(current!==generation)return;if(session.user_id!==sessionView.userId)await connect(app,session.user_id,++generation);}).catch(e=>{if(current===generation&&!(e instanceof BackendError&&['unauthorized','session_expired'].includes(e.code)))update({message:e instanceof Error?e.message:'인증 연결을 확인하지 못했어요.'});}).finally(()=>{validating=false;});};
  const timer=setInterval(validate,60000);window.addEventListener('focus',validate);
  return()=>{clearInterval(timer);window.removeEventListener('focus',validate);unsubscribe();};
 },[app]);
 return null;
}

export function BackendPanel({app,placement='account'}:{app:DemoApp;placement?:'account'|'tools'}){
 const session=useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[passwordConfirm,setPasswordConfirm]=useState('');const [accountMode,setAccountMode]=useState<'login'|'signup'>('login'),[mailCooldown,setMailCooldown]=useState(false);const busy=!!session.busy;
 const busyRef=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!mailCooldown)return;const timer=setTimeout(()=>setMailCooldown(false),60000);return()=>clearTimeout(timer);},[mailCooldown]);
 const execute=async(fn:()=>Promise<void>)=>{if(busyRef.current||sessionView.busy)return;busyRef.current=true;update({busy:true});try{await fn();}catch(e){if(e instanceof BackendError&&e.code==='email_rate_limited')setMailCooldown(true);describe(e,sessionView.phase==='connected'||sessionView.phase==='authenticated'||sessionView.phase==='database_error');}finally{busyRef.current=false;update({busy:false,diagnostic:sessionView.diagnostic});}};
 const disconnect=async()=>{
  ++generation;client.bindSession();await app.configureRemote();update({phase:'signed_out',userId:undefined,message:'원격 화면을 닫았어요. 로그아웃을 확인하고 있어요.'});
  try{const result=await client.logout();update({phase:'signed_out',message:result.revocation==='unconfirmed'?'이 브라우저의 연결은 종료했어요. 인증 서버의 세션 폐기는 확인하지 못했어요.':'로그아웃했어요. 보존된 로컬 시연 데이터로 돌아왔어요.'});}
  catch(e){await app.configureRemote();update({phase:'auth_error',message:'로컬 시연으로 전환했어요. 앱 서버에 닿지 않아 기존 로그아웃은 확인하지 못했어요. 연결이 복구되면 로그아웃을 다시 확인해 주세요.',diagnostic:e instanceof BackendError?e:undefined});}
 };
 const signedIn=['connected','authenticated','database_error'].includes(session.phase);
 if(placement==='tools')return<section className="backend-panel"><h3>서버·실행 상태</h3><p>저장: {app.connection.kind==='supabase'?'Supabase 인증 연결':'브라우저 시연'} · 처리: {app.connection.mode}</p><label>AI 처리 방식<select value={app.connection.mode} disabled={app.connection.kind!=='supabase'||!signedIn} onChange={e=>{client.mode=e.target.value as BackendMode;app.setBackendMode(client.mode);}}><option value="mock">준비 예시</option><option value="saved_result">저장된 실제 결과 재조회</option><option value="live">실제 실행 · 승인 조건 검사</option></select></label><p>live {session.config?.live_enabled?'서버 게이트 활성':'꺼짐'} · 설정 유무: {session.config?Object.entries(session.config.key_present).map(([k,v])=>`${k} ${v?'설정됨':'없음'}`).join(' / '):'미확인'}</p><p>키가 있어도 비용·자산 승인과 실행 상한을 통과해야 호출합니다.</p><p>연결 대상: {session.config?.project_ref??'확인 중'}</p>{session.diagnostic&&<p>단계 {session.diagnostic.diagnostic?.stage??'앱 서버'} · 코드 {session.diagnostic.code}{session.diagnostic.diagnostic?.upstream_status?` · Auth/DB 응답 ${session.diagnostic.diagnostic.upstream_status}`:''}{session.diagnostic.diagnostic?.upstream_code?` · ${session.diagnostic.diagnostic.upstream_code}`:''}</p>}</section>;
 return<section className="backend-panel"><h3>내 계정</h3><p>{session.phase==='connected'?'내 계정의 옷장에 저장하고 있어요.':signedIn?'로그인은 확인됐어요. 옷장 연결 상태를 확인해 주세요.':'로그인하면 내 옷장과 기록을 불러올 수 있어요.'}</p>
  {signedIn?<><button disabled={busy} onClick={()=>void execute(async()=>{const current=++generation;const session=await client.session();if(current!==generation)return;if(app.connection.kind==='supabase'&&session.user_id===sessionView.userId){await app.reloadRemote();if(current===generation)update({phase:'connected',message:'내 옷장의 저장 결과를 다시 불러왔어요.'});}else await connect(app,session.user_id,current);})}>내 옷장 다시 불러오기</button><button disabled={busy} onClick={()=>void execute(disconnect)}>로그아웃 · 로컬 시연으로</button></>:<>
   <div className="actions"><button type="button" aria-pressed={accountMode==='login'} disabled={busy} onClick={()=>{setAccountMode('login');setPassword('');setPasswordConfirm('');}}>로그인</button><button type="button" aria-pressed={accountMode==='signup'} disabled={busy} onClick={()=>{setAccountMode('signup');setPassword('');setPasswordConfirm('');}}>이메일로 새 계정 만들기</button></div>
   <form onSubmit={e=>{e.preventDefault();if(accountMode==='signup'&&password!==passwordConfirm){update({message:'두 비밀번호가 같지 않아요. 다시 확인해 주세요.'});return;}void execute(async()=>{
    const current=++generation;
    if(accountMode==='signup'){
     if(mailCooldown)return;
     try{await client.signup(email,password);if(current===generation){setMailCooldown(true);setAccountMode('login');update({phase:'signed_out',userId:undefined,message:'가입 요청을 접수했어요. 받은편지함·스팸함의 확인 메일에서 링크를 누른 뒤 같은 이메일과 비밀번호로 로그인해 주세요. 이미 가입한 이메일이라면 기존 계정으로 로그인해 주세요.'});}}
     finally{if(mounted.current){setPassword('');setPasswordConfirm('');}}
    }else{let nextSession;try{nextSession=await client.login(email,password);}finally{if(mounted.current){setPassword('');setPasswordConfirm('');}}if(current===generation)await connect(app,nextSession.user_id,current);}
   });}}>
    <label>앱 계정 이메일<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={320} disabled={busy}/></label>
    <label>비밀번호<input type="password" autoComplete={accountMode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} required maxLength={512} disabled={busy}/></label>
    {accountMode==='signup'&&<><label>비밀번호 다시 입력<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={e=>setPasswordConfirm(e.target.value)} required maxLength={512} disabled={busy}/></label><p>메일을 받을 수 있는 주소와 다른 곳에서 쓰지 않은 비밀번호를 입력해 주세요. 가입 후 이메일 확인이 필요해요.</p></>}
    <button type="submit" disabled={busy||session.phase==='checking'||!session.config?.database_configured||session.authSettings?.email_password_enabled===false||accountMode==='signup'&&(mailCooldown||session.authSettings?.email_confirmation_required!==true)}>{busy?'요청 확인 중':accountMode==='signup'?'가입하고 확인 메일 요청':'내 계정으로 로그인'}</button>
   </form>
   <p>앱 계정은 Supabase 대시보드 관리자 계정과 별개예요. 처음이면 이메일로 새 계정을 만들고, 확인 메일의 링크를 누른 뒤 로그인해 주세요.</p>
   {session.authSettings?.email_password_enabled===false&&<p>프로젝트의 이메일 로그인이 꺼져 있어요. 관리자 확인이 필요해요.</p>}
   {accountMode==='signup'&&session.authSettings?.email_confirmation_required!==true&&<p>가입에는 이메일 확인이 필요해요. 이메일 확인 설정을 불러오지 못했거나 꺼져 있으면 프로젝트 관리자가 설정을 확인해 주세요.</p>}
   <button type="button" disabled={busy||mailCooldown||session.phase==='checking'||!email.trim()||!session.config?.database_configured||session.authSettings?.email_confirmation_required!==true} onClick={()=>void execute(async()=>{const current=++generation;await client.resendConfirmation(email);if(current===generation){setMailCooldown(true);update({phase:'signed_out',userId:undefined,message:'확인 메일 재전송 요청을 접수했어요. 아직 확인하지 않은 가입 주소라면 받은편지함·스팸함을 확인해 주세요. 이미 확인했다면 바로 로그인할 수 있어요.'});}})}>확인 메일 다시 요청</button>
   {mailCooldown&&<p>메일을 확인해 주세요. 추가 요청은 잠시 뒤 가능하며, 프로젝트의 시간당 발송 한도도 적용돼요.</p>}
   <button disabled={busy||!session.config?.database_configured} onClick={()=>void execute(async()=>{const current=++generation;const session=await client.session();if(current===generation)await connect(app,session.user_id,current);})}>기존 로그인 다시 확인</button>
   <button disabled={busy} onClick={()=>void execute(disconnect)}>로컬 시연 사용</button>
  </>}
  <p role="status">{session.message}</p>{app.connection.kind==='local'&&<p>로컬 시연은 이 브라우저에 저장돼요. Supabase 저장과 별도로 유지돼요.</p>}
 </section>;
}

/** Compact customer account flow. The developer panel and all backend contracts stay unchanged. */
export function MirrorAccountPanel({app}:{app:DemoApp}){
 const session=useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
 const [mode,setMode]=useState<'login'|'signup'>('login'),[step,setStep]=useState<'email'|'password'|'confirm'|'help'>('email');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[note,setNote]=useState(''),[mailCooldown,setMailCooldown]=useState(false);
 const busyRef=useRef(false),mounted=useRef(true),busy=!!session.busy;
 const signedIn=['connected','authenticated','database_error'].includes(session.phase),configured=!!session.config?.database_configured;
 const canAuthenticate=configured&&session.phase!=='checking'&&session.authSettings?.email_password_enabled!==false;
 const canSignup=canAuthenticate&&session.authSettings?.email_confirmation_required===true&&!mailCooldown;
 const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
 const clearPasswords=()=>{setPassword('');setConfirmation('');};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!mailCooldown)return;const timer=setTimeout(()=>setMailCooldown(false),60000);return()=>clearTimeout(timer);},[mailCooldown]);
 useEffect(()=>{if(signedIn){clearPasswords();setStep('email');setNote('');}},[signedIn,session.userId]);
 const customerError=(error:unknown)=>{
  switch(error instanceof BackendError?error.code:''){
   case'invalid_credentials':return'이메일과 비밀번호를 다시 확인해 주세요.';
   case'email_not_confirmed':return'받은 메일에서 이메일을 확인한 뒤 로그인해 주세요.';
   case'email_rate_limited':return'메일 요청이 많아요. 잠시 뒤 다시 시도해 주세요.';
   case'email_delivery_restricted':return'확인 메일을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.';
   case'weak_password':return'더 안전한 비밀번호로 다시 입력해 주세요.';
   case'configuration_required':return'계정 연결 준비가 필요해요. 로컬 기록은 보존돼요.';
   case'session_expired':return'로그인이 만료됐어요. 다시 로그인해 주세요.';
   case'unauthorized':return'로그인 정보를 다시 확인해 주세요.';
   default:return'계정 연결을 확인하지 못했어요. 다시 시도해 주세요.';
  }
 };
 const execute=async(action:()=>Promise<void>)=>{
  if(busyRef.current||sessionView.busy)return;busyRef.current=true;update({busy:true});setNote('');
  try{await action();}
  catch(error){if(error instanceof BackendError&&error.code==='email_rate_limited'&&mounted.current)setMailCooldown(true);describe(error,['connected','authenticated','database_error'].includes(sessionView.phase));if(mounted.current)setNote(customerError(error));}
  finally{busyRef.current=false;update({busy:false,diagnostic:sessionView.diagnostic});}
 };
 const enter=()=>{
  if(!canAuthenticate||!validEmail||!password||(mode==='signup'&&!canSignup))return;
  if(mode==='signup'&&password!==confirmation){setNote('두 비밀번호가 같지 않아요. 다시 확인해 주세요.');return;}
  void execute(async()=>{
   const current=++generation;
   if(mode==='signup'){
    try{await client.signup(email.trim(),password);if(current===generation){update({phase:'signed_out',userId:undefined,message:'가입 요청을 접수했어요. 확인 메일에서 링크를 누른 뒤 로그인해 주세요.'});if(mounted.current){setMailCooldown(true);setMode('login');setStep('help');setNote('확인 메일의 링크를 누른 뒤 로그인해 주세요. 기존 계정도 같은 방법으로 로그인해요.');}}}
    finally{if(mounted.current)clearPasswords();}
   }else{
    let next;try{next=await client.login(email.trim(),password);}finally{if(mounted.current)clearPasswords();}
    if(current===generation)await connect(app,next.user_id,current);
   }
  });
 };
 const restore=()=>void execute(async()=>{
  const current=++generation,next=await client.session();if(current!==generation)return;
  if(!next.authenticated||!next.user_id){update({phase:'signed_out',userId:undefined,message:'로그인할 계정을 입력해 주세요.'});if(mounted.current){setStep('email');setNote('로그인할 계정을 입력해 주세요.');}return;}
  if(app.connection.kind==='supabase'&&next.user_id===sessionView.userId){await app.reloadRemote();if(current===generation)update({phase:'connected',message:'내 옷장을 다시 불러왔어요.'});}
  else await connect(app,next.user_id,current);
 });
 const resend=()=>{if(!canSignup||!validEmail)return;void execute(async()=>{
  const current=++generation;await client.resendConfirmation(email.trim());if(current===generation){update({phase:'signed_out',userId:undefined,message:'확인 메일을 다시 요청했어요.'});if(mounted.current){setMailCooldown(true);setNote('확인 메일을 다시 요청했어요. 받은편지함과 스팸함을 확인해 주세요.');}}
 });};
 const disconnect=()=>void execute(async()=>{
  ++generation;client.bindSession();await app.configureRemote();update({phase:'signed_out',userId:undefined,message:'로컬 기록으로 돌아왔어요.'});if(mounted.current){clearPasswords();setStep('email');}
  try{const result=await client.logout();const message=result.revocation==='unconfirmed'?'이 브라우저의 연결은 종료했어요. 로그아웃 완료는 다시 확인해 주세요.':'로그아웃했어요. 로컬 기록은 보존돼요.';update({phase:'signed_out',message});if(mounted.current)setNote(message);}
  catch(error){await app.configureRemote();update({phase:'auth_error',message:'로컬 기록은 보존돼요. 로그아웃 완료는 다시 확인해 주세요.',diagnostic:error instanceof BackendError?error:undefined});if(mounted.current)setNote('로컬 기록은 보존돼요. 로그아웃 완료는 다시 확인해 주세요.');}
 });
 const switchMode=(next:'login'|'signup')=>{setMode(next);setStep('email');clearPasswords();setNote('');};
 const status=!configured&&session.phase!=='checking'?'계정 연결 준비가 필요해요. 로컬 기록은 보존돼요.':busy?'계정 연결을 확인하고 있어요.':note||
  (session.phase==='checking'?'계정 연결을 확인하고 있어요.':session.phase==='database_error'?'로그인은 확인했어요. 옷장을 다시 불러와 주세요.':session.phase==='connected'?'내 계정의 옷장에 연결됐어요.':session.phase==='authenticated'?'내 옷장을 불러오고 있어요.':session.authSettings?.email_password_enabled===false?'이메일 로그인을 지금 사용할 수 없어요.':session.phase==='auth_error'?customerError(session.diagnostic):session.message===emailReturnMessage?'메일 확인을 마쳤다면 같은 이메일로 로그인해 주세요.':'로그인하면 내 옷장과 기록을 불러와요.');
 if(!configured)return<section className="mirror-account-panel" data-account-step="unavailable"><h3>내 계정</h3><p role="status">{status}</p><button disabled>로그인</button></section>;
 return<section className="mirror-account-panel" data-account-step={signedIn?'connected':step}><h3>내 계정</h3>
  <p role="status">{status}</p>
  {signedIn?<div className="mirror-account-actions"><button disabled={busy} onClick={restore}>내 옷장 다시 불러오기</button><button disabled={busy} onClick={disconnect}>로그아웃</button></div>:<>
   {step==='email'&&<div className="mirror-account-modes"><button type="button" disabled={busy} aria-pressed={mode==='login'} onClick={()=>switchMode('login')}>로그인</button><button type="button" disabled={busy} aria-pressed={mode==='signup'} onClick={()=>switchMode('signup')}>새 계정</button></div>}
   <form onSubmit={event=>{event.preventDefault();if(busy)return;if(step==='email'){if(canAuthenticate&&validEmail&&(mode!=='signup'||canSignup)){setNote('');setStep('password');}}else if(step==='password'&&mode==='signup'){if(password){setConfirmation('');setStep('confirm');}}else if(step==='password'||step==='confirm')enter();}}>
    {(step==='email'||step==='help')&&<label>이메일<input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required maxLength={320} disabled={busy}/></label>}
    {step==='password'&&<><small>{email}</small><label>비밀번호<input autoFocus type="password" autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={event=>setPassword(event.target.value)} required maxLength={512} disabled={busy}/></label></>}
    {step==='confirm'&&<label>비밀번호 확인<input autoFocus type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} required maxLength={512} disabled={busy}/></label>}
    {step!=='help'&&<button type="submit" disabled={busy||!canAuthenticate||mode==='signup'&&!canSignup}>{busy?'확인 중':step==='email'||step==='password'&&mode==='signup'?'다음':mode==='signup'?'가입하고 메일 받기':'내 계정으로 로그인'}</button>}
   </form>
   {mode==='signup'&&step!=='help'&&<small>{session.authSettings?.email_confirmation_required!==true?'메일 확인 준비가 끝나면 가입할 수 있어요.':'가입 후 확인 메일의 링크를 눌러 주세요.'}</small>}
   {step==='help'?<div className="mirror-account-actions"><button type="button" disabled={busy||!canSignup||!validEmail} onClick={resend}>확인 메일 다시 요청</button><button type="button" disabled={busy||!canAuthenticate} onClick={restore}>기존 로그인 확인</button><button type="button" disabled={busy} onClick={()=>{setStep('email');setMode('login');clearPasswords();setNote('');}}>로그인으로 돌아가기</button></div>:<div className="mirror-account-actions">{step!=='email'&&<button type="button" disabled={busy} onClick={()=>{setStep(step==='confirm'?'password':'email');setConfirmation('');setNote('');}}>이전</button>}<button type="button" disabled={busy} onClick={()=>{setStep('help');clearPasswords();setNote('');}}>메일 확인·기존 로그인</button></div>}
   {mailCooldown&&<small>메일을 확인해 주세요. 추가 요청은 잠시 뒤 가능해요.</small>}
  </>}
 </section>;
}