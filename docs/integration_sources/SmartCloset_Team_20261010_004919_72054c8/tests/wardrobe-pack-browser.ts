import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Page} from 'playwright';
import {createSeed,STORAGE_KEY} from '../src/core/seed';

// This suite exercises local pack data only. Auth/config replies are explicit fixtures.
// Existing user tabs, cookies, localStorage, DB and provider APIs are never used.
const origin=process.env.DEMO_URL||'http://127.0.0.1:4311';
const packOwner='wardrobe-pack-demo';
const output=path.resolve(process.env.SC_EVIDENCE_DIR||'evidence');
const cache=path.resolve('tmp/mirror-scene-playwright-tools');
const ffmpeg=path.join(cache,'ffmpeg-1011','ffmpeg-win64.exe');
const ffprobe=path.resolve('tmp/media-tools/extracted/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe');
const recordingAvailable=await fs.access(ffmpeg).then(()=>true,()=>false);
if(recordingAvailable)process.env.PLAYWRIGHT_BROWSERS_PATH=cache;
const {chromium}=await import('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
await fs.mkdir(output,{recursive:true});
const results:{name:string;status:'PASS'|'FAIL';durationMs:number;error?:string}[]=[];
const errors:{test:string;message:string}[]=[];
const expectedSignedOut:string[]=[];
const external:string[]=[];const devices:string[]=[];const deniedApi:string[]=[];
const fixtureRequests:{method:string;path:string;status:number}[]=[];
const screenshots:string[]=[];const videos:unknown[]=[];
const local=(url:string)=>{try{return ['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);}catch{return false;}};
const state=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),STORAGE_KEY);
const nav=(page:Page,label:string)=>page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:label,exact:true}).click();
const garment=(s:any,packId:string)=>{const found=s.garments.filter((g:any)=>g.ownerId===packOwner&&g.asset?.url?.endsWith(`/catalog/${packId}.png`));assert.equal(found.length,1,`Expected exactly one pack garment ${packId}`);return found[0];};
const draft=(s:any)=>s.outfitDrafts[s.activeProfileId];
async function ready(page:Page){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>undefined)));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});}
async function capture(page:Page,name:string){await ready(page);await page.screenshot({path:path.join(output,name),fullPage:false});screenshots.push(name);}
async function openPack(page:Page){await page.getByRole('button',{name:'새 이미지팩 시연',exact:true}).click();await page.waitForFunction(({key,owner})=>JSON.parse(localStorage.getItem(key)||'null')?.activeProfileId===owner,{key:STORAGE_KEY,owner:packOwner});await ready(page);}
async function original(page:Page){await page.getByRole('button',{name:'기존 시연으로',exact:true}).click();assert.equal((await state(page)).activeProfileId,'demo-profile');}
async function preset(page:Page,id:string){await nav(page,'코디');await page.getByRole('button',{name:new RegExp(id)}).click();}
async function showPrepared(page:Page){await page.locator('.scene-look-dock').getByRole('button',{name:'피팅',exact:true}).click();await page.getByRole('button',{name:'준비된 착장 예시 보기',exact:true}).click();await ready(page);}
async function checkPrepared(page:Page,file:string){assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'true');assert.ok((await page.locator('.person-stage img.person-media').getAttribute('src'))?.endsWith(`/demo/${file}`));assert.match(await page.locator('.person-caption').innerText(),/정적|시연/);assert.doesNotMatch(await page.locator('.person-caption').innerText(),/실제 생성 피팅|실시간 피팅 세션/);}
async function geometry(page:Page){const g=await page.evaluate(()=>({w:innerWidth,h:innerHeight,bodyW:document.body.scrollWidth,bodyH:document.body.scrollHeight,rects:[...document.querySelectorAll('.mirror,.storage-cabinet,.mirror-nav button,.scene-look-dock,.demo-footer')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})}));assert.ok(g.bodyW<=g.w+1&&g.bodyH<=g.h+1);assert.ok(g.rects.every(r=>r.left>=-1&&r.top>=-1&&r.right<=g.w+1&&r.bottom<=g.h+1),JSON.stringify(g));}
async function report(){await fs.writeFile(path.join(output,'wardrobe-pack-browser-results.json'),JSON.stringify({generatedAt:new Date().toISOString(),origin,runner:'Installed Chrome / fresh isolated contexts',auth:'Explicit signed-out HTTP fixtures, not a real Supabase account verification',networkPolicy:'External HTTP/WebSocket and all non-fixture API calls blocked; Vite HMR terminated locally; media/geolocation blocked',limits:['Pack DEMO_PERSON01 and LOOK01~03 are supplied synthetic static examples; latest female/male references are still not verified.','Pack location display is a separately declared simulation, not confirmed physical storage.','No paid execution, real DB, Storage upload or provider call.'],results,counts:{pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length},errors,expectedSignedOut,fixtureRequests,external,devices,deniedApi,screenshots,recordingAvailable,videos},null,2));}
async function test(name:string,body:(page:Page)=>Promise<void>,record=false){
  const start=Date.now(),e0=errors.length,x0=external.length,d0=devices.length,a0=deniedApi.length;
  const context=await browser.newContext({viewport:{width:1101,height:884},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block',...(record&&recordingAvailable?{recordVideo:{dir:path.resolve('tmp/wardrobe-pack-recordings'),size:{width:1101,height:884}}}:{})});
  await context.exposeBinding('__packDeviceAttempt',(_source,method:string)=>devices.push(method));
  await context.addInitScript({content:`if(location.protocol.startsWith('http')&&!localStorage.getItem(${JSON.stringify(STORAGE_KEY)}))localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(createSeed()))});function packBlockedDevice(method){window.__packDeviceAttempt(method);return Promise.reject(new Error('Device API blocked in pack test: '+method));}Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>packBlockedDevice('getUserMedia'),getDisplayMedia:()=>packBlockedDevice('getDisplayMedia'),enumerateDevices:()=>packBlockedDevice('enumerateDevices')}});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>packBlockedDevice('geolocation'),watchPosition:()=>packBlockedDevice('watchPosition')}});`});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url()),method=route.request().method();
    if(/^https?:/.test(u.protocol)&&!local(u.href)){external.push(u.href);return route.abort();}
    if(u.pathname.startsWith('/api/')){
      const reply=(status:number,body:unknown)=>{fixtureRequests.push({method,path:u.pathname,status});return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});};
      if(method==='GET'&&u.pathname==='/api/config')return reply(200,{project_ref:'isolated-pack-test',database_configured:true,ai_mode:'mock',live_enabled:false,key_present:{supabase_config_present:true,openai_key_present:false,decart_key_present:false}});
      if(method==='GET'&&u.pathname==='/api/auth-status')return reply(200,{project_ref:'isolated-pack-test',email_password_enabled:true,email_confirmation_required:true});
      if(method==='GET'&&u.pathname==='/api/session')return reply(401,{error:{code:'unauthorized',message:'로그인이 필요합니다.'}});
      deniedApi.push(`${method} ${u.pathname}`);return route.abort();
    }
    return route.continue();
  });
  await context.routeWebSocket(/.*/,ws=>{if(local(ws.url())&&new URL(ws.url()).pathname==='/')ws.onMessage(()=>{});else{external.push(ws.url());ws.close();}});
  const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push({test:name,message:e.message}));
  page.on('console',m=>{if(m.type()==='error'){const text=`${m.text()} ${m.location().url}`;if(m.location().url===`${origin}/api/session`&&m.text().includes('401'))expectedSignedOut.push(text);else errors.push({test:name,message:text});}});
  page.on('response',r=>{if(r.status()>=400&&!(r.url()===`${origin}/api/session`&&r.status()===401))errors.push({test:name,message:`${r.status()} ${r.url()}`});});
  try{await page.goto(origin,{waitUntil:'networkidle'});await body(page);assert.equal(errors.length,e0,JSON.stringify(errors.slice(e0)));assert.equal(external.length,x0);assert.equal(devices.length,d0);assert.equal(deniedApi.length,a0);results.push({name,status:'PASS',durationMs:Date.now()-start});console.log(`PASS ${name}`);}
  catch(e){const error=e instanceof Error?e.stack||e.message:String(e);results.push({name,status:'FAIL',durationMs:Date.now()-start,error});console.error(`FAIL ${name}: ${error}`);await capture(page,`wardrobe-pack-failure-${results.length}.png`).catch(()=>{});}
  finally{const video=page.video();await context.close();if(video){const target=path.join(output,'wardrobe-pack-flow.webm');try{await video.saveAs(target);const metadata=JSON.parse(execFileSync(ffprobe,['-v','error','-count_frames','-show_entries','format=duration,size:stream=codec_name,width,height,nb_read_frames','-of','json',target],{encoding:'utf8'}));videos.push({file:'wardrobe-pack-flow.webm',kind:'actual isolated-browser interaction recording',...metadata});}catch(e){videos.push({error:String(e)});}}await report();}
}

// UI labels are completed against the frozen UI before this suite is run.
try {
  await test('기존 7개 의류·편집 초안 보존, 별도 팩 설치·재진입의 무중복',async page=>{
    await nav(page,'코디');await page.locator('.candidate-list').getByRole('button',{name:/블루 데님/}).click();const before=await state(page);assert.equal(before.garments.length,7);
    await openPack(page);const installed=await state(page);assert.equal(installed.garments.filter((g:any)=>g.ownerId===packOwner).length,47);assert.deepEqual(installed.garments.filter((g:any)=>g.ownerId==='demo-profile'),before.garments);assert.deepEqual(installed.outfitDrafts['demo-profile'],before.outfitDrafts['demo-profile']);assert.deepEqual(installed.events,before.events);
    assert.equal(draft(installed).items.top,garment(installed,'T05').id);assert.equal(draft(installed).items.bottom,garment(installed,'B03').id);assert.equal(draft(installed).items.shoes,garment(installed,'S04').id);assert.ok(installed.garments.filter((g:any)=>g.ownerId===packOwner).every((g:any)=>g.location===''&&g.provenance.location==='unconfirmed'));
    const person=await page.locator('.person-stage').getAttribute('data-person-id');assert.equal(person,'DEMO_PERSON01');for(const label of ['홈','옷장','코디','캘린더','케어','마이','홈']){await nav(page,label);assert.equal(await page.locator('.person-stage').getAttribute('data-person-id'),person);await geometry(page);}assert.match(await page.locator('.fixed-scene').innerText(),/시연.*배치|배치.*시연/);assert.match(await page.locator('.fixed-scene').innerText(),/실제.*미확인|원본.*미확인/);await capture(page,'wardrobe-pack-home.png');
    await original(page);assert.deepEqual((await state(page)).outfitDrafts['demo-profile'],before.outfitDrafts['demo-profile']);await openPack(page);const again=await state(page);assert.deepEqual(again.garments,installed.garments);assert.deepEqual(again.outfits,installed.outfits);assert.deepEqual(again.events,installed.events);assert.deepEqual(again.receipts,installed.receipts);assert.deepEqual(again.outfitDrafts[packOwner],installed.outfitDrafts[packOwner]);
  });

  await test('팩 예시 인물·전체 코디 일치, 상의 고정 하의 교체 후 정적 착장·저장·재조회',async page=>{
    await openPack(page);await preset(page,'LOOK02');const before=await state(page);await showPrepared(page);await checkPrepared(page,'LOOK02_knit_denim.png');await capture(page,'wardrobe-pack-look02.png');await page.waitForTimeout(700);await page.getByRole('button',{name:'피팅 종료',exact:true}).click();
    const lock=page.getByRole('button',{name:'고정',exact:true});if(await lock.count())await lock.click();await page.getByLabel(/^바꿀 종류/).selectOption('bottom');await page.locator('.candidate-list').getByRole('button',{name:/블랙 슬랙스/}).click();const changed=await state(page);assert.equal(draft(changed).items.top,draft(before).items.top);assert.equal(draft(changed).items.shoes,draft(before).items.shoes);assert.equal(draft(changed).items.bottom,garment(changed,'B01').id);assert.deepEqual(changed.events,[]);assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');
    await showPrepared(page);await checkPrepared(page,'LOOK03_knit_slacks.png');await capture(page,'wardrobe-pack-look03.png');await page.waitForTimeout(700);await page.getByRole('button',{name:'피팅 종료',exact:true}).click();await page.getByRole('button',{name:'코디 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'코디를 저장했어요'}).waitFor();const saved=await state(page);const receipt=saved.receipts.find((r:any)=>r.ownerId===packOwner&&r.operation==='saveOutfit');assert.ok(receipt);assert.equal(saved.outfits.find((o:any)=>o.id===receipt.entityId).items.bottom,garment(saved,'B01').id);assert.deepEqual(saved.events,[]);await original(page);await openPack(page);assert.deepEqual((await state(page)).outfitDrafts[packOwner],saved.outfitDrafts[packOwner]);assert.deepEqual((await state(page)).receipts,saved.receipts);await page.reload({waitUntil:'networkidle'});assert.deepEqual((await state(page)).receipts,saved.receipts);assert.deepEqual((await state(page)).outfitDrafts[packOwner],saved.outfitDrafts[packOwner]);await showPrepared(page);await checkPrepared(page,'LOOK03_knit_slacks.png');await capture(page,'wardrobe-pack-reloaded.png');await page.waitForTimeout(700);
  },true);

  await test('조합 불일치 결과 미적용, D01 읽기 전용, REGISTER01 기존 T04 중복 방지',async page=>{
    await openPack(page);await preset(page,'LOOK02');await showPrepared(page);await checkPrepared(page,'LOOK02_knit_denim.png');await page.getByRole('button',{name:'피팅 종료',exact:true}).click();await page.getByRole('button',{name:'팩 전체 목록 보기',exact:true}).click();await page.getByLabel(/^바꿀 종류/).selectOption('shoes');await page.locator('.candidate-list').getByRole('button',{name:/화이트 스니커즈/}).click();await showPrepared(page);assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');assert.ok((await page.locator('.person-stage img.person-media').getAttribute('src'))?.endsWith('/demo/LOOK01_sweats.png'));assert.match(await page.locator('#mirror-control-panel').innerText(),/일치하는 준비 결과가 없습니다/);await capture(page,'wardrobe-pack-no-matching-result.png');await nav(page,'옷장');
    const before=await state(page);assert.equal(before.garments.some((g:any)=>g.ownerId===packOwner&&g.asset?.url?.endsWith('/catalog/D01.png')),false);await page.locator('.pack-readonly-item').getByText('블랙 원피스',{exact:true}).waitFor();assert.match(await page.locator('.pack-readonly-item').innerText(),/읽기 전용/);
    await page.getByText('REGISTER01 · 기존 의류 확인 예시',{exact:true}).click();await page.getByRole('button',{name:'REGISTER01 → 기존 T04 확인',exact:true}).click();const after=await state(page);assert.equal(after.garments.filter((g:any)=>g.ownerId===packOwner).length,47);assert.deepEqual(after.receipts,before.receipts);assert.deepEqual(after.events,before.events);assert.equal(after.ui[packOwner].selectedGarmentId,garment(after,'T04').id);await capture(page,'wardrobe-pack-registration-existing-match.png');
  });

  await test('시연 위치 안내는 원본 위치·코디 불변, 인물 변경은 이전 준비 결과 무효화',async page=>{
    await openPack(page);await nav(page,'옷장');await page.getByRole('button',{name:'팩 전체 목록 보기',exact:true}).click();const before=await state(page);
    for(const [id,compartment] of [['T01','left-hanger-a'],['S04','right-shoes'],['T04','left-hanger-a'],['T02','left-hanger-a']]){
      await page.locator(`[data-cabinet-garment-id="${id}"]`).click();assert.deepEqual(await page.locator('[data-led="on"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-compartment-id'))),[compartment]);
      assert.equal(await page.locator(`[data-cabinet-garment-id="${id}"]`).getAttribute('data-real-location-ref'),'');const after=await state(page);assert.deepEqual(after.garments,before.garments);assert.deepEqual(after.outfitDrafts,before.outfitDrafts);assert.deepEqual(after.events,before.events);
    }
    await preset(page,'LOOK02');await showPrepared(page);await checkPrepared(page,'LOOK02_knit_denim.png');const input=await state(page);
    await page.getByLabel('미러 인물 선택',{exact:true}).selectOption('libfile_b7430c83d5fc8191b65e79fb6bd328a7');assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');assert.equal(await page.locator('.person-stage img').count(),0);await page.getByRole('button',{name:'준비된 착장 예시 보기',exact:true}).click();assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');assert.match(await page.locator('#mirror-control-panel').innerText(),/입력 자산을 확인/);assert.deepEqual((await state(page)).outfitDrafts,input.outfitDrafts);
    await page.getByLabel('미러 인물 선택',{exact:true}).selectOption('DEMO_PERSON01');assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');await page.getByRole('button',{name:'준비된 착장 예시 보기',exact:true}).click();await checkPrepared(page,'LOOK02_knit_denim.png');await nav(page,'홈');
    for(const viewport of [{width:1920,height:1080},{width:550,height:442},{width:375,height:667}]){await page.setViewportSize(viewport);await ready(page);await geometry(page);await capture(page,`wardrobe-pack-home-${viewport.width}x${viewport.height}.png`);}
  });
} finally {await browser.close();await report();}
console.log(JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,errors:errors.length,external:external.length,devices:devices.length,deniedApi:deniedApi.length}));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
