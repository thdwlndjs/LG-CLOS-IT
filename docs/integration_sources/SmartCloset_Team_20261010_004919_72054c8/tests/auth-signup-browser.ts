// Browser-only injected fixtures. No account creation, email, real credentials, or external API calls.
import {chromium,type Page} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createSeed} from '../src/core/seed';
const origin='http://127.0.0.1:4311',output='evidence/home-resume-20261008/auth';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--no-first-run']});
const userId='fixture-signup-user',email='fixture@example.invalid',password='fixture-only-password';
const checks:string[]=[],pageErrors:string[]=[],external:string[]=[];
let totalSignup=0,totalResend=0,totalLogin=0;
const account=(page:Page)=>page.locator('.backend-panel').filter({has:page.getByRole('heading',{name:'내 계정',exact:true})});
const message=(page:Page,part:string)=>account(page).getByRole('status').filter({hasText:part}).waitFor();
async function scenario(run:(page:Page,state:{signedIn:boolean;signupError?:{code:string;message:string;status:number};confirmation:boolean;requests:string[]})=>Promise<void>,hash=''){
 const state={signedIn:false,signupError:undefined as {code:string;message:string;status:number}|undefined,confirmation:true,requests:[] as string[]};
 const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'ko-KR',serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);await route.abort();return;}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const path=url.pathname,method=route.request().method();state.requests.push(`${method} ${path}`);
  const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(path==='/api/config')return json({project_ref:'fixture-project',database_configured:true,ai_mode:'mock',live_enabled:false,key_present:{supabase_publishable:true,supabase_server:false,openai:false,decart:false}});
  if(path==='/api/auth-status')return json({email_password_enabled:true,email_confirmation_required:state.confirmation});
  if(path==='/api/session'){
   if(method==='POST'){totalLogin++;state.signedIn=true;return json({authenticated:true,user_id:userId});}
   if(state.signedIn)return json({authenticated:true,user_id:userId});
   return json({error:{code:'unauthorized',message:'앱에 등록된 이메일로 로그인해 주세요.'}},401);
  }
  if(path==='/api/signup'||path==='/api/signup/resend'){
   assert.equal(method,'POST');if(path==='/api/signup'){totalSignup++;assert.deepEqual(route.request().postDataJSON(),{email,password});}else{totalResend++;assert.deepEqual(route.request().postDataJSON(),{email});}
   await new Promise(resolve=>setTimeout(resolve,100));
   if(state.signupError)return json({error:{code:state.signupError.code,message:state.signupError.message}},state.signupError.status);
   return json({accepted:true,confirmation_required:true});
  }
  if(path==='/api/state'){const seed=JSON.parse(JSON.stringify(createSeed()).replaceAll('demo-profile',userId));return json(seed);}
  throw Error('Unexpected local API fixture route');
 });
 const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));page.setDefaultTimeout(12000);
 try{await page.goto(origin+'/'+hash,{waitUntil:'networkidle'});if(!hash)await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'마이',exact:true}).click();await account(page).waitFor();await run(page,state);}finally{await context.close();}
}
async function fillSignup(page:Page){await page.getByRole('button',{name:'이메일로 새 계정 만들기',exact:true}).click();await page.getByLabel('앱 계정 이메일',{exact:true}).fill(email);await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByLabel('비밀번호 다시 입력',{exact:true}).fill(password);}
try{
 await fs.mkdir(output,{recursive:true});
 await scenario(async(page,state)=>{
  await message(page,'앱에 등록된 이메일');assert.equal(totalSignup,0);assert.equal(totalResend,0);assert.equal(totalLogin,0);
  await fillSignup(page);assert.equal(totalSignup,0);assert.equal(await page.getByLabel('비밀번호',{exact:true}).getAttribute('autocomplete'),'new-password');
  await page.getByLabel('비밀번호 다시 입력',{exact:true}).fill('different-fixture-password');await page.getByRole('button',{name:'가입하고 확인 메일 요청',exact:true}).click();await message(page,'두 비밀번호가 같지');assert.equal(totalSignup,0);
  await page.getByLabel('비밀번호 다시 입력',{exact:true}).fill(password);await page.screenshot({path:output+'/signup-form-fixture.png'});
  await page.getByRole('button',{name:'가입하고 확인 메일 요청',exact:true}).evaluate(button=>{const form=button.closest('form')!;form.requestSubmit();form.requestSubmit();});
  await message(page,'가입 요청을 접수');assert.equal(totalSignup,1);assert.equal(totalLogin,0);assert.equal(await page.getByLabel('비밀번호',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:'확인 메일 다시 요청',exact:true}).isDisabled(),true);assert.equal(state.requests.includes('GET /api/state'),false);
  await page.screenshot({path:output+'/signup-accepted-fixture.png'});checks.push('explicit signup only; matching passwords required; duplicate submit suppressed; password cleared; mail cooldown; no automatic login or DB load');
 });
 await scenario(async(page,state)=>{
  await page.getByLabel('앱 계정 이메일',{exact:true}).fill(email);await page.getByRole('button',{name:'확인 메일 다시 요청',exact:true}).click();await message(page,'재전송 요청을 접수');assert.equal(totalResend,1);assert.equal(totalSignup,1);assert.equal(totalLogin,0);assert.equal(state.requests.includes('GET /api/state'),false);await page.screenshot({path:output+'/resend-accepted-fixture.png'});checks.push('explicit signup confirmation resend uses email only and stays signed out');
 });
 for(const error of[{code:'email_delivery_restricted',message:'프로젝트 기본 메일은 허용된 팀원 주소로만 보낼 수 있어요.',status:403},{code:'email_rate_limited',message:'확인 메일 발송 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.',status:429},{code:'weak_password',message:'비밀번호가 프로젝트의 보안 조건을 충족하지 않아요.',status:422}]){
  await scenario(async(page,state)=>{state.signupError=error;await fillSignup(page);await page.getByRole('button',{name:'가입하고 확인 메일 요청',exact:true}).click();await message(page,error.message);assert.equal(await page.getByLabel('비밀번호',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('비밀번호 다시 입력',{exact:true}).inputValue(),'');assert.equal(state.requests.includes('GET /api/state'),false);if(error.code==='email_rate_limited')assert.equal(await page.getByRole('button',{name:'확인 메일 다시 요청',exact:true}).isDisabled(),true);checks.push(error.code+' is visible and clears both password inputs without login');});
 }
 await scenario(async(page,state)=>{
  await message(page,'메일 링크에서 돌아왔어요');assert.equal(page.url(),origin+'/');assert.equal(totalLogin,0);assert.equal(state.requests.some(r=>r.startsWith('POST ')),false);
  const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert.equal(storage.includes('synthetic-return-marker'),false);assert.equal((await page.locator('body').innerText()).includes('synthetic-return-marker'),false);
  await page.getByLabel('앱 계정 이메일',{exact:true}).fill(email);await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'내 계정으로 로그인',exact:true}).click();await page.locator('.demo-footer').filter({hasText:'Supabase 연결'}).waitFor();await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'마이',exact:true}).click();await message(page,'불러왔어요');assert.equal(totalLogin,1);assert.equal(await page.getByRole('button',{name:'이메일로 새 계정 만들기',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'확인 메일 다시 요청',exact:true}).count(),0);
  await page.reload({waitUntil:'networkidle'});await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'마이',exact:true}).click();await message(page,'불러왔어요');assert.equal(totalLogin,1);checks.push('return fragment removed without storing or displaying it; manual login only; signed-in UI hides signup and resend; reload keeps existing session');
 },'#access_token=synthetic-return-marker&refresh_token=synthetic-return-marker&type=signup');
 await scenario(async(page,state)=>{state.confirmation=false;await page.reload({waitUntil:'networkidle'});await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'마이',exact:true}).click();await fillSignup(page);assert.equal(await page.getByRole('button',{name:'가입하고 확인 메일 요청',exact:true}).isDisabled(),true);assert.equal(state.requests.some(r=>r==='POST /api/signup'),false);checks.push('confirmation disabled prevents signup in UI');});
 assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
 const result={kind:'signup and email confirmation browser fixtures; no real account or email',pass:true,checks,signupRequests:totalSignup,resendRequests:totalResend,loginRequests:totalLogin,externalRequests:external.length,pageErrors:pageErrors.length};await fs.writeFile(output+'/signup-browser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}