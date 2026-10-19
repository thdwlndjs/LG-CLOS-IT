import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {Page,Locator} from 'playwright';
import {createDemoApp,STORAGE_KEY} from '../src/core';
import {createWardrobePackBundle,PACK_PROFILE_ID} from '../src/wardrobePack';
import {resolvePhotoLocations} from '../src/photoSceneMapping';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('tmp/browser-tools');
const {chromium}=await import('playwright');
const out='evidence/use-compare-save-reuse-20261009/matched-benchmark';
await fs.mkdir(out,{recursive:true});
const mem=new Map<string,string>(),local=createDemoApp({getItem:k=>mem.get(k)??null,setItem:(k,v)=>{mem.set(k,v)},removeItem:k=>{mem.delete(k)}});
const bundle=createWardrobePackBundle();local.installLocalDemoProfile(bundle);
const seed=structuredClone(local.getState());
seed.externalItems=[{id:'fixture-existing-outer',ownerId:PACK_PROFILE_ID,name:'검수용 외부 아우터 · 기존 자산 메타데이터 fixture',category:'outer',asset:structuredClone(bundle.garments.find(g=>g.category==='outer')!.asset),sourceLabel:'기존 후보 입력 계약 시험',sourceUrl:'https://example.invalid/fixture'}];
const seedJson=JSON.stringify(seed),seedSha256=createHash('sha256').update(seedJson).digest('hex');
const publicConfigFixture={project_ref:'isolated-browser-benchmark',database_configured:false,ai_mode:'mock',live_enabled:false,key_present:{supabase_publishable:false,supabase_server:false,openai:false,decart:false}};
await fs.writeFile(`${out}/seed.json`,JSON.stringify(seed,null,2));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
const versions=[{name:'before',origin:'http://127.0.0.1:4313',commit:'3c1d92f1e7a69eefaee3a252763c72e582c2e75b'},{name:'after',origin:'http://127.0.0.1:4311',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}];
const results:any[]=[];
const state=(p:Page)=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),STORAGE_KEY);
const draft=(s:any)=>s.outfitDrafts[s.activeProfileId];
const nav=(p:Page,name:string)=>p.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name,exact:true}).click();
const role=(p:Page,v:string)=>p.locator(`.mx-surface[data-outfit-view="${v}"]`);
const leds=(p:Page)=>p.locator('.photo-led[data-led="on"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-anchor-id')).sort());
async function browseTo(p:Page,label:string,target:Locator){
 const region=p.getByRole('region',{name:label,exact:true});
 const page=Number(await target.locator('xpath=ancestor::*[@data-page-index][1]').getAttribute('data-page-index'));
 let current=Number(await region.getAttribute('data-browsed-index'));
 while(current<page){await region.getByRole('button',{name:`${label} 다음`,exact:true}).click();current++;}
 while(current>page){await region.getByRole('button',{name:`${label} 이전`,exact:true}).click();current--;}
 await target.click();
}
async function choose(p:Page,label:string,id:string){await browseTo(p,label,p.getByRole('region',{name:label,exact:true}).locator(`[data-garment-id="${id}"]`));}
async function pickCard(p:Page,id:string){await browseTo(p,'저장 코디 페이지',p.getByRole('region',{name:'저장 코디 페이지',exact:true}).locator(`[data-outfit-id="${id}"]`));}
async function settled(p:Page){await p.evaluate(()=>document.fonts.ready);await p.waitForFunction(()=>[...document.images].filter(i=>i.offsetWidth&&i.offsetHeight).every(i=>i.complete));}
const tasks=[
 {id:'A-same-garment-history-label-return',description:'Home → wardrobe → top filter → search 셔츠 → exact T04/history → label/care → same filtered list',run:async(p:Page,mark:(s:string)=>void)=>{
  const before=await state(p);await nav(p,'옷장');await p.getByRole('button',{name:'상의',exact:true}).click();await p.getByRole('button',{name:'옷 검색',exact:true}).click();await p.getByPlaceholder('옷 이름',{exact:true}).fill('셔츠');await choose(p,'의류 탐색','T04');
  assert.equal(await p.locator('[data-detail-garment-id="T04"]').count(),1);assert.deepEqual(await leds(p),resolvePhotoLocations(before.garments,PACK_PROFILE_ID,['T04']).anchorIds.sort());mark('Exact T04 detail/history and mapped local demonstration LEDs');
  await p.getByRole('tab',{name:'라벨·관리법',exact:true}).click();assert.equal(await p.locator('[data-detail-garment-id="T04"]').count(),1);mark('Same garment label/care read; no invented label claim');
  await p.getByRole('button',{name:'옷 목록으로 돌아가기',exact:true}).click();assert.equal(await p.getByPlaceholder('옷 이름',{exact:true}).inputValue(),'셔츠');assert.equal(await p.getByRole('button',{name:'상의',exact:true}).getAttribute('aria-pressed'),'true');assert.deepEqual(await leds(p),[]);assert.deepEqual((await state(p)).events,before.events);mark('Return retains filter/search; no record created');
 }},
 {id:'B-home-top-fullgrid-today-calendar',description:'Home LOOK01 → change top → full grid T02 → comparison → today selection → calendar reread',run:async(p:Page,mark:(s:string)=>void)=>{
  const before=await state(p),original=structuredClone(before.outfits.find((o:any)=>o.id==='LOOK01'));
  await p.locator('[data-look-id="LOOK01"]').click();await role(p,'compare').waitFor();await p.locator('[data-foreground-state="ready"]').waitFor({timeout:60000});const source=structuredClone(draft(await state(p)));mark('Exact existing LOOK01 prepared comparison (not live fitting)');
  await p.getByRole('button',{name:'상의 바꾸기',exact:true}).click();await p.getByRole('button',{name:'전체에서 고르기',exact:true}).click();await role(p,'builder').waitFor();await choose(p,'상의 후보','T02');
  // The common endpoint is C. Only click the existing compare control if this version still needs it.
  if(await role(p,'builder').count())await p.getByRole('button',{name:'미러로 비교',exact:true}).click();
  await role(p,'compare').waitFor();const chosen=structuredClone(draft(await state(p)));assert.equal(chosen.items.top,'T02');assert.deepEqual(Object.fromEntries(Object.entries(chosen.items).filter(([k])=>k!=='top')),Object.fromEntries(Object.entries(source.items).filter(([k])=>k!=='top')));assert.equal(await p.locator('.mirror-foreground').count(),0);mark('Only top replaced, other components preserved, no unmatched person');
  await p.getByRole('button',{name:'이 옷으로 입기',exact:true}).click();await p.waitForFunction(k=>JSON.parse(localStorage.getItem(k)||'null')?.events.some((e:any)=>e.kind==='plan'),STORAGE_KEY);const s=await state(p),plans=s.events.filter((e:any)=>e.kind==='plan');assert.equal(plans.length,1);assert.equal(s.events.filter((e:any)=>e.kind==='wear').length,0);const snapshot=s.outfits.find((o:any)=>o.id===plans[0].outfitId);assert.deepEqual(snapshot.items,chosen.items);assert.deepEqual(s.outfits.find((o:any)=>o.id==='LOOK01'),original);assert.deepEqual(await leds(p),resolvePhotoLocations(s.garments,PACK_PROFILE_ID,Object.values(chosen.items)as string[]).anchorIds.sort());
  await p.getByRole('button',{name:'오늘 기록 보기',exact:true}).click();await p.locator(`[data-event-id="${plans[0].id}"]`).waitFor();assert.deepEqual((await state(p)).outfits.find((o:any)=>o.id===plans[0].outfitId).items,chosen.items);mark('Today selection only, exact snapshot and component LEDs, calendar reread');
 }},
 {id:'C-new-mixed-card-profile-roundtrip',description:'New T02+B02+existing external metadata fixture → save card with no title input → other profile and back → saved card reread',run:async(p:Page,mark:(s:string)=>void)=>{
  await nav(p,'코디');await p.getByRole('button',{name:'+ 새 코디',exact:true}).click();await choose(p,'상의 후보','T02');await p.getByRole('button',{name:'하의 선택',exact:true}).click();await choose(p,'하의 후보','B02');await p.getByRole('button',{name:'아우터 선택',exact:true}).click();await p.getByRole('button',{name:'쇼핑 후보',exact:true}).click();await p.locator('[data-external-id="fixture-existing-outer"]').click();
  const before=await state(p),chosen=structuredClone(draft(before)),ids=before.outfits.map((o:any)=>o.id);assert.equal(chosen.items.top,'T02');assert.equal(chosen.items.bottom,'B02');assert.equal(chosen.externalItems.outer.externalItemId,'fixture-existing-outer');
  await p.getByRole('button',{name:'카드로 저장',exact:true}).click();await p.waitForFunction(({k,ids})=>JSON.parse(localStorage.getItem(k)||'null')?.outfits.some((o:any)=>!ids.includes(o.id)),{k:STORAGE_KEY,ids});let s=await state(p);const added=s.outfits.filter((o:any)=>!ids.includes(o.id));assert.equal(added.length,1);const saved=added[0];assert.deepEqual(saved.items,chosen.items);assert.deepEqual(saved.externalItems,chosen.externalItems);assert.deepEqual(s.events,before.events);mark('Exact mixed composition saved once, zero title input, no plan or wear');
  await nav(p,'마이');await p.locator('button[data-profile-id="demo-profile"]').click();await nav(p,'코디');assert.equal(await p.locator(`[data-outfit-id="${saved.id}"]`).count(),0);await nav(p,'마이');await p.locator(`button[data-profile-id="${PACK_PROFILE_ID}"]`).click();await nav(p,'코디');await pickCard(p,saved.id);await role(p,'compare').waitFor();s=await state(p);assert.deepEqual(draft(s).items,saved.items);assert.deepEqual(draft(s).externalItems,saved.externalItems);assert.deepEqual(s.events,before.events);assert.equal(await p.locator('.mirror-foreground').count(),0);mark('Other profile isolation and roundtrip reread exact components/provenance without automatic fitting or recording');
 }}
];
async function run(version:typeof versions[number],task:typeof tasks[number]){
 const dir=`${out}/${version.name}/${task.id}`;await fs.mkdir(`${dir}/recordings`,{recursive:true});const actions:any[]=[],milestones:any[]=[],blocked:any[]=[],fixtures:any[]=[],errors:string[]=[];let measuring=false,start=0,end=0,startedAt='';
 const c=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block',recordVideo:{dir:`${dir}/recordings`,size:{width:1920,height:1080}}});
 await c.exposeBinding('recordJourney',(_,value)=>{if(measuring)actions.push({...value,nodeElapsedMs:performance.now()-start});});
 await c.addInitScript(({seed,key})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(seed));},{seed,key:STORAGE_KEY});
 await c.addInitScript(`
  window.__traceChain=Promise.resolve();
  const capture=(type,e)=>{const t=e.target?.closest('button,a,input,textarea,select,[role="tab"]');if(!t)return;const item={type,domAt:performance.now(),action:t.getAttribute('aria-label')||t.getAttribute('placeholder')||t.textContent?.trim(),tag:t.tagName,role:t.getAttribute('role'),lookId:t.getAttribute('data-look-id'),outfitId:t.getAttribute('data-outfit-id'),garmentId:t.getAttribute('data-garment-id'),externalId:t.getAttribute('data-external-id'),view:document.querySelector('.mx-surface')?.getAttribute('data-outfit-view'),screen:document.querySelector('.mx-surface')?.getAttribute('data-screen'),...(type==='input'?{value:t.value}:{}),...(type==='keydown'?{key:e.key}:{})};window.__traceChain=window.__traceChain.then(()=>window.recordJourney(item));};
  document.addEventListener('click',e=>capture('click',e),true);document.addEventListener('input',e=>capture('input',e),true);document.addEventListener('keydown',e=>capture('keydown',e),true);
 `);
 await c.route('**/*',r=>{const u=new URL(r.request().url());if(['http:','https:'].includes(u.protocol)){if(u.origin!==version.origin){blocked.push({method:r.request().method(),url:u.href});return r.abort();}if(u.pathname.startsWith('/api/')){const body=u.pathname==='/api/config'?publicConfigFixture:u.pathname==='/api/session'?{authenticated:false}:u.pathname==='/api/auth-status'?{email_password_enabled:true,email_confirmation_required:true}:undefined;if(body){fixtures.push(u.pathname);return r.fulfill({contentType:'application/json',body:JSON.stringify(body)});}blocked.push({method:r.request().method(),url:u.pathname});return r.abort();}}return r.continue();});
 const p=await c.newPage(),video=p.video();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));let status='PASS',error:string|undefined,final:any;
 try{
  await p.goto(version.origin,{waitUntil:'networkidle'});await settled(p);assert.equal((await state(p)).activeProfileId,PACK_PROFILE_ID);startedAt=new Date().toISOString();start=performance.now();measuring=true;
  await task.run(p,message=>{milestones.push({message,elapsedMs:performance.now()-start});});await p.evaluate(()=>(window as any).__traceChain);end=performance.now();measuring=false;final=await state(p);await settled(p);await p.screenshot({path:`${dir}/endpoint-1920.png`});await p.locator('.photo-mirror').screenshot({path:`${dir}/endpoint-mirror.png`});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 }catch(e){end=performance.now();measuring=false;status='FAIL';error=String(e);console.error(version.name,task.id,error);final=await state(p).catch(()=>null);await p.screenshot({path:`${dir}/failure-1920.png`}).catch(()=>{});}
 finally{await c.close();if(video){await video.saveAs(`${dir}/journey.webm`);await video.delete();}}
 const clicks=actions.filter(a=>a.type==='click'),inputs=actions.filter(a=>a.type==='input'),keys=actions.filter(a=>a.type==='keydown');
 const result={version:version.name,taskId:task.id,task:task.description,status,error,startedAt,elapsedMs:end-start,clickCount:clicks.length,inputCount:inputs.length,keyboardCount:keys.length,manualCompareButtonClicks:clicks.filter(a=>a.action==='미러로 비교').length,compareEntryControlClicks:clicks.filter(a=>a.lookId||a.outfitId||a.action==='미러로 비교').length,titleInputCount:inputs.filter(a=>a.action==='코디 이름').length,seedSha256,viewport:{width:1920,height:1080,dpr:1},actions,milestones,apiFixtures:fixtures,blocked,errors,recording:`${version.name}/${task.id}/journey.webm`,endpoint:`${version.name}/${task.id}/endpoint-1920.png`,finalDraft:final&&draft(final),finalOutfitCount:final?.outfits.length,eventKinds:final?.events.map((e:any)=>e.kind),timingScope:'One scripted Chrome run; from first task action through endpoint assertions. Excludes initial page load, screenshots and video finalization; includes actionability waits, animation, local state checks and prepared image loading. Not human usability timing or live API/provider latency.'};
 await fs.writeFile(`${dir}/action-trace.json`,JSON.stringify(result,null,2));results.push(result);console.log(JSON.stringify({version:result.version,task:task.id,status,clicks:result.clickCount,inputs:result.inputCount,elapsedMs:Math.round(result.elapsedMs)}));
}
for(const task of tasks)for(const version of versions)await run(version,task);
await browser.close();
const paired=tasks.map(task=>{const before=results.find(r=>r.version==='before'&&r.taskId===task.id),after=results.find(r=>r.version==='after'&&r.taskId===task.id);return {task:task.id,matchedPass:before.status==='PASS'&&after.status==='PASS',before:{clicks:before.clickCount,inputs:before.inputCount,titleInput:before.titleInputCount,elapsedMs:before.elapsedMs,compareEntries:before.compareEntryControlClicks},after:{clicks:after.clickCount,inputs:after.inputCount,titleInput:after.titleInputCount,elapsedMs:after.elapsedMs,compareEntries:after.compareEntryControlClicks},clickDelta:after.clickCount-before.clickCount};});
const comparison={createdAt:new Date().toISOString(),versions,seedSha256,paired,totalCompareEntries:{before:results.filter(r=>r.version==='before').reduce((n,r)=>n+r.compareEntryControlClicks,0),after:results.filter(r=>r.version==='after').reduce((n,r)=>n+r.compareEntryControlClicks,0)},scope:'Same seeded isolated local demonstration state and external metadata fixture referencing an existing asset, no new clothes, no real account/auth/DB/provider. Config/session read responses also intercepted as browser fixtures; production configuration is unchanged. Baseline is archived source at 3c1d92f, current after includes working-tree changes. Shared existing static public assets.',timingLimit:'Single sequential scripted run per version/task, not statistical evidence of speed or a human study. No intentional idle/capture sleeps inside measurement; browser waits and actual local execution are included.',actualPaidCalls:0,results:results.map(({actions,...rest})=>rest)};
await fs.writeFile(`${out}/comparison.json`,JSON.stringify(comparison,null,2));
await fs.copyFile('tmp/use-reuse-matched-baseline-3c1d92f/source-manifest.json',`${out}/baseline-source-manifest.json`);
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
