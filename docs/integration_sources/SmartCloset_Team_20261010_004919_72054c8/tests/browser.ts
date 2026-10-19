import { chromium, type BrowserContext, type Page } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.DEMO_URL || 'http://127.0.0.1:4311';
const storageKey = 'smartcloset.stage1.demo.v1';
const evidence = path.resolve(process.env.SC_EVIDENCE_DIR||'evidence');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const results: { name: string; status: 'PASS'|'FAIL'; durationMs: number; error?: string }[] = [];
const browserErrors: { test: string; kind: string; message: string }[] = [];
const expectedSignedOut: {test:string;kind:string;message:string;source:'fixture'}[]=[];
const ignoredDevUpdates: {test:string;type:string}[]=[];
const network: { test: string; type: string; url: string; status?: number }[] = [];
const externalRequests: string[] = [];
const deviceAttempts: string[] = [];
const screenshots: string[] = [];
const layoutChecks: unknown[] = [];
const local = (url: string) => { try { const u=new URL(url); return ['127.0.0.1','localhost','[::1]'].includes(u.hostname); } catch { return false; } };
await fs.mkdir(evidence,{recursive:true});
const browser = await chromium.launch({executablePath,headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});

async function snapshot(page:Page) { return page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),storageKey); }
async function ready(page:Page) {
  await page.evaluate(async()=>{ await document.fonts.ready; await Promise.all([...document.images].map(img=>img.decode().catch(()=>undefined))); await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))); });
}
async function checkGeometry(page:Page) {
  const geometry=await page.evaluate(()=>{
    const m=document.querySelector('.mirror')!.getBoundingClientRect();const f=document.querySelector('.demo-footer')!.getBoundingClientRect();
    return {screen:document.querySelector('.mirror-content h1')?.textContent,width:innerWidth,height:innerHeight,mirror:{left:m.left,right:m.right,top:m.top,bottom:m.bottom},footer:{left:f.left,right:f.right,top:f.top,bottom:f.bottom},nav:[...document.querySelectorAll('.mirror-nav button')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})};
  });
  layoutChecks.push(geometry);
  const within=(r:{left:number;right:number;top:number;bottom:number})=>r.left>=-1&&r.right<=geometry.width+1&&r.top>=-1&&r.bottom<=geometry.height+1;
  assert.ok(within(geometry.mirror),`Mirror exceeds viewport: ${JSON.stringify(geometry)}`);
  assert.ok(within(geometry.footer),`Footer clipped: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.nav.every(within),`Navigation clipped: ${JSON.stringify(geometry)}`);
}
async function capture(page:Page,name:string) { await ready(page); await checkGeometry(page); await page.screenshot({path:path.join(evidence,name),fullPage:false}); screenshots.push(name); }
async function nav(page:Page,name:string) { await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name,exact:true}).click();await checkGeometry(page); }
async function configure(page:Page,delay='0',fail=false) {
  await page.getByRole('button',{name:'발표자 도구',exact:true}).click();
  await page.getByLabel('모의 처리 지연').selectOption(delay);
  await page.getByRole('checkbox',{name:'모의 처리 오류 재현'}).setChecked(fail);
  await page.getByRole('button',{name:'발표자 도구 닫기'}).click();
}
async function register(page:Page,name='브라우저 검증 니트') {
  await nav(page,'옷장'); await page.getByRole('button',{name:'새 옷 등록',exact:true}).click();
  await page.getByRole('button',{name:'준비된 니트 사진',exact:true}).click();
  await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();
  await page.getByRole('status').filter({hasText:'준비된 분석 예시를 적용'}).waitFor();
  await page.getByLabel('이름',{exact:true}).fill(name);
  await page.getByLabel('보관 위치',{exact:true}).fill('행거 A · 검증 위치');
}
async function saveGarment(page:Page) {
  await page.getByRole('button',{name:'내 옷장에 저장',exact:true}).click();
  await page.getByRole('status').filter({hasText:'저장 확인서'}).waitFor();
  const s=await snapshot(page); return {state:s,garment:s.garments.find((g:any)=>g.id===s.registrationDrafts[s.activeProfileId].savedGarmentId),receipt:s.receipts.find((r:any)=>r.operation==='saveGarment')};
}
async function saveLook(page:Page) {
  await page.getByRole('button',{name:'코디 저장',exact:true}).click();
  await page.getByRole('status').filter({hasText:'코디를 저장했어요'}).waitFor();
  const s=await snapshot(page);return {state:s,outfit:s.outfits.find((o:any)=>o.id===s.outfitDrafts[s.activeProfileId].savedOutfitId)};
}
async function test(name:string,action:(page:Page,context:BrowserContext)=>Promise<void>) {
  const start=Date.now(); const errorStart=browserErrors.length;
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
  // Plain JavaScript avoids tsx's function-name helpers crossing the browser serialization boundary.
  await context.exposeBinding('__reportDeviceAttempt',(_source,name:string)=>{deviceAttempts.push(name);});
  await context.addInitScript({content:`
    const attempts=[]; window.__deviceAttempts=attempts;
    function report(name) { attempts.push(name); window.__reportDeviceAttempt(name); }
    function blocked(name) { report(name); return Promise.reject(new Error('Test blocked device API: '+name)); }
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>blocked('getUserMedia'),getDisplayMedia:()=>blocked('getDisplayMedia'),enumerateDevices:()=>blocked('enumerateDevices')}});
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>{report('geolocation.getCurrentPosition');},watchPosition:()=>{report('geolocation.watchPosition');return 0;},clearWatch:()=>{}}});
  `});
  await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(/^https?:/i.test(url)&&!local(url)){externalRequests.push(url);await route.abort('blockedbyclient');return;}
    if(/^https?:/i.test(url)&&new URL(url).pathname.startsWith('/api/')){
      // Explicit signed-out transport fixtures: no Auth, DB, asset upload or provider request reaches the app server.
      const pathname=new URL(url).pathname,method=request.method();
      const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(method==='GET'&&pathname==='/api/config')return json({project_ref:'slxgcgtnxkchxywgsmuk',database_configured:true,ai_mode:'mock',live_enabled:false,key_present:{openai_key_present:false,decart_key_present:false,supabase_config_present:true}});
      if(method==='GET'&&pathname==='/api/auth-status')return json({project_ref:'slxgcgtnxkchxywgsmuk',email_password_enabled:true,email_confirmation_required:null});
      if(method==='GET'&&pathname==='/api/session')return json({error:{code:'unauthorized',message:'격리 회귀 테스트: 로그인하지 않은 fixture 세션입니다.'}},401);
      browserErrors.push({test:name,kind:'unexpected-app-api',message:`${method} ${pathname}`});await route.abort('blockedbyclient');return;
    }
    await route.continue();
  });
  await context.routeWebSocket(/.*/,ws=>{
    network.push({test:name,type:'websocket',url:ws.url()});
    if(!local(ws.url())){externalRequests.push(ws.url());ws.close({code:1008,reason:'External connection forbidden in isolated local test'});return;}
    const server=ws.connectToServer();server.onMessage(message=>{
      // Other agents may edit while this isolated context runs. Ignore only Vite HMR mutations, never error frames.
      try{const event=JSON.parse(String(message));if(['update','full-reload','prune'].includes(event.type)){ignoredDevUpdates.push({test:name,type:event.type});return;}}catch{/* Non-JSON application messages still pass through. */}
      ws.send(message);
    });
  });
  context.on('request',request=>network.push({test:name,type:request.resourceType(),url:request.url()}));
  context.on('response',response=>{if(response.status()<400)return;const message=`${response.status()} ${response.url()}`;
    if(response.status()===401&&response.request().method()==='GET'&&new URL(response.url()).pathname==='/api/session'){expectedSignedOut.push({test:name,kind:'http',message,source:'fixture'});return;}
    browserErrors.push({test:name,kind:'http',message});});
  const page=await context.newPage();page.setDefaultTimeout(9000);
  page.on('pageerror',error=>browserErrors.push({test:name,kind:'pageerror',message:error.message}));
  page.on('console',message=>{if(message.type()!=='error')return;const source=message.location().url;
    if(source&&local(source)&&new URL(source).pathname==='/api/session'&&/^Failed to load resource:.*401/.test(message.text())){expectedSignedOut.push({test:name,kind:'console',message:message.text(),source:'fixture'});return;}
    browserErrors.push({test:name,kind:'console',message:message.text()});});
  try {
    await page.goto(origin,{waitUntil:'networkidle'});await ready(page);
    await action(page,context);
    await checkGeometry(page);
    assert.equal(browserErrors.length,errorStart,JSON.stringify(browserErrors.slice(errorStart)));
    results.push({name,status:'PASS',durationMs:Date.now()-start});console.log(`PASS ${name}`);
  } catch(error) {
    const message=error instanceof Error?error.stack||error.message:String(error);
    results.push({name,status:'FAIL',durationMs:Date.now()-start,error:message});console.error(`FAIL ${name}: ${message}`);
    await page.screenshot({path:path.join(evidence,`failure-${results.length}.png`),fullPage:false}).catch(()=>undefined);
  } finally {await context.close();await writeReport();}
}
async function writeReport() {
  await fs.writeFile(path.join(evidence,'browser-results.json'),JSON.stringify({title:'DB·외부 API 미연결 시연 프로토타입',runner:'Playwright with locally installed Chrome, isolated contexts',transport:'Signed-out API fixtures only. Actual Auth/DB/providers are not exercised; unexpected API requests fail.',fittingContract:'Inline panel / missing-input or no-result / stop and reopen. Removed mock fitting button is not an active product path; asynchronous media matching is covered separately by mirror and saved-result contract tests.',origin,executablePath,generatedAt:new Date().toISOString(),viewportChecks:['1920x1080','1080x1920'],counts:{pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length},results,screenshots,browserErrors,expectedSignedOut,ignoredDevUpdates,externalRequests,deviceAttempts,layoutChecks,network},null,2));
}

try {
await test('홈: 가로·세로 렌더와 실제 UI 영역',async page=>{
  await page.getByRole('heading',{name:'오늘의 추천 코디',exact:true}).waitFor();
  await capture(page,'home-landscape.png');
  for(const viewport of [{width:1920,height:1080},{width:1080,height:1920}]){
    await page.setViewportSize(viewport);await ready(page);
    const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,nav:[...document.querySelectorAll('.mirror-nav button')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})}));
    assert.ok(geometry.scrollWidth<=geometry.width,JSON.stringify(geometry));
    assert.ok(geometry.nav.every(r=>r.left>=0&&r.right<=geometry.width&&r.top>=0&&r.bottom<=geometry.height),JSON.stringify(geometry));
  }
  await capture(page,'home-portrait.png');
});

await test('새 의류: 저장→동일 ID/receipt 재시도→새로고침 재조회',async page=>{
  await configure(page);await register(page);await capture(page,'registration.png');
  const first=await saveGarment(page);assert.ok(first.garment);assert.ok(first.receipt);
  const second=await saveGarment(page);assert.equal(second.garment.id,first.garment.id);assert.equal(second.receipt.id,first.receipt.id);assert.equal(second.state.garments.length,first.state.garments.length);
  await page.getByRole('button',{name:'저장한 옷 보기',exact:true}).click();await page.getByRole('heading',{name:'브라우저 검증 니트',exact:true}).waitFor();assert.equal(await page.locator('.detail-line code').textContent(),first.garment.id);
  await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'브라우저 검증 니트',exact:true}).waitFor();assert.equal(await page.locator('.detail-line code').textContent(),first.garment.id);
  await nav(page,'옷장');await capture(page,'wardrobe.png');
});

await test('검색·메뉴·초안: 상태 복원과 연속 q1/q2',async page=>{
  await configure(page);await register(page,'보존할 초안');
  await nav(page,'코디');await nav(page,'옷장');await page.getByRole('button',{name:'새 옷 등록',exact:true}).click();assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'보존할 초안');
  await nav(page,'옷장');await configure(page,'3000');
  await page.getByRole('textbox',{name:'옷 검색',exact:true}).fill('블랙');
  await configure(page,'0');
  await page.getByRole('textbox',{name:'옷 검색',exact:true}).fill('데님');
  await page.waitForFunction(key=>{const s=JSON.parse(localStorage.getItem(key)!);const u=s.ui[s.activeProfileId];return u.query==='데님'&&u.operations.search.status==='success';},storageKey);
  await page.waitForTimeout(3200);
  assert.deepEqual((await snapshot(page)).ui['demo-profile'].searchResultIds,['g-jeans']);
  await nav(page,'홈');await nav(page,'옷장');assert.equal(await page.getByRole('textbox',{name:'옷 검색',exact:true}).inputValue(),'데님');
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('textbox',{name:'옷 검색',exact:true}).inputValue(),'데님');assert.deepEqual((await snapshot(page)).ui['demo-profile'].searchResultIds,['g-jeans']);
});

await test('늦은 분석: 수동 수정과 사진 교체 보존',async page=>{
  await configure(page,'3000');await nav(page,'옷장');await page.getByRole('button',{name:'새 옷 등록',exact:true}).click();await page.getByRole('button',{name:'준비된 니트 사진',exact:true}).click();
  await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();await page.getByLabel('이름',{exact:true}).fill('늦은 분석보다 최신 수동값');
  await page.waitForTimeout(3200);assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'늦은 분석보다 최신 수동값');
  await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();
  await page.getByLabel('의류 사진 파일',{exact:true}).setInputFiles({name:'arbitrary-test.png',mimeType:'image/png',buffer:await fs.readFile(path.resolve('public/assets/jeans.png'))});
  await page.getByRole('status').filter({hasText:'사진을 선택했어요'}).waitFor();const asset=(await snapshot(page)).registrationDrafts['demo-profile'].asset.id;
  await page.waitForTimeout(3200);assert.equal((await snapshot(page)).registrationDrafts['demo-profile'].asset.id,asset);assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'늦은 분석보다 최신 수동값');
});

await test('코디: 상의 고정·하의 교체·저장과 실제 착용 분리',async page=>{
  await configure(page);await nav(page,'코디');const initial=await snapshot(page);const top=initial.outfitDrafts['demo-profile'].items.top;
  await page.getByRole('button',{name:'고정',exact:true}).click();await page.locator('.candidate-list').getByRole('button',{name:/블루 데님/}).click();
  let s=await snapshot(page);assert.equal(s.outfitDrafts['demo-profile'].items.top,top);assert.equal(s.outfitDrafts['demo-profile'].items.bottom,'g-jeans');assert.equal(s.outfitDrafts['demo-profile'].topLocked,true);assert.equal(s.events.length,0);assert.equal(s.outfits.length,initial.outfits.length);
  const saved=await saveLook(page);assert.equal(saved.outfit.items.top,top);assert.equal(saved.outfit.items.bottom,'g-jeans');assert.equal(saved.state.events.length,0);
  const repeat=await saveLook(page);assert.equal(repeat.outfit.id,saved.outfit.id);assert.equal(repeat.state.outfits.length,saved.state.outfits.length);
  await page.reload({waitUntil:'networkidle'});if(!await page.locator('.saved-outfits-panel').evaluate(n=>(n as HTMLDetailsElement).open))await page.locator('.saved-outfits-panel>summary').click();await page.getByRole('heading',{name:'저장된 조합',exact:true}).waitFor();assert.equal((await snapshot(page)).events.length,0);await capture(page,'outfit.png');
});

await test('캘린더: 코디 계획과 실제 착용의 명시적 기록',async page=>{
  await configure(page);await nav(page,'코디');const saved=await saveLook(page);
  await page.getByRole('button',{name:'착용 계획',exact:true}).click();await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('heading',{name:'캘린더',exact:true}).waitFor();
  let s=await snapshot(page);assert.deepEqual(s.events.map((e:any)=>e.kind),['plan']);assert.equal(s.events[0].outfitId,saved.outfit.id);
  await nav(page,'코디');await page.getByRole('button',{name:'실제 착용 기록',exact:true}).click();await page.getByRole('button',{name:'취소',exact:true}).click();assert.equal((await snapshot(page)).events.length,1);
  await page.getByRole('button',{name:'실제 착용 기록',exact:true}).click();await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('heading',{name:'캘린더',exact:true}).waitFor();s=await snapshot(page);assert.deepEqual(s.events.map((e:any)=>e.kind),['plan','wear']);
});

await test('케어: 안내·취소 무변경, 이동·실제 관리 기록 분리',async page=>{
  await configure(page);await nav(page,'케어');const before=await snapshot(page);const location=before.garments.find((g:any)=>g.id==='g-trench').location;
  await page.getByRole('button',{name:'케어 안내 확인',exact:true}).click();await page.locator('.guide').waitFor();assert.equal((await snapshot(page)).events.length,0);assert.equal((await snapshot(page)).garments.find((g:any)=>g.id==='g-trench').location,location);await capture(page,'care.png');
  await page.getByRole('button',{name:'보관하기',exact:true}).click();await page.getByRole('button',{name:'취소',exact:true}).click();assert.equal((await snapshot(page)).events.length,0);
  await page.getByRole('button',{name:'보관하기',exact:true}).click();await page.getByRole('button',{name:'확인 기록 남기기',exact:true}).click();await page.locator('.care-completion').filter({hasText:'보관 이동 기록을 남겼어요'}).waitFor();assert.equal(await page.getByRole('heading',{name:'케어 알림',exact:true}).count(),1);
  let s=await snapshot(page);assert.deepEqual(s.events.map((e:any)=>e.kind),['movement']);assert.equal(s.garments.find((g:any)=>g.id==='g-trench').location,'보관함 · 계절 보관 구역');
  await nav(page,'홈');await nav(page,'케어');await page.getByRole('button',{name:'관리 완료 기록',exact:true}).click();await page.getByRole('button',{name:'확인 기록 남기기',exact:true}).click();await page.locator('.care-completion').filter({hasText:'관리 확인 기록을 남겼어요'}).waitFor();s=await snapshot(page);assert.deepEqual(s.events.map((e:any)=>e.kind),['movement','care']);
});

await test('피팅: 인라인 미적용 안내·요청 없음·종료·재진입과 키보드 포커스',async page=>{
  await configure(page);await nav(page,'코디');const before=await snapshot(page);const requestsBefore=network.filter(n=>n.type!=='websocket'&&new URL(n.url).pathname.startsWith('/api/try-on')).length;
  const opener=page.getByRole('button',{name:'입어보기',exact:true});await opener.focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'선택 코디 피팅',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  await page.waitForFunction(()=>document.activeElement?.textContent==='선택 코디 피팅');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('#mirror-control-panel'))),true);
  await page.keyboard.press('Shift+Tab');
  const focus=await page.evaluate(()=>{const node=document.activeElement as HTMLElement|null;const r=node?.getBoundingClientRect();return {tag:node?.tagName,hidden:!!node?.closest('[hidden],[inert]'),top:r?.top,bottom:r?.bottom,height:innerHeight};});
  assert.notEqual(focus.tag,'BODY');assert.equal(focus.hidden,false);assert.ok(focus.top!==undefined&&focus.top>=0&&focus.bottom!==undefined&&focus.bottom<=focus.height);
  assert.equal(await page.locator('.fitting-state').getAttribute('data-fitting-state'),'missing-input');
  await page.locator('.fitting-state').getByText(/선택 코디 미적용/).waitFor();assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');
  assert.equal(await page.locator('video').count(),0);await capture(page,'fitting-inline-unapplied.png');
  await page.keyboard.press('Escape');await page.getByRole('heading',{name:'오늘의 코디',exact:true}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='입어보기');assert.equal((await snapshot(page)).ui['demo-profile'].operations.tryOn.status,'idle');
  await page.keyboard.press('Enter');await page.getByRole('heading',{name:'선택 코디 피팅',exact:true}).waitFor();await page.getByRole('button',{name:'피팅 종료',exact:true}).click();
  await configure(page,'3000');await page.getByRole('button',{name:'입어보기',exact:true}).click();await page.getByRole('button',{name:'피팅 종료',exact:true}).click();await page.getByRole('button',{name:'입어보기',exact:true}).click();await page.waitForTimeout(3200);
  const after=await snapshot(page);assert.equal(after.ui['demo-profile'].operations.tryOn.status,'idle');assert.deepEqual(after.outfitDrafts,before.outfitDrafts);assert.deepEqual(after.events,before.events);assert.deepEqual(after.receipts,before.receipts);assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');
  assert.equal(network.filter(n=>n.type!=='websocket'&&new URL(n.url).pathname.startsWith('/api/try-on')).length,requestsBefore);
});

await test('모의 오류: 저장 실패 표시·무변경·재시도',async page=>{
  await configure(page);await register(page,'오류 후 재시도');const before=await snapshot(page);await configure(page,'0',true);
  await page.getByRole('button',{name:'내 옷장에 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'개발용 모의 오류'}).waitFor();assert.equal((await snapshot(page)).garments.length,before.garments.length);assert.equal((await snapshot(page)).receipts.length,before.receipts.length);assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'오류 후 재시도');
  await configure(page);const saved=await saveGarment(page);assert.equal(saved.garment.name,'오류 후 재시도');
  await nav(page,'코디');await saveLook(page);await configure(page,'0',true);const fittingBefore=await snapshot(page);await page.getByRole('button',{name:'입어보기',exact:true}).click();
  // The inline path has no local fake-generation action: error mode cannot turn missing inputs into a request or a result.
  await page.locator('.fitting-state').getByText(/선택 코디 미적용/).waitFor();assert.equal(await page.locator('.fitting-state').getAttribute('data-fitting-state'),'missing-input');assert.equal(await page.locator('video').count(),0);assert.deepEqual((await snapshot(page)).outfitDrafts,fittingBefore.outfitDrafts);assert.deepEqual((await snapshot(page)).events,fittingBefore.events);await page.getByRole('button',{name:'피팅 종료',exact:true}).click();
  await configure(page);await page.getByRole('button',{name:'착용 계획',exact:true}).click();await page.getByLabel('날짜',{exact:true}).fill('');await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('dialog').getByRole('status').filter({hasText:'유효한 날짜'}).waitFor();assert.equal((await snapshot(page)).events.length,0);await page.getByRole('button',{name:'취소',exact:true}).click();
});

await test('사용자 사진: 준비 분석 미매칭·메타데이터 저장·reload 재선택',async page=>{
  await configure(page);await nav(page,'옷장');await page.getByRole('button',{name:'새 옷 등록',exact:true}).click();
  await page.getByLabel('의류 사진 파일',{exact:true}).setInputFiles({name:'arbitrary-demo-photo.png',mimeType:'image/png',buffer:await fs.readFile(path.resolve('public/assets/jeans.png'))});
  await page.getByRole('status').filter({hasText:'사진을 선택했어요'}).waitFor();await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();await page.getByRole('status').filter({hasText:'준비 결과 없음'}).waitFor();assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'');
  await page.getByLabel('이름',{exact:true}).fill('직접 입력한 사진');const saved=await saveGarment(page);assert.equal(saved.garment.asset.source,'upload');assert.equal(saved.garment.asset.url,null);
  const raw=await page.evaluate(key=>localStorage.getItem(key)!,storageKey);assert.equal(raw.includes('blob:'),false);assert.equal(raw.includes('data:image'),false);
  await page.reload({waitUntil:'networkidle'});await page.getByText('사진 재선택 필요',{exact:true}).waitFor();assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'직접 입력한 사진');
});

await test('늦은 저장: 취소 후 다른 화면 강제 이동 없음',async page=>{
  await configure(page);await nav(page,'코디');await saveLook(page);await configure(page,'3000');
  await page.getByRole('button',{name:'착용 계획',exact:true}).click();await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('button',{name:'취소',exact:true}).click();await nav(page,'홈');await page.waitForTimeout(3200);
  await page.getByRole('heading',{name:'오늘의 추천 코디',exact:true}).waitFor();const s=await snapshot(page);assert.equal(s.ui['demo-profile'].screen,'home');assert.equal(s.events.filter((e:any)=>e.kind==='plan').length,1);
});

await test('Escape: 케어·일정 모달 종료 후 늦은 완료 화면 덮기 없음',async page=>{
  await configure(page,'3000');await nav(page,'케어');await page.getByRole('button',{name:'보관하기',exact:true}).click();await page.getByRole('button',{name:'확인 기록 남기기',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await nav(page,'홈');await page.waitForTimeout(3200);
  await page.getByRole('heading',{name:'오늘의 추천 코디',exact:true}).waitFor();await nav(page,'케어');await page.getByRole('heading',{name:'케어 알림',exact:true}).waitFor();assert.equal((await snapshot(page)).events.filter((e:any)=>e.kind==='movement').length,1);
  await configure(page);await nav(page,'코디');await saveLook(page);await configure(page,'3000');await page.getByRole('button',{name:'착용 계획',exact:true}).click();await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await nav(page,'홈');await page.waitForTimeout(3200);assert.equal((await snapshot(page)).ui['demo-profile'].screen,'home');assert.equal((await snapshot(page)).events.filter((e:any)=>e.kind==='plan').length,1);
});

await test('추천: 처리 중 조건 고정과 미지원 조건 결과 없음',async page=>{
  await configure(page,'3000');await nav(page,'코디');await page.getByText('추천 조건',{exact:true}).click();await page.getByRole('button',{name:'다른 코디 추천',exact:true}).click();assert.equal(await page.getByLabel(/^날씨/).isDisabled(),true);assert.equal(await page.getByLabel(/^일정/).isDisabled(),true);
  await page.getByRole('status').filter({hasText:'현재 고정 조건에 맞는 준비 예시'}).waitFor();assert.equal(await page.getByLabel(/^날씨/).isDisabled(),false);assert.equal(await page.getByLabel(/^일정/).isDisabled(),false);
  await configure(page);await page.getByLabel(/^날씨/).selectOption('rainy');const before=(await snapshot(page)).outfitDrafts['demo-profile'];await page.getByRole('button',{name:'다른 코디 추천',exact:true}).click();await page.getByRole('status').filter({hasText:'입력에 일치하는 준비 결과 없음'}).waitFor();assert.deepEqual((await snapshot(page)).outfitDrafts['demo-profile'],before);
});

await test('손상 저장: 경고·원문 보존·명시 초기화',async page=>{
  await configure(page);await nav(page,'옷장');const bad=await snapshot(page);bad.garments[0].location=42;const raw=JSON.stringify(bad);
  await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:storageKey,raw});await page.reload({waitUntil:'networkidle'});await page.getByRole('alert').filter({hasText:'손상'}).waitFor();assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),raw);
  await page.getByRole('button',{name:'발표자 도구',exact:true}).click();await page.getByRole('button',{name:'데모 초기화',exact:true}).click();await page.getByRole('button',{name:'초기화 확인',exact:true}).click();await page.getByRole('heading',{name:'오늘의 추천 코디',exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);assert.equal(typeof (await snapshot(page)).garments[0].location,'string');
});

await test('저장 차단: quota 오류와 초기화 실패의 메모리 보존',async page=>{
  await configure(page);await register(page,'차단 후 보존');
  // Raw browser JavaScript avoids tsx injecting a Node-side __name helper inside the serialized assignment.
  await page.evaluate("window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Simulated quota exceeded','QuotaExceededError')};");
  await page.getByRole('button',{name:'내 옷장에 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'로컬 저장 용량'}).waitFor();await page.getByRole('alert').filter({hasText:'로컬 저장 용량'}).waitFor();assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'차단 후 보존');
  await page.getByRole('button',{name:'발표자 도구',exact:true}).click();await page.getByRole('button',{name:'데모 초기화',exact:true}).click();await page.getByRole('button',{name:'초기화 확인',exact:true}).click();await page.getByRole('dialog').getByRole('status').filter({hasText:'초기화 결과를 저장하지 못했습니다'}).waitFor();await page.getByRole('button',{name:'발표자 도구 닫기'}).click();assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'차단 후 보존');
});

assert.equal(externalRequests.length,0,`External requests: ${externalRequests.join(', ')}`);
assert.equal(deviceAttempts.length,0,`Device access attempts: ${deviceAttempts.join(', ')}`);
} finally {await browser.close();await writeReport();}
console.log(JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,browserErrors:browserErrors.length,expectedSignedOut:expectedSignedOut.length,ignoredDevUpdates:ignoredDevUpdates.length,externalRequests:externalRequests.length,deviceAttempts:deviceAttempts.length,screenshots}));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
