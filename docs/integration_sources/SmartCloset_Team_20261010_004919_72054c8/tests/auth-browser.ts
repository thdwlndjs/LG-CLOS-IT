// Browser UI fixture only. No real account credentials, external Auth request, or provider call.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createSeed} from '../src/core/seed';
const origin='http://127.0.0.1:4311',output=process.env.SC_EVIDENCE_DIR??'evidence';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--no-first-run']});
const context=await browser.newContext({viewport:{width:1920,height:1080},locale:'ko-KR',serviceWorkers:'block'});
let signedIn=false,dbFails=false,mode:'invalid'|'confirm'|'success'='invalid',loginPosts=0,expired=false,userId='fixture-auth-user',holdState=false;
let releaseState:(()=>void)|undefined,releaseLogout:(()=>void)|undefined,holdLogout=false;
function remoteState(){const seed=createSeed();const state=JSON.parse(JSON.stringify(seed).replaceAll('demo-profile',userId));state.garments[0].name=userId==='fixture-auth-user'?'REMOTE_A_ONLY':'REMOTE_B_ONLY';return state;}
const errors:string[]=[],requests:string[]=[],external:string[]=[];
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);await route.abort();return;}
 if(!url.pathname.startsWith('/api/')){await route.continue();return;}
 const method=route.request().method(),path=url.pathname;requests.push(`${method} ${path}`);
 const json=(v:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
 const error=(code:string,message:string,status=401)=>json({error:{code,message,diagnostic:{stage:'auth',upstream_status:400,upstream_code:code}}},status);
 if(path==='/api/config')return json({project_ref:'slxgcgtnxkchxywgsmuk',database_configured:true,ai_mode:'mock',live_enabled:false,key_present:{supabase_publishable:true,supabase_server:false,openai:false,decart:false}});
 if(path==='/api/auth-status')return json({project_ref:'slxgcgtnxkchxywgsmuk',email_password_enabled:true,email_confirmation_required:true});
 if(path==='/api/session'){
  if(method==='DELETE'){signedIn=false;if(holdLogout)await new Promise<void>(resolve=>{releaseLogout=resolve;});return json({authenticated:false,revocation:'confirmed'});}
  if(method==='POST'){loginPosts++;await new Promise(r=>setTimeout(r,120));if(mode==='invalid')return error('invalid_credentials','앱에 등록된 이메일과 비밀번호를 확인해 주세요.');if(mode==='confirm')return error('email_not_confirmed','이메일 확인이 필요합니다.',403);signedIn=true;return json({authenticated:true,user_id:userId});}
  if(expired||!signedIn)return error(expired?'session_expired':'unauthorized',expired?'로그인 세션이 종료되었습니다.':'앱에 등록된 이메일로 로그인해 주세요.');
  return json({authenticated:true,user_id:userId});
 }
 if(path==='/api/state'){if(dbFails)return json({error:{code:'database_unavailable',message:'DB 연결을 확인해 주세요.',diagnostic:{stage:'database',upstream_status:503}}},503);if(holdState)await new Promise<void>(resolve=>{releaseState=resolve;});return json(remoteState());}
 return json({error:{code:'invalid_input',message:'fixture route unavailable'}},404);
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const nav=(name:string)=>page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name,exact:true}).click();
const account=()=>page.locator('.backend-panel').filter({has:page.getByRole('heading',{name:'내 계정',exact:true})});
const message=(part:string)=>account().getByRole('status').filter({hasText:part}).waitFor();
const credentials=async()=>{await page.getByLabel('앱 계정 이메일',{exact:true}).fill('fixture@example.invalid');await page.getByLabel('비밀번호',{exact:true}).fill('fixture-only-password');};
const capture=async(name:string)=>{await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>undefined)));});await page.screenshot({path:`${output}/auth-${name}.png`});};
try{
 await fs.mkdir(output,{recursive:true});await page.goto(origin,{waitUntil:'networkidle'});await nav('마이');await message('앱에 등록된 이메일');
 await credentials();await page.getByRole('button',{name:'내 계정으로 로그인',exact:true}).evaluate(button=>{const form=button.closest('form')!;form.requestSubmit();form.requestSubmit();});await message('이메일과 비밀번호');assert.equal(loginPosts,1);assert.equal(await page.getByLabel('비밀번호',{exact:true}).inputValue(),'');await capture('invalid-credentials-fixture');
 mode='confirm';await credentials();await page.getByRole('button',{name:'내 계정으로 로그인',exact:true}).click();await message('이메일 확인');assert.equal(loginPosts,2);
 mode='success';dbFails=true;await credentials();await page.getByRole('button',{name:'내 계정으로 로그인',exact:true}).click();await message('로그인은 확인됐지만');assert.equal(loginPosts,3);assert.equal(await page.getByLabel('앱 계정 이메일').count(),0);await capture('auth-ok-db-failed-fixture');
 dbFails=false;await page.getByRole('button',{name:'내 옷장 다시 불러오기',exact:true}).click();await page.locator('.demo-footer').filter({hasText:'Supabase 연결'}).waitFor();await nav('마이');await message('불러왔어요');assert.equal(loginPosts,3);
 await nav('홈');await nav('옷장');await nav('마이');await message('불러왔어요');assert.equal(loginPosts,3);
 await page.reload({waitUntil:'networkidle'});await nav('마이');await message('불러왔어요');assert.equal(loginPosts,3);await capture('session-restored-fixture');
 await nav('옷장');await page.getByLabel('옷 검색').fill('블랙');const statesBefore=requests.filter(r=>r==='GET /api/state').length;
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/session')),page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);assert.equal(await page.getByLabel('옷 검색').inputValue(),'블랙');assert.equal(requests.filter(r=>r==='GET /api/state').length,statesBefore);
 userId='fixture-other-user';holdState=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.demo-footer').filter({hasText:'미연결'}).waitFor();assert.ok(!(await page.locator('body').innerText()).includes('REMOTE_A_ONLY'));await page.waitForFunction(()=>true);while(!releaseState)await new Promise(r=>setTimeout(r,10));holdState=false;releaseState();await page.locator('.demo-footer').filter({hasText:'Supabase 연결'}).waitFor();await nav('마이');await message('불러왔어요');assert.ok(!(await page.locator('body').innerText()).includes('REMOTE_A_ONLY'));assert.ok((await page.locator('body').innerText()).includes('REMOTE_B_ONLY'));
 expired=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.demo-footer').filter({hasText:'미연결'}).waitFor();await nav('마이');await message('로그인 세션이 종료');assert.equal(await page.getByLabel('앱 계정 이메일').count(),1);
 expired=false;await credentials();await page.getByRole('button',{name:'내 계정으로 로그인',exact:true}).click();await page.locator('.demo-footer').filter({hasText:'Supabase 연결'}).waitFor();await nav('마이');await message('불러왔어요');
 holdLogout=true;await page.getByRole('button',{name:'로그아웃 · 로컬 시연으로',exact:true}).click();await page.locator('.demo-footer').filter({hasText:'미연결'}).waitFor();assert.ok(!(await page.locator('body').innerText()).includes('REMOTE_B_ONLY'));while(!releaseLogout)await new Promise(r=>setTimeout(r,10));releaseLogout();await nav('마이');await message('로그아웃했어요');await page.reload({waitUntil:'networkidle'});await nav('마이');await message('앱에 등록된 이메일');assert.equal(loginPosts,4);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={kind:'browser Auth fixture, not real-account verification',pass:true,checks:['duplicate submit suppressed','invalid credentials shown','confirmation needed shown','password cleared','Auth success vs DB failure separated','DB retry uses current session','menu navigation session retained','reload restores session without password','same-owner revalidation preserves edit/search state','changed owner clears prior records before next state loads','expired session restored local mode','logout clears private records before network response','logout followed by reload stays signed out'],loginRequests:loginPosts,apiRequests:requests.length,externalRequests:external.length,pageErrors:errors.length};
 await fs.writeFile(`${output}/auth-browser-results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();}
