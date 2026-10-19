import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {Page} from 'playwright';
import {createSeed, STORAGE_KEY} from '../src/core/seed';

// Fresh browser contexts only. No reset of an existing user's browser or saved records.
const origin=process.env.DEMO_URL||'http://127.0.0.1:4311';
const output=path.resolve(process.env.SC_EVIDENCE_DIR||'evidence');
const ffmpeg=path.resolve('tmp/media-tools/extracted/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');
const ffprobe=path.resolve('tmp/media-tools/extracted/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe');
const videoCache=path.resolve('tmp/mirror-scene-playwright-tools');
const videoTool=path.join(videoCache,'ffmpeg-1011','ffmpeg-win64.exe');
let videoPrepared=false;
try {
  await fs.mkdir(path.dirname(videoTool),{recursive:true});
  await fs.copyFile(ffmpeg,videoTool);
  const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  assert.equal(hash(await fs.readFile(videoTool)),hash(await fs.readFile(ffmpeg)));
  process.env.PLAYWRIGHT_BROWSERS_PATH=videoCache;
  videoPrepared=true;
} catch(error) { console.warn('Recording tool not prepared:',String(error)); }
// Import after selecting the isolated executable cache; no downloaded browser is needed.
const {chromium}=await import('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
await fs.mkdir(output,{recursive:true});
const results:{name:string;status:'PASS'|'FAIL';durationMs:number;error?:string}[]=[];
const errors:{test:string;kind:string;message:string}[]=[];
const expectedUnauthenticated:{test:string;kind:string;message:string}[]=[];
const externalRequests:string[]=[];
const deviceCalls:string[]=[];
const forbiddenCalls:string[]=[];
const screenshots:string[]=[];
const geometryChecks:unknown[]=[];
const videos:unknown[]=[];
const networkPolicy={localHmr:'Vite development socket terminates inside the isolated context; no relay/hot reload during a test.',external:'All external HTTP(S) and websocket attempts are blocked and reported.',device:'Camera, display capture and geolocation calls are instrumented and blocked.'};
let requests=0,localWebsockets=0;
const local=(url:string)=>{try{return ['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);}catch{return false;}};
const snapshot=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),STORAGE_KEY);
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name,exact:true}).click();
const ledIds=(page:Page)=>page.locator('[data-compartment-id][data-led="on"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-compartment-id')).sort());
async function ready(page:Page){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>undefined)));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});}
async function capture(page:Page,name:string){await ready(page);await page.screenshot({path:path.join(output,name),fullPage:false});screenshots.push(name);}
async function geometry(page:Page,label:string){
  await ready(page);
  const g=await page.evaluate(()=>{
    const buttons=[...document.querySelectorAll<HTMLButtonElement>('.mirror-nav button')].map(n=>{const r=n.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {name:n.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:!!hit&&(hit===n||n.contains(hit))};});
    return {width:innerWidth,height:innerHeight,body:{width:document.body.scrollWidth,height:document.body.scrollHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},rects:['.fixed-scene','.storage-left','.mirror','.storage-right','.person-stage','.person-caption','.scene-look-dock','.demo-footer','.panel-toggle','.person-controls','#mirror-control-panel'].map(selector=>{const n=document.querySelector<HTMLElement>(selector)!;const r=n.getBoundingClientRect();return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:!n.hidden&&getComputedStyle(n).display!=='none'};}),personText:[...document.querySelectorAll<HTMLElement>('.person-unavailable > :not(svg)')].filter(n=>n.offsetHeight>0).map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),buttons,scroll:{x:scrollX,y:scrollY}};
  });
  geometryChecks.push({label,...g});
  assert.ok(g.body.width<=g.width+1&&g.body.height<=g.height+1,`Body exceeds viewport: ${JSON.stringify(g)}`);
  assert.ok(g.document.width<=g.width+1&&g.document.height<=g.height+1,`Document exceeds viewport: ${JSON.stringify(g)}`);
  assert.deepEqual(g.scroll,{x:0,y:0});
  for(const r of g.rects.filter(r=>r.visible))assert.ok(r.left>=-1&&r.top>=-1&&r.right<=g.width+1&&r.bottom<=g.height+1&&r.width>0&&r.height>0,`Clipped/empty ${r.selector} at ${label}: ${JSON.stringify(r)}`);
  const [left,mirror,right]=['.storage-left','.mirror','.storage-right'].map(s=>g.rects.find(r=>r.selector===s)!);
  assert.ok(left.right<=mirror.left+1&&mirror.right<=right.left+1,'Three scene regions overlap');
  assert.equal(g.buttons.length,6);
  assert.ok(g.buttons.every(r=>r.left>=0&&r.top>=0&&r.right<=g.width+1&&r.bottom<=g.height+1&&r.reachable),`Menu clipped or obstructed: ${JSON.stringify(g.buttons)}`);
  const caption=g.rects.find(r=>r.selector==='.person-caption')!;
  if(caption.visible)assert.ok(g.personText.every(r=>r.bottom<=caption.top+1||r.top>=caption.bottom-1||r.right<=caption.left||r.left>=caption.right),`Person placeholder text overlaps caption at ${label}: ${JSON.stringify({caption,text:g.personText})}`);
}
async function zeroDelay(page:Page){await page.getByRole('button',{name:'발표자 도구',exact:true}).click();await page.getByLabel('모의 처리 지연').selectOption('0');await page.getByRole('button',{name:'발표자 도구 닫기'}).click();}
async function inspect(page:Page,id:string,expected:string){await page.locator(`[data-cabinet-garment-id="${id}"]`).click();assert.deepEqual(await ledIds(page),[expected]);assert.equal(await page.locator(`[data-cabinet-garment-id="${id}"]`).getAttribute('aria-pressed'),'true');assert.equal((await snapshot(page)).ui['demo-profile'].selectedGarmentId,id);}
async function report(){await fs.writeFile(path.join(output,'mirror-scene-browser-results.json'),JSON.stringify({generatedAt:new Date().toISOString(),origin,runner:'Playwright / installed Chrome / fresh isolated contexts',scope:'Fixed mirror scene geometry, actual selections/LED, saved outfit, missing-input fitting, keyboard and motion preference',limits:['Latest female/male source photographs and new garment pack are unavailable; person integration is NOT verified.','No camera, external providers, paid calls, DB writes, or production deployment were performed.','550x442 is viewport reflow approximately equivalent to a 200% zoom footprint, not a claim of actual browser zoom validation.','Video records real isolated-browser actions; it is separate from the operator’s manual CUA recording.','Fresh signed-out contexts may receive GET /api/session 401. Expected HTTP and console entries are retained separately, not reported as zero console output.'],counts:{pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,requests,localWebsockets},results,errors,expectedUnauthenticated,externalRequests,deviceCalls,forbiddenCalls,screenshots,geometryChecks,videoPrepared,videos,networkPolicy},null,2));}
async function test(name:string,body:(page:Page)=>Promise<void>,options:{width?:number;height?:number;record?:boolean;reducedMotion?:boolean}={}){
  const start=Date.now(),errorStart=errors.length,externalStart=externalRequests.length,deviceStart=deviceCalls.length,forbiddenStart=forbiddenCalls.length;
  const context=await browser.newContext({viewport:{width:options.width??1101,height:options.height??884},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block',reducedMotion:options.reducedMotion?'reduce':'no-preference',...(options.record&&videoPrepared?{recordVideo:{dir:path.resolve('tmp/mirror-scene-recordings'),size:{width:1101,height:884}}}:{})});
  await context.exposeBinding('__sceneDeviceAttempt',(_source,method:string)=>deviceCalls.push(method));
  await context.addInitScript({content:`if(location.protocol.startsWith('http')&&!localStorage.getItem(${JSON.stringify(STORAGE_KEY)}))localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(createSeed()))});function stopDevice(method){window.__sceneDeviceAttempt(method);return Promise.reject(new Error('Device API blocked in isolated test: '+method));}Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>stopDevice('getUserMedia'),getDisplayMedia:()=>stopDevice('getDisplayMedia'),enumerateDevices:()=>stopDevice('enumerateDevices')}});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>stopDevice('geolocation'),watchPosition:()=>stopDevice('watchPosition')}});`});
  await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&!local(url)){externalRequests.push(url);return route.abort();}if(/\/api\/(fitting|styles|labels|registrations|garments|outfits|events|evidence-items)(\/|\?|$)/.test(url)){forbiddenCalls.push(url);return route.abort();}return route.continue();});
  // Vite's dev-only HMR socket terminates in this isolated context. No code hot-reload
  // or provider socket may change a scenario while assertions/video are in progress.
  await context.routeWebSocket(/.*/,ws=>{if(local(ws.url())&&new URL(ws.url()).pathname==='/'){localWebsockets++;ws.onMessage(()=>{});}else{externalRequests.push(ws.url());ws.close();}});
  context.on('request',()=>requests++);
  const page=await context.newPage();page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push({test:name,kind:'pageerror',message:e.message}));
  page.on('console',m=>{if(m.type()==='error'){const entry={test:name,kind:'console',message:`${m.text()} ${m.location().url}`};if(m.location().url===`${origin}/api/session`&&m.text().includes('401'))expectedUnauthenticated.push(entry);else errors.push(entry);}});
  page.on('response',r=>{if(r.status()>=400){const entry={test:name,kind:'http',message:`${r.status()} ${r.url()}`};if(r.url()===`${origin}/api/session`&&r.status()===401)expectedUnauthenticated.push(entry);else errors.push(entry);}});
  try{await page.goto(origin,{waitUntil:'networkidle'});await ready(page);await body(page);assert.equal(errors.length,errorStart,JSON.stringify(errors.slice(errorStart)));assert.equal(externalRequests.length,externalStart);assert.equal(deviceCalls.length,deviceStart);assert.equal(forbiddenCalls.length,forbiddenStart);results.push({name,status:'PASS',durationMs:Date.now()-start});console.log(`PASS ${name}`);}
  catch(error){const message=error instanceof Error?error.stack||error.message:String(error);results.push({name,status:'FAIL',durationMs:Date.now()-start,error:message});console.error(`FAIL ${name}: ${message}`);await capture(page,`mirror-scene-failure-${results.length}.png`).catch(()=>undefined);}
  finally{const video=page.video();await context.close();if(video){const target=path.join(output,'mirror-scene-flow.webm');try{await video.saveAs(target);const info=JSON.parse(execFileSync(ffprobe,['-v','error','-count_frames','-show_entries','format=duration,size:stream=codec_name,width,height,nb_read_frames','-of','json',target],{encoding:'utf8'}));videos.push({file:'mirror-scene-flow.webm',kind:'actual automated browser interaction recording',...info});}catch(e){videos.push({file:'mirror-scene-flow.webm',validationError:String(e)});}}await report();}
}

try {
  for(const [width,height] of [[1101,884],[1920,1080],[900,650],[1101,500],[550,442],[375,667]])await test(`고정 3영역·6메뉴·화면 경계 ${width}x${height}`,async page=>{
    const initial=(await snapshot(page)).outfitDrafts['demo-profile'];
    const person=await page.locator('.person-stage').getAttribute('data-person-id');
    for(const menu of ['홈','옷장','코디','캘린더','케어','마이','홈']){await nav(page,menu);await geometry(page,`${width}x${height}/${menu}`);assert.equal(await page.locator('.person-stage').getAttribute('data-person-id'),person);assert.deepEqual((await snapshot(page)).outfitDrafts['demo-profile'],initial);}
    await capture(page,`mirror-scene-home-${width}x${height}.png`);
    await nav(page,'옷장');const panel=page.locator('#mirror-control-panel');await panel.hover();await page.mouse.wheel(0,900);await page.waitForTimeout(100);assert.ok(await panel.evaluate(n=>n.scrollTop>0),'Wardrobe panel did not scroll');await geometry(page,`${width}x${height}/옷장 내부 스크롤`);
    if(width===375)assert.equal(await page.locator('.narrow-scene-notice').isVisible(),true);
  },{width,height});

  await test('실제 선택→다른 칸·같은 칸 LED→상의 고정·하의 교체→저장·재조회',async page=>{
    await zeroDelay(page);const before=await snapshot(page);assert.deepEqual(await ledIds(page),[]);
    await inspect(page,'g-shoes','right-shoes');await page.waitForTimeout(650);
    await inspect(page,'g-jacket','left-hanger-b');await page.waitForTimeout(650);
    await inspect(page,'g-trench','left-hanger-b');assert.equal(await page.locator('[data-cabinet-garment-id="g-jacket"]').getAttribute('aria-pressed'),'false');await page.waitForTimeout(650);
    await inspect(page,'g-slacks','left-hanger-d');await page.waitForTimeout(650);await inspect(page,'g-jeans','left-hanger-d');await page.waitForTimeout(650);
    const inspected=await snapshot(page);assert.deepEqual(inspected.outfitDrafts,before.outfitDrafts);assert.deepEqual(inspected.events,before.events);assert.deepEqual(inspected.garments,before.garments);
    await nav(page,'옷장');await page.locator('.garment-card[data-garment-id="g-shoes"]').click();assert.deepEqual(await ledIds(page),['right-shoes']);await page.getByRole('button',{name:'수납 칸 LED로 위치 보기',exact:true}).click();assert.deepEqual(await ledIds(page),['right-shoes']);
    await nav(page,'코디');await page.getByRole('button',{name:'고정',exact:true}).click();await page.locator('.candidate-list').getByRole('button',{name:/블루 데님/}).click();
    const comparison=await page.evaluate(()=>({previewBottom:document.querySelector('.outfit-preview')!.getBoundingClientRect().bottom,editorTop:document.querySelector('.outfit-editor')!.getBoundingClientRect().top}));assert.ok(comparison.previewBottom<=comparison.editorTop+1,`Scrolled preview covers outfit controls: ${JSON.stringify(comparison)}`);
    const changed=await snapshot(page);assert.equal(changed.outfitDrafts['demo-profile'].items.top,before.outfitDrafts['demo-profile'].items.top);assert.equal(changed.outfitDrafts['demo-profile'].items.bottom,'g-jeans');assert.equal(changed.outfitDrafts['demo-profile'].topLocked,true);assert.deepEqual(changed.events,[]);assert.deepEqual(await ledIds(page),['left-hanger-d']);
    await page.locator('.scene-look-dock').getByRole('button',{name:'전체 위치',exact:true}).click();assert.deepEqual(await ledIds(page),['left-hanger-b','left-hanger-d','right-shelf-c','right-shelf-f','right-shoes']);
    await page.getByRole('button',{name:'코디 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'코디를 저장했어요'}).waitFor();const saved=await snapshot(page);const receipt=saved.receipts.find((r:{operation:string})=>r.operation==='saveOutfit');assert.ok(receipt?.entityId);assert.equal(saved.outfits.find((o:{id:string})=>o.id===receipt.entityId).items.bottom,'g-jeans');assert.deepEqual(saved.events,[]);
    await capture(page,'mirror-scene-outfit-saved.png');await page.waitForTimeout(800);
    await page.reload({waitUntil:'networkidle'});const restored=await snapshot(page);assert.deepEqual(restored.receipts,saved.receipts);assert.deepEqual(restored.outfitDrafts,saved.outfitDrafts);assert.deepEqual(restored.events,[]);assert.equal(await page.locator('[data-dock-garment-id="g-jeans"]').count(),1);assert.deepEqual(await ledIds(page),['left-hanger-d']);
    await page.locator('.scene-look-dock').getByRole('button',{name:'피팅',exact:true}).click();await page.getByRole('heading',{name:'선택 코디 피팅',exact:true}).waitFor();assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');await capture(page,'mirror-scene-fitting-missing-input.png');await page.waitForTimeout(800);await page.getByRole('button',{name:'피팅 종료',exact:true}).click();await geometry(page,'saved requery');
  },{record:true});

  await test('새 의류의 미확인 위치는 선택되어도 LED 꺼짐·코디와 기록 유지',async page=>{
    await zeroDelay(page);await inspect(page,'g-jacket','left-hanger-b');const before=await snapshot(page);await nav(page,'옷장');await page.getByRole('button',{name:'새 옷 등록',exact:true}).click();await page.getByRole('button',{name:'준비된 니트 사진',exact:true}).click();await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();await page.getByRole('status').filter({hasText:'준비된 분석 예시를 적용했어요'}).waitFor();await page.getByLabel('이름',{exact:true}).fill('위치 미확인 검사 니트');await page.getByLabel('보관 위치',{exact:true}).fill('');await page.getByRole('button',{name:'내 옷장에 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'저장 확인서'}).waitFor();const registered=await snapshot(page);const id=registered.registrationDrafts['demo-profile'].savedGarmentId;assert.ok(id);await nav(page,'옷장');await page.locator(`.garment-card[data-garment-id="${id}"]`).click();assert.deepEqual(await ledIds(page),[]);assert.equal(await page.locator('.location-readout').getAttribute('data-location-status'),'unknown');assert.match(await page.locator('.location-readout').innerText(),/미확인/);assert.equal(await page.locator(`[data-cabinet-garment-id="${id}"]`).count(),0);assert.deepEqual((await snapshot(page)).outfitDrafts,before.outfitDrafts);assert.deepEqual((await snapshot(page)).events,[]);await capture(page,'mirror-scene-location-unknown.png');
  });

  await test('인물 자산 미확보·피팅 입력 미확인·선택 변경·메뉴 왕복 정직 표시',async page=>{
    const before=await snapshot(page);assert.equal(await page.locator('.person-media').count(),0);assert.match(await page.locator('.person-unavailable').innerText(),/인물 사진 연결 대기/);
    await page.getByLabel('미러 인물 선택',{exact:true}).selectOption('libfile_8932c1d171f48191b619f7ad9e21c59a');await nav(page,'코디');await page.getByRole('button',{name:'입어보기',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.fitting-state').getAttribute('data-fitting-state'),'missing-input');assert.match(await page.locator('.fitting-issues').innerText(),/인물.*원본 사진/);assert.match(await page.locator('#mirror-control-panel').innerText(),/입력 자산을 먼저 연결/);assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');assert.equal(await page.locator('.person-media').count(),0);
    await page.getByRole('button',{name:'피팅 종료',exact:true}).click();await nav(page,'홈');assert.equal(await page.getByLabel('미러 인물 선택').inputValue(),'libfile_8932c1d171f48191b619f7ad9e21c59a');assert.deepEqual((await snapshot(page)).outfitDrafts,before.outfitDrafts);assert.deepEqual((await snapshot(page)).events,[]);
  });

  await test('키보드 Tab·Space·Enter 패널 토글·모달 포커스와 reduced-motion',async page=>{
    const toggle=page.locator('.panel-toggle');await toggle.focus();await page.keyboard.press('Space');assert.equal(await page.locator('#mirror-control-panel').isVisible(),false);assert.equal(await toggle.evaluate(n=>n===document.activeElement),true);await geometry(page,'panel closed reduced-motion');await page.keyboard.press('Enter');assert.equal(await page.locator('#mirror-control-panel').isVisible(),true);await page.keyboard.press('Tab');assert.equal(await page.getByLabel('미러 인물 선택').evaluate(n=>n===document.activeElement),true);
    const wardrobe=page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'옷장',exact:true});await wardrobe.focus();await page.keyboard.press('Space');assert.equal((await snapshot(page)).ui['demo-profile'].screen,'wardrobe');const outfit=page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'코디',exact:true});await outfit.focus();await page.keyboard.press('Enter');assert.equal((await snapshot(page)).ui['demo-profile'].screen,'outfit');
    const tools=page.getByRole('button',{name:'발표자 도구',exact:true});await tools.focus();await page.keyboard.press('Enter');assert.equal(await page.getByRole('dialog').count(),1);for(let i=0;i<15;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),true);}await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await tools.evaluate(n=>n===document.activeElement),true);
    await inspect(page,'g-jacket','left-hanger-b');const reduced=await page.evaluate(()=>({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,animated:[...document.querySelectorAll('.fixed-scene *')].filter(n=>{const s=getComputedStyle(n);return (s.animationName!=='none'&&s.animationDuration!=='0s')||s.transitionDuration.split(',').some(x=>parseFloat(x)>0);}).length}));assert.deepEqual(reduced,{matches:true,animated:0});await geometry(page,'keyboard final reduced-motion');
  },{reducedMotion:true});
} finally {await browser.close();await report();}
console.log(JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,errors:errors.length,externalRequests:externalRequests.length,deviceCalls:deviceCalls.length,forbiddenCalls:forbiddenCalls.length,videoPrepared}));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
