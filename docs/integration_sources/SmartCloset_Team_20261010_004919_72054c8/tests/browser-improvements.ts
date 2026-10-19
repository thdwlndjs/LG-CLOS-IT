import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin=process.env.DEMO_URL||'http://127.0.0.1:4311';
const key='smartcloset.stage1.demo.v1';
const output=path.resolve('evidence');
const results:{name:string;status:'PASS'|'FAIL';durationMs:number;error?:string}[]=[];
const browserErrors:{test:string;type:string;message:string}[]=[];
const externalRequests:string[]=[];const deviceCalls:string[]=[];const captures:string[]=[];
let requestCount=0,websocketCount=0;
const isLocal=(url:string)=>['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-background-networking','--disable-sync','--no-first-run']});
await fs.mkdir(output,{recursive:true});
const state=(page:Page)=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),key);
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name,exact:true}).click();
async function configure(page:Page,delay='0',fail=false){await page.getByRole('button',{name:'발표자 도구',exact:true}).click();await page.getByLabel('모의 처리 지연').selectOption(delay);await page.getByRole('checkbox',{name:'모의 처리 오류 재현'}).setChecked(fail);await page.getByRole('button',{name:'발표자 도구 닫기'}).click();}
async function ready(page:Page){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>undefined)));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});}
async function capture(page:Page,name:string){await ready(page);await page.screenshot({path:path.join(output,name),fullPage:false});captures.push(name);}
async function saveOutfit(page:Page){await nav(page,'코디');await page.getByRole('button',{name:'코디 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'코디를 저장했어요'}).waitFor();const s=await state(page);return s.receipts.find((r:any)=>r.operation==='saveOutfit');}
async function plan(page:Page,date:string){await page.getByRole('button',{name:'착용 계획',exact:true}).click();await page.getByLabel('날짜',{exact:true}).fill(date);await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('heading',{name:'캘린더',exact:true}).waitFor();}
async function selectedDate(page:Page,date:string){await page.getByRole('heading',{name:`${date.replaceAll('-','.')}의 기록`,exact:true}).waitFor();const s=await state(page);assert.equal(s.ui[s.activeProfileId].calendarDate,date);}
async function search(page:Page,query:string){await page.getByRole('textbox',{name:'옷 검색',exact:true}).fill(query);await page.waitForFunction(({k,q})=>{const s=JSON.parse(localStorage.getItem(k)!);const u=s.ui[s.activeProfileId];return u.query===q&&['success','no-result'].includes(u.operations.search.status);},{k:key,q:query});}
async function registration(page:Page){await nav(page,'옷장');await page.getByRole('button',{name:'새 옷 등록',exact:true}).click();await page.getByRole('button',{name:'준비된 니트 사진',exact:true}).click();await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();await page.getByRole('status').filter({hasText:'준비된 분석 예시를 적용했어요'}).waitFor();}
async function saveGarment(page:Page){await page.getByRole('button',{name:'내 옷장에 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'저장 확인서'}).waitFor();const s=await state(page);return s.receipts.find((r:any)=>r.operation==='saveGarment');}
async function report(){await fs.writeFile(path.join(output,'improvements-browser-results.json'),JSON.stringify({generatedAt:new Date().toISOString(),origin,runner:'Playwright / locally installed Chrome / isolated contexts',scope:'Six reproduced user-flow regressions plus calendar boundary/cancel and saved receipt preservation',counts:{pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,requests:requestCount,websockets:websocketCount},results,captures,browserErrors,externalRequests,deviceCalls},null,2));}
async function test(name:string,body:(page:Page)=>Promise<void>){
 const started=Date.now(),errorStart=browserErrors.length,externalStart=externalRequests.length,deviceStart=deviceCalls.length;
 const context=await browser.newContext({viewport:{width:1920,height:1080},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
 await context.exposeBinding('__reviewDeviceCall',(_source,method:string)=>deviceCalls.push(method));
 await context.addInitScript({content:`function blockDevice(name){window.__reviewDeviceCall(name);return Promise.reject(new Error('Device API blocked by test: '+name));}Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>blockDevice('getUserMedia'),getDisplayMedia:()=>blockDevice('getDisplayMedia'),enumerateDevices:()=>blockDevice('enumerateDevices')}});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>blockDevice('geolocation'),watchPosition:()=>blockDevice('watchPosition')}});`});
 await context.route('**/*',route=>{const u=route.request().url();if(/^https?:/.test(u)&&!isLocal(u)){externalRequests.push(u);return route.abort();}return route.continue();});
 await context.routeWebSocket(/.*/,ws=>{websocketCount++;if(isLocal(ws.url()))ws.connectToServer();else{externalRequests.push(ws.url());ws.close();}});
 context.on('request',()=>requestCount++);
 const page=await context.newPage();page.setDefaultTimeout(9000);
 page.on('pageerror',e=>browserErrors.push({test:name,type:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error')browserErrors.push({test:name,type:'console',message:m.text()});});page.on('response',r=>{if(r.status()>=400)browserErrors.push({test:name,type:'http',message:`${r.status()} ${r.url()}`});});
 try{await page.goto(origin,{waitUntil:'networkidle'});await configure(page);await body(page);assert.equal(browserErrors.length,errorStart,JSON.stringify(browserErrors.slice(errorStart)));assert.equal(externalRequests.length,externalStart);assert.equal(deviceCalls.length,deviceStart);results.push({name,status:'PASS',durationMs:Date.now()-started});console.log(`PASS ${name}`);}
 catch(e){const error=e instanceof Error?e.stack||e.message:String(e);results.push({name,status:'FAIL',durationMs:Date.now()-started,error});console.error(`FAIL ${name}: ${error}`);await page.screenshot({path:path.join(output,`improvements-failure-${results.length}.png`)}).catch(()=>undefined);}
 finally{await context.close();await report();}
}

try{
await test('다른 달 계획 저장·선택일 새로고침 복원·기존 receipt 보존',async page=>{
 const saved=await saveOutfit(page);await plan(page,'2026-11-02');await selectedDate(page,'2026-11-02');assert.ok((await page.locator('.month-title').innerText()).includes('2026년 11월'));assert.equal(await page.locator('.events article').count(),1);
 const receipts=(await state(page)).receipts;assert.deepEqual(receipts.find((r:any)=>r.id===saved.id),saved);await page.reload({waitUntil:'networkidle'});await selectedDate(page,'2026-11-02');assert.equal(await page.locator('.events article').count(),1);assert.deepEqual((await state(page)).receipts,receipts);await capture(page,'calendar-next-month.png');
 await page.getByRole('button',{name:'이전 달',exact:true}).click();await selectedDate(page,'2026-10-02');await page.getByRole('button',{name:'다음 달',exact:true}).click();await selectedDate(page,'2026-11-02');assert.equal(await page.locator('.events article').count(),1);
});

await test('달력 31일·2월·연도 경계와 날짜 모달 취소 일관성',async page=>{
 await saveOutfit(page);await plan(page,'2026-12-31');await selectedDate(page,'2026-12-31');
 await page.getByRole('button',{name:'다음 달',exact:true}).click();await selectedDate(page,'2027-01-31');await page.getByRole('button',{name:'다음 달',exact:true}).click();await selectedDate(page,'2027-02-28');assert.ok((await page.locator('.month-title').innerText()).includes('2027년 2월'));
 await page.getByRole('button',{name:'이전 달',exact:true}).click();await page.getByRole('button',{name:'2027년 1월 31일',exact:true}).click();await page.getByRole('button',{name:'이전 달',exact:true}).click();await selectedDate(page,'2026-12-31');await page.reload({waitUntil:'networkidle'});await selectedDate(page,'2026-12-31');
 await nav(page,'코디');await page.getByRole('button',{name:'착용 계획',exact:true}).click();await page.getByLabel('날짜',{exact:true}).fill('2028-01-31');await page.getByRole('button',{name:'취소',exact:true}).click();await nav(page,'캘린더');await selectedDate(page,'2026-12-31');
 await nav(page,'코디');await page.getByRole('button',{name:'착용 계획',exact:true}).click();assert.equal(await page.getByLabel('날짜',{exact:true}).inputValue(),'2026-12-31');await page.getByLabel('날짜',{exact:true}).fill('2027-05-15');await page.keyboard.press('Escape');await nav(page,'캘린더');await selectedDate(page,'2026-12-31');assert.equal((await state(page)).events.length,1);
 await nav(page,'코디');await plan(page,'2028-01-31');await page.getByRole('button',{name:'다음 달',exact:true}).click();await selectedDate(page,'2028-02-29');assert.equal((await state(page)).events.length,2);
});

await test('완료한 케어에서 다른 옷 상세·케어로 재진입',async page=>{
 await nav(page,'케어');await page.getByRole('button',{name:'관리 완료 기록',exact:true}).click();await page.getByRole('button',{name:'확인 기록 남기기',exact:true}).click();await page.locator('.care-completion').waitFor();
 await nav(page,'옷장');await page.getByRole('button',{name:/블랙 라이더 재킷/}).click();await page.getByRole('button',{name:'케어 보기',exact:true}).click();await page.getByRole('heading',{name:'케어 알림',exact:true}).waitFor();assert.equal(await page.getByLabel('관리할 옷').inputValue(),'g-jacket');await page.getByRole('heading',{name:'블랙 라이더 재킷',exact:true}).waitFor();await page.getByRole('button',{name:'케어 안내 확인',exact:true}).click();await page.locator('.guide').waitFor();assert.deepEqual((await state(page)).events.map((e:any)=>({kind:e.kind,id:e.garmentId})),[{kind:'care',id:'g-trench'}]);await capture(page,'care-return.png');
});

await test('늦은 검색 실패가 다른 화면·최신 검색 안내를 덮지 않음',async page=>{
 await configure(page,'3000',true);await nav(page,'옷장');await page.getByRole('textbox',{name:'옷 검색',exact:true}).fill('블랙');await nav(page,'코디');await page.waitForTimeout(3200);assert.equal(await page.locator('.feedback').count(),0);
 await nav(page,'옷장');await page.getByRole('textbox',{name:'옷 검색',exact:true}).fill('트렌치');await configure(page,'0',false);await search(page,'데님');await page.waitForTimeout(3200);assert.equal(await page.locator('.feedback').count(),0);assert.deepEqual((await state(page)).ui['demo-profile'].searchResultIds,['g-jeans']);
});

await test('저장·보관 이동 직후 현재 검색 조건의 결과 갱신',async page=>{
 await nav(page,'옷장');await search(page,'버건디');assert.equal(await page.locator('.garment-card').count(),0);await registration(page);const saved=await saveGarment(page);await nav(page,'옷장');assert.equal(await page.getByRole('textbox',{name:'옷 검색',exact:true}).inputValue(),'버건디');await page.getByRole('button',{name:/버건디 니트/}).waitFor();assert.deepEqual((await state(page)).ui['demo-profile'].searchResultIds,[saved.entityId]);
 await search(page,'행거 B');assert.equal(await page.locator('.garment-card').count(),2);await page.getByRole('button',{name:/베이지 트렌치 코트/}).click();await page.getByRole('button',{name:'케어 보기',exact:true}).click();await page.getByRole('button',{name:'보관하기',exact:true}).click();await page.getByRole('button',{name:'확인 기록 남기기',exact:true}).click();await page.locator('.care-completion').waitFor();await nav(page,'옷장');assert.equal(await page.getByRole('textbox',{name:'옷 검색',exact:true}).inputValue(),'행거 B');assert.deepEqual((await state(page)).ui['demo-profile'].searchResultIds,['g-jacket']);assert.equal(await page.locator('.garment-card').count(),1);
});

await test('사진 교체 시 이전 자동 분석값 무효화·수동값 유지',async page=>{
 await registration(page);assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'버건디 니트');await page.getByLabel('보관 위치',{exact:true}).fill('사용자가 확인한 선반');const fixture={name:'different-photo.png',mimeType:'image/png',buffer:await fs.readFile(path.resolve('public/assets/jeans.png'))};await page.getByLabel('의류 사진 파일',{exact:true}).setInputFiles(fixture);await page.getByRole('status').filter({hasText:'사진을 선택했어요'}).waitFor();
 assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('색상',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('보관 위치',{exact:true}).inputValue(),'사용자가 확인한 선반');assert.deepEqual((await state(page)).registrationDrafts['demo-profile'].features,[]);await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();await page.getByRole('status').filter({hasText:'준비 결과 없음'}).waitFor();assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'');await capture(page,'registration-photo-change.png');
 await page.getByLabel('이름',{exact:true}).fill('직접 수정한 이름');await page.getByLabel('색상',{exact:true}).fill('직접 확인한 파랑');await page.getByRole('button',{name:'준비된 니트 사진',exact:true}).click();await page.getByRole('button',{name:'분석 예시 확인',exact:true}).click();await page.getByRole('status').filter({hasText:'준비된 분석 예시를 적용했어요'}).waitFor();await page.getByLabel('의류 사진 파일',{exact:true}).setInputFiles(fixture);await page.getByRole('status').filter({hasText:'사진을 선택했어요'}).waitFor();assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'직접 수정한 이름');assert.equal(await page.getByLabel('색상',{exact:true}).inputValue(),'직접 확인한 파랑');assert.equal(await page.getByLabel('보관 위치',{exact:true}).inputValue(),'사용자가 확인한 선반');
});

await test('저장된 동일 revision 재시도는 모의 오류 대신 기존 ID·receipt 반환',async page=>{
 await registration(page);const receipt=await saveGarment(page);const before=await state(page);await configure(page,'0',true);await page.getByRole('button',{name:'내 옷장에 저장',exact:true}).click();await page.getByRole('status').filter({hasText:receipt.id}).waitFor();assert.deepEqual((await state(page)).receipts,before.receipts);assert.equal((await state(page)).garments.length,before.garments.length);
 await page.reload({waitUntil:'networkidle'});await configure(page,'0',true);await page.getByRole('button',{name:'내 옷장에 저장',exact:true}).click();await page.getByRole('status').filter({hasText:receipt.id}).waitFor();assert.deepEqual((await state(page)).receipts,before.receipts);
 await configure(page);const outfitReceipt=await saveOutfit(page);const saved=await state(page);await configure(page,'0',true);await page.getByRole('button',{name:'코디 저장',exact:true}).click();await page.getByRole('status').filter({hasText:outfitReceipt.id}).waitFor();assert.deepEqual((await state(page)).receipts,saved.receipts);assert.equal((await state(page)).outfits.length,saved.outfits.length);
 await page.locator('.candidate-list').getByRole('button',{name:/블루 데님/}).click();await page.getByRole('button',{name:'코디 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'개발용 모의 오류'}).waitFor();assert.deepEqual((await state(page)).receipts,saved.receipts);assert.equal((await state(page)).outfits.length,saved.outfits.length);
});
}finally{await browser.close();await report();}
console.log(JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,browserErrors:browserErrors.length,externalRequests:externalRequests.length,deviceCalls:deviceCalls.length}));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
