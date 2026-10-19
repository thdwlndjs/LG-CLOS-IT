import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,type Page} from 'playwright';
import {createSeed} from '../src/core/seed';

// Every auth response is an injected local fixture. No real credentials/account/email/backend request.
const origin='http://127.0.0.1:4311',output=path.resolve('evidence/mirror-final-20261009');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--no-first-run']});
const checks:string[]=[],errors:string[]=[],external:string[]=[],unexpected:string[]=[];
const email='mirror-fixture@example.invalid',password='fixture-only-password',userId='mirror-fixture-user';
const fixtureHtml=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:12px;background:#eeede7;color:#26342b;font:14px sans-serif}#root{width:228px}input,button{box-sizing:border-box;width:100%;margin:5px 0;min-height:36px}label{display:block}button{cursor:pointer}.mirror-account-modes{display:flex;gap:6px}</style></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;const {MirrorAccountPanel,BackendSessionBootstrap}=await import('/src/BackendPanel.tsx');const {createDemoApp}=await import('/src/core/app.ts');const app=createDemoApp();createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(BackendSessionBootstrap,{app}),React.createElement(MirrorAccountPanel,{app})));</script></body></html>`;
type Fixture={configured:boolean;confirmation:boolean;signedIn:boolean;loginError:string|null;dbFails:boolean;posts:string[];calls:string[]};
async function scenario(name:string,run:(page:Page,f:Fixture)=>Promise<void>,initial:Partial<Fixture>={},hash=''){
 const f:Fixture={configured:true,confirmation:true,signedIn:false,loginError:null,dbFails:false,posts:[],calls:[],...initial};
 const context=await browser.newContext({viewport:{width:320,height:740},locale:'ko-KR',serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(url.origin!==origin){external.push(url.origin);return route.abort();}
  if(url.pathname==='/mirror-account-fixture')return route.fulfill({status:200,contentType:'text/html',body:fixtureHtml});
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const key=method+' '+url.pathname;f.calls.push(key);if(method==='POST'||method==='DELETE')f.posts.push(key);
  const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname==='/api/config')return json({project_ref:'fixture',database_configured:f.configured,ai_mode:'mock',live_enabled:false,key_present:{}});
  if(url.pathname==='/api/auth-status')return json({email_password_enabled:true,email_confirmation_required:f.confirmation});
  if(url.pathname==='/api/session'){
   if(method==='POST'){assert.deepEqual(request.postDataJSON(),{email,password});await new Promise(resolve=>setTimeout(resolve,80));if(f.loginError)return json({error:{code:f.loginError,message:'Supabase .env diagnostic detail must not reach customer UI',diagnostic:{stage:'auth',upstream_code:f.loginError}}},401);f.signedIn=true;}
   if(method==='DELETE'){f.signedIn=false;return json({authenticated:false,revocation:'confirmed'});}
   return json({authenticated:f.signedIn,...(f.signedIn?{user_id:userId}:{})});
  }
  if(url.pathname==='/api/signup'||url.pathname==='/api/signup/resend'){assert.equal(method,'POST');assert.deepEqual(request.postDataJSON(),url.pathname==='/api/signup'?{email,password}:{email});await new Promise(resolve=>setTimeout(resolve,80));return json({accepted:true,confirmation_required:true});}
  if(url.pathname==='/api/state'){if(f.dbFails)return json({error:{code:'database_unavailable',message:'Supabase .env fixture diagnostic'}},503);return json(JSON.parse(JSON.stringify(createSeed()).replaceAll('demo-profile',userId)));}
  unexpected.push(key);return route.abort();
 });
 await context.routeWebSocket('**/*',socket=>socket.close());
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(name+':'+error.message));
 try{await page.goto(origin+'/mirror-account-fixture'+hash,{waitUntil:'networkidle'});await page.locator('.mirror-account-panel').waitFor();await run(page,f);checks.push(name);console.log('PASS '+name);}catch(error){console.error(JSON.stringify({name,errors,body:await page.locator('body').innerText()}));throw error;}finally{await context.close();}
}
const status=(page:Page,text:string)=>page.getByRole('status').filter({hasText:text}).waitFor();
async function emailStep(page:Page){await page.getByLabel('이메일',{exact:true}).fill(email);assert.equal(await page.locator('input').count(),1);await page.getByRole('button',{name:'다음',exact:true}).click();}
async function login(page:Page){await emailStep(page);assert.equal(await page.getByLabel('이메일',{exact:true}).count(),0);assert.equal(await page.locator('input').count(),1);await page.getByLabel('비밀번호',{exact:true}).fill(password);}
async function signup(page:Page){await page.getByRole('button',{name:'새 계정',exact:true}).click();await emailStep(page);await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'다음',exact:true}).click();assert.equal(await page.locator('input').count(),1);assert.equal(await page.getByLabel('비밀번호',{exact:true}).count(),0);}
try{
 await fs.mkdir(output,{recursive:true});
 await scenario('unconfigured customer panel hides implementation details and cannot submit',async(page,f)=>{await status(page,'계정 연결 준비가 필요해요. 로컬 기록은 보존돼요.');assert.equal(await page.locator('input').count(),0);assert.equal(await page.getByRole('button',{name:'로그인',exact:true}).isDisabled(),true);assert.doesNotMatch(await page.locator('body').innerText(),/Supabase|\.env|관리자/);assert.deepEqual(f.posts,[]);await page.screenshot({path:path.join(output,'browser-account-unavailable.png')});},{configured:false});
 await scenario('login steps suppress duplicates, clear password, restore session and preserve logout',async(page,f)=>{
  f.loginError='invalid_credentials';await login(page);await page.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});await status(page,'이메일과 비밀번호를 다시');assert.equal(f.posts.length,1);assert.equal(await page.getByLabel('비밀번호',{exact:true}).inputValue(),'');assert.doesNotMatch(await page.locator('body').innerText(),/Supabase|\.env|diagnostic/);
  f.loginError=null;f.dbFails=true;await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'내 계정으로 로그인',exact:true}).click();await status(page,'로그인은 확인했어요');assert.equal(await page.locator('input').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Supabase|\.env/);f.dbFails=false;await page.getByRole('button',{name:'내 옷장 다시 불러오기',exact:true}).click();await status(page,'내 계정의 옷장에 연결');assert.equal(f.posts.length,2);
  await page.reload({waitUntil:'networkidle'});await status(page,'내 계정의 옷장에 연결');assert.equal(f.posts.length,2);await page.getByRole('button',{name:'로그아웃',exact:true}).click();await status(page,'로그아웃했어요');assert.equal(f.posts.at(-1),'DELETE /api/session');assert.equal(await page.getByLabel('이메일',{exact:true}).count(),1);
 });
 await scenario('signup uses separate password confirmation and stays signed out with mail cooldown',async(page,f)=>{
  await signup(page);await page.getByLabel('비밀번호 확인',{exact:true}).fill('different-fixture');await page.getByRole('button',{name:'가입하고 메일 받기',exact:true}).click();await status(page,'두 비밀번호가 같지');assert.deepEqual(f.posts,[]);await page.getByLabel('비밀번호 확인',{exact:true}).fill(password);await page.screenshot({path:path.join(output,'browser-account-confirm-step.png')});
  await page.locator('form').evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});await status(page,'확인 메일의 링크');assert.deepEqual(f.posts,['POST /api/signup']);assert.equal(f.calls.includes('GET /api/state'),false);assert.equal(await page.locator('input[type="password"]').count(),0);assert.equal(await page.getByRole('button',{name:'확인 메일 다시 요청',exact:true}).isDisabled(),true);assert.equal(await page.locator('.mirror-account-panel').getAttribute('data-account-step'),'help');
 });
 await scenario('explicit confirmation resend uses email only and does not sign in',async(page,f)=>{await page.getByRole('button',{name:'메일 확인·기존 로그인',exact:true}).click();await page.getByLabel('이메일',{exact:true}).fill(email);await page.getByRole('button',{name:'확인 메일 다시 요청',exact:true}).click();await status(page,'확인 메일을 다시 요청');assert.deepEqual(f.posts,['POST /api/signup/resend']);assert.equal(f.calls.includes('GET /api/state'),false);});
 await scenario('signup requires verified confirmation settings and existing-session lookup remains available',async(page,f)=>{await page.getByRole('button',{name:'새 계정',exact:true}).click();await page.getByLabel('이메일',{exact:true}).fill(email);assert.equal(await page.getByRole('button',{name:'다음',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'메일 확인·기존 로그인',exact:true}).click();assert.equal(await page.getByRole('button',{name:'확인 메일 다시 요청',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'기존 로그인 확인',exact:true}).click();await status(page,'로그인할 계정을 입력');assert.deepEqual(f.posts,[]);},{confirmation:false});
 await scenario('email-return fragment is removed without rendering or storing it',async(page,f)=>{await status(page,'메일 확인을 마쳤다면');assert.equal(new URL(page.url()).hash,'');assert.doesNotMatch(await page.locator('body').innerText(),/synthetic-return-marker/);const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert.doesNotMatch(stored,/synthetic-return-marker/);assert.deepEqual(f.posts,[]);},{},'#access_token=synthetic-return-marker&refresh_token=synthetic-return-marker&type=signup');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);const report={status:'PASS',checks,errors,external,unexpected,network:'All /api replies were local injected fixtures; no real signup, email, login or DB call.'};await fs.writeFile(path.join(output,'mirror-account-fixture-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}