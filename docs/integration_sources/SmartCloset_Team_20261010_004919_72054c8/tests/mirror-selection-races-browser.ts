import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,type Page} from 'playwright';
import {STORAGE_KEY} from '../src/core/seed';

// All delays exist only in these fresh browser contexts. No production app hooks or real APIs.
const origin='http://127.0.0.1:4311',output=path.resolve('evidence/mirror-final-20261009');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
const results:{name:string;status:'PASS'|'FAIL';error?:string}[]=[],errors:string[]=[],external:string[]=[],unexpected:string[]=[];
const state=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),STORAGE_KEY);
const draft=(value:any)=>value.outfitDrafts[value.activeProfileId];
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name,exact:true}).click();
const leds=(page:Page)=>page.locator('.photo-led[data-led="on"]').count();
async function choose(page:Page,label:string,selector:string){const pager=page.getByRole('region',{name:label,exact:true}),target=pager.locator(selector),index=Number(await target.locator('xpath=..').getAttribute('data-page-index')),viewport=pager.locator('.horizontal-pager__viewport');assert.ok(Number.isSafeInteger(index));await viewport.focus();await viewport.press('Home');for(let i=0;i<index;i++)await viewport.press('ArrowRight');await target.click();}
async function scenario(name:string,run:(page:Page)=>Promise<void>){
 const context=await browser.newContext({viewport:{width:1910,height:1080},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const fixture:any={holdDigest:false,digestHeld:false,holdTimerNumber:0,timersSeen:0,timerHeld:false};(window as any).__selectionRaceFixture=fixture;
  const digest=crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest=(...args:Parameters<SubtleCrypto['digest']>)=>{
   if(fixture.holdDigest&&String(typeof args[0]==='string'?args[0]:args[0].name).toUpperCase()==='SHA-1'){
    fixture.holdDigest=false;fixture.digestHeld=true;return new Promise<ArrayBuffer>((resolve,reject)=>{fixture.releaseDigest=()=>{fixture.digestHeld=false;void digest(...args).then(resolve,reject);};});
   }
   return digest(...args);
  };
  const timeout=window.setTimeout.bind(window);
  window.setTimeout=((callback:TimerHandler,delay?:number,...args:any[])=>{
   if(fixture.holdTimerNumber&&delay===250&&typeof callback==='function'&&++fixture.timersSeen===fixture.holdTimerNumber){
    fixture.holdTimerNumber=0;fixture.timerHeld=true;const id=timeout(()=>{},2_000_000_000);fixture.releaseTimer=()=>{fixture.timerHeld=false;clearTimeout(id);callback(...args);};return id;
   }
   return timeout(callback,delay,...args);
  }) as typeof window.setTimeout;
 });
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external.push(request.url());return route.abort();}if(url.pathname.startsWith('/api/')){if(request.method()==='GET'&&url.pathname==='/api/config')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({database_configured:false,live_enabled:false,ai_mode:'mock',key_present:{}})});unexpected.push(request.method()+' '+url.pathname);return route.abort();}return route.continue();});
 await context.routeWebSocket('**/*',socket=>socket.close());
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(name+':'+error.message));
 try{await page.goto(origin+'/dev',{waitUntil:'networkidle'});await page.getByRole('button',{name:'새 이미지팩 시연',exact:true}).click();await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.activeProfileId==='wardrobe-pack-demo',STORAGE_KEY);await page.goto(origin+'/',{waitUntil:'networkidle'});await page.locator('.mx-surface').waitFor();await run(page);results.push({name,status:'PASS'});console.log('PASS '+name);}
 catch(error){results.push({name,status:'FAIL',error:String(error)});console.error('FAIL '+name+' '+error);await page.screenshot({path:path.join(output,`browser-selection-race-failure-${results.length}.png`)}).catch(()=>{});}
 finally{await context.close();}
}
try{
 await fs.mkdir(output,{recursive:true});
 await scenario('repeated same-look and same-top taps preserve draft identity and revision',async page=>{
  await choose(page,'홈 코디 탐색','[data-look-id="LOOK01"]');const original=draft(await state(page));await nav(page,'코디');await choose(page,'전체 코디 탐색','[data-look-id="LOOK01"]');assert.deepEqual(draft(await state(page)),original);
  await page.getByRole('button',{name:'상의 바꾸기',exact:true}).click();await choose(page,'상의 후보 탐색',`[data-garment-id="${original.items.top}"]`);assert.deepEqual(draft(await state(page)),original);
  await choose(page,'상의 후보 탐색','[data-garment-id="T04"]');const changed=draft(await state(page));assert.equal(changed.revision,original.revision+1);await choose(page,'상의 후보 탐색','[data-garment-id="T04"]');assert.deepEqual(draft(await state(page)),changed);assert.deepEqual((await state(page)).events,[]);
 });
 await scenario('navigation during delayed selection save clears saving after completion and persists one snapshot',async page=>{
  await choose(page,'홈 코디 탐색','[data-look-id="LOOK01"]');const before=await state(page),submitted=draft(before);await page.evaluate(()=>(window as any).__selectionRaceFixture.holdDigest=true);await page.getByRole('button',{name:'이 옷으로 입기',exact:true}).click();await page.waitForFunction(()=>(window as any).__selectionRaceFixture.digestHeld===true);assert.equal(await page.getByRole('button',{name:'기록하는 중',exact:true}).isDisabled(),true);
  await nav(page,'홈');await nav(page,'코디');assert.equal(await leds(page),0);await page.evaluate(()=>(window as any).__selectionRaceFixture.releaseDigest());await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null').events.filter((event:any)=>event.kind==='plan').length===1,STORAGE_KEY);
  const button=page.getByRole('button',{name:'이 옷으로 입기',exact:true});await button.waitFor();assert.equal(await button.isEnabled(),true);let after=await state(page);assert.deepEqual(draft(after),submitted);assert.equal(after.outfits.length,before.outfits.length+1);assert.equal(after.events[0].kind,'plan');assert.deepEqual(after.outfits.find((outfit:any)=>outfit.id===after.events[0].outfitId).items,submitted.items);
  await button.click();await page.getByRole('status').filter({hasText:'이미 기록'}).waitFor();after=await state(page);assert.equal(after.events.length,1);assert.equal(after.outfits.length,before.outfits.length+1);assert.equal(after.events.filter((event:any)=>event.kind==='wear').length,0);
 });
 await scenario('late submitted plan completion stays with its original owner and cannot leak into the new UI',async page=>{
  await choose(page,'홈 코디 탐색','[data-look-id="LOOK01"]');const before=await state(page),submitted=draft(before);await page.evaluate(()=>{const fixture=(window as any).__selectionRaceFixture;fixture.timersSeen=0;fixture.holdTimerNumber=2;});await page.getByRole('button',{name:'이 옷으로 입기',exact:true}).click();await page.waitForFunction(()=>(window as any).__selectionRaceFixture.timerHeld===true);
  const queued=await state(page);assert.equal(queued.outfits.length,before.outfits.length+1);assert.equal(queued.events.length,0);await nav(page,'마이');await page.getByRole('combobox',{name:'현재 프로필'}).selectOption('demo-profile');await nav(page,'캘린더');const other=await state(page);assert.equal(other.activeProfileId,'demo-profile');assert.equal(await leds(page),0);assert.equal(await page.locator('[data-event-kind]').count(),0);
  await page.evaluate(()=>(window as any).__selectionRaceFixture.releaseTimer());await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null').events.length===1,STORAGE_KEY);await page.waitForTimeout(100);const after=await state(page);assert.equal(after.events[0].kind,'plan');assert.equal(after.events[0].ownerId,submitted.ownerId);assert.equal(after.activeProfileId,'demo-profile');assert.deepEqual(draft(after),draft(other));assert.equal(await page.locator('[data-event-kind]').count(),0);assert.equal(await leds(page),0);assert.equal(await page.locator('.mx-surface').getAttribute('data-screen'),'calendar');assert.equal(await page.getByRole('status').filter({hasText:/오늘의 코디를 기록|앞서 선택/}).count(),0);
  await nav(page,'코디');assert.equal(await page.getByRole('button',{name:'이 옷으로 입기',exact:true}).isEnabled(),true);assert.equal(after.events.filter((event:any)=>event.kind==='wear').length,0);
 });
 await scenario('SPA setup-to-mirror round trip preserves the shared person and current draft',async page=>{
  await choose(page,'홈 코디 탐색','[data-look-id="LOOK01"]');const before=draft(await state(page));await nav(page,'마이');await page.getByRole('button',{name:'피팅 준비 설정',exact:true}).click();await page.waitForURL(origin+'/dev');
  await page.getByLabel('미러 인물 사진 파일',{exact:true}).setInputFiles({name:'synthetic-person-fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2l0AAAAASUVORK5CYII=','base64')});
  await page.waitForFunction(()=>document.querySelector('.person-stage')?.getAttribute('data-person-id')?.startsWith('local-person-'));
  const selectedPerson=await page.locator('.person-stage').getAttribute('data-person-id'),personUrl=await page.locator('.person-stage img.person-media').getAttribute('src');assert.ok(personUrl?.startsWith('blob:'));
  await page.evaluate(()=>(window as any).__spaRoundTripMarker='same-document-fixture');await page.getByRole('button',{name:'미러로 돌아가기',exact:true}).click();await page.waitForURL(origin+'/');await page.locator('.mx-surface').waitFor();assert.equal(await page.evaluate(()=>(window as any).__spaRoundTripMarker),'same-document-fixture');assert.deepEqual(draft(await state(page)),before);
  await nav(page,'마이');await page.getByRole('button',{name:'피팅 준비 설정',exact:true}).click();await page.waitForURL(origin+'/dev');assert.equal(await page.getByRole('combobox',{name:'미러 인물 선택',exact:true}).inputValue(),selectedPerson);assert.equal(await page.locator('.person-stage').getAttribute('data-person-id'),selectedPerson);assert.equal(await page.locator('.person-stage img.person-media').getAttribute('src'),personUrl);assert.deepEqual(draft(await state(page)),before);assert.deepEqual((await state(page)).events,[]);
 });
}finally{await browser.close();await fs.writeFile(path.join(output,'mirror-selection-race-results.json'),JSON.stringify({generatedAt:new Date().toISOString(),results,errors,external,unexpected,network:'Fresh local demo profiles; every API is blocked except injected unconfigured /api/config fixture; no remote writes.',delay:'Test-only SHA-1 Promise hold and local mock completion timer hold; no production source instrumentation.'},null,2));}
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);assert.ok(results.every(result=>result.status==='PASS'),JSON.stringify(results));console.log(JSON.stringify({pass:results.length,errors:errors.length,external:external.length,unexpectedApi:unexpected.length}));