import {chromium,type Page} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const origin=process.env.DEMO_URL||'http://127.0.0.1:4311';
const out=path.resolve(process.env.SMARTCLOSET_EVIDENCE_DIR||'evidence/mirror-ux-final-20261009');
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
const page=await browser.newPage({viewport:{width:800,height:700}}),errors:string[]=[],external:string[]=[],results:{name:string;status:string;error?:string}[]=[];
page.setDefaultTimeout(5000);page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}if(url.pathname==='/__pager_fixture__')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:24px;font:16px sans-serif;color:#35482b}button{font:inherit}.fixture-actions{display:flex;gap:8px;margin-bottom:16px}output{display:block;margin-bottom:20px}.fixture-card{width:100%;height:190px;border:1px solid #bbc7aa;border-radius:12px;background:#edf2e4;color:#405836;font-size:24px}.horizontal-pager__page input{box-sizing:border-box;width:100%;font:inherit;padding:6px}.fixture-actions button{padding:9px}</style></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@vite/client"></script><script type="module" src="/tests/horizontal-pager-fixture.tsx"></script></body></html>'});return route.continue();});
await page.goto(origin+'/__pager_fixture__',{waitUntil:'networkidle'});
const viewport=page.locator('.horizontal-pager__viewport'),track=page.locator('.horizontal-pager__track');
const state=()=>page.locator('#fixture-state').evaluate(e=>({...((e as HTMLElement).dataset)}));
const matrix=()=>track.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41);
const waitIndex=async(value:number)=>{await page.waitForFunction(n=>document.querySelector('#fixture-state')?.getAttribute('data-index')===String(n),value);await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});};
const reset=async()=>{await page.getByRole('button',{name:'초기화',exact:true}).click();await page.locator('#fixture-width').evaluate(e=>(e as HTMLElement).style.width='285px');await waitIndex(0);};
const start=async()=>{const box=(await viewport.boundingBox())!;const point={x:box.x+box.width*.55,y:box.y+65};await page.mouse.move(point.x,point.y);await page.mouse.down();return point;};
const move=async(point:{x:number;y:number},dx:number,dy=0)=>page.mouse.move(point.x+dx,point.y+dy,{steps:5});
async function check(name:string,run:()=>Promise<void>){try{await reset();await run();results.push({name,status:'PASS'});console.log('PASS',name);}catch(error){results.push({name,status:'FAIL',error:String(error)});console.error('FAIL',name,String(error));}finally{await page.mouse.up();}}
await check('tap threshold, 1:1 drag, short settle and next tap',async()=>{
 const point=await start();assert.equal((await state()).selections,'0');
 await move(point,-7);assert.ok(Math.abs(await matrix())<.1);
 await move(point,-18);assert.ok(Math.abs((await matrix())+18)<.5);assert.equal(await track.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 await page.waitForTimeout(150);await page.mouse.up();await waitIndex(0);assert.equal((await state()).selections,'0');
 await page.locator('[data-card="A"]').click();assert.equal((await state()).selected,'A');assert.equal((await state()).selections,'1');
});
await check('a swipe browses exactly one card without selecting',async()=>{
 const point=await start();await move(point,-90);await page.mouse.up();await waitIndex(1);
 assert.equal((await state()).selected,'none');assert.equal((await state()).selections,'0');assert.equal((await state()).browses,'1');
});
await check('a fast small flick advances but a sub-12px movement cannot',async()=>{
 await viewport.dispatchEvent('pointerdown',{pointerId:9,isPrimary:true,button:0,clientX:180,clientY:150});
 await viewport.dispatchEvent('pointermove',{pointerId:9,isPrimary:true,buttons:1,clientX:169,clientY:150});await viewport.dispatchEvent('pointerup',{pointerId:9,isPrimary:true,button:0,clientX:169,clientY:150});await waitIndex(0);assert.equal((await state()).selections,'0');
 const point=await start();await move(point,-25);await page.mouse.up();await waitIndex(1);assert.equal((await state()).selections,'0');
});
await check('vertical movement never browses or clicks a card',async()=>{
 const point=await start();await move(point,3,45);await page.mouse.up();await waitIndex(0);assert.equal((await state()).selections,'0');
});
await check('edge resistance is bounded and reversals do not wrap',async()=>{
 const point=await start();await move(point,100);assert.ok(Math.abs((await matrix())-18)<.5);
 await move(point,-90);await move(point,70);await page.mouse.up();await waitIndex(0);assert.equal((await state()).selections,'0');
 await page.getByRole('button',{name:'외부 마지막장'}).click();await waitIndex(2);const last=await start(),before=await matrix();await move(last,-100);assert.ok(Math.abs((await matrix())-before+18)<.5);await page.mouse.up();await waitIndex(2);
});
await check('keyboard browsing, inert pages and Enter/Space selection',async()=>{
 await viewport.focus();await page.keyboard.press('ArrowRight');await waitIndex(1);assert.equal((await state()).selections,'0');
 assert.equal(await page.locator('[data-page-index="0"]').getAttribute('inert'),'');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-card')),'B');
 await page.keyboard.press('Enter');assert.equal((await state()).selected,'B');
 await page.keyboard.press('ArrowLeft');await waitIndex(0);assert.equal(await page.evaluate(()=>document.activeElement?.className),'horizontal-pager__viewport');
 await page.keyboard.press('Space');assert.equal((await state()).selected,'A');assert.equal((await state()).selections,'2');
});
await check('previous/next taps only browse and form controls own their keys',async()=>{
 await page.getByRole('button',{name:'시험 의류 다음',exact:true}).click();await waitIndex(1);assert.equal((await state()).selections,'0');
 await page.getByRole('button',{name:'시험 의류 이전',exact:true}).click();await waitIndex(0);
 await viewport.focus();await page.keyboard.press('End');await waitIndex(2);await page.getByLabel('메모').fill('변경 메모');await page.keyboard.press('ArrowLeft');assert.equal((await state()).index,'2');assert.equal(await page.getByLabel('메모').inputValue(),'변경 메모');
});
await check('pointercancel and lost capture restore geometry and suppress one stale click',async()=>{
 for(const type of ['pointercancel','lostpointercapture']){
 await viewport.dispatchEvent('pointerdown',{pointerId:8,isPrimary:true,button:0,clientX:180,clientY:150});await viewport.dispatchEvent('pointermove',{pointerId:8,isPrimary:true,buttons:1,clientX:90,clientY:150});await viewport.dispatchEvent(type,{pointerId:8,isPrimary:true});
 await page.locator('[data-card="A"]').dispatchEvent('click',{detail:1});await waitIndex(0);assert.equal((await state()).selections,'0');assert.equal(await page.locator('.horizontal-pager').getAttribute('data-dragging'),'false');await viewport.dispatchEvent('pointerup',{pointerId:8,isPrimary:true,button:0,clientX:90,clientY:150});
 }await page.locator('[data-card="A"]').click();assert.equal((await state()).selections,'1');
});
await check('resize during drag cancels it without selection or index change',async()=>{
 const point=await start();await move(point,-70);await page.locator('#fixture-width').evaluate(e=>(e as HTMLElement).style.width='240px');
 await page.waitForFunction(()=>document.querySelector('.horizontal-pager')?.getAttribute('data-dragging')==='false');assert.equal((await state()).active,'true');await page.mouse.up();await waitIndex(0);
 assert.equal((await state()).selections,'0');assert.ok(Math.abs(await matrix())<.5);assert.equal((await state()).active,'false');
});
await check('pinch policy and a second touch cancel the active drag',async()=>{
 assert.match(await viewport.evaluate(e=>getComputedStyle(e).touchAction),/pan-y/);assert.match(await viewport.evaluate(e=>getComputedStyle(e).touchAction),/pinch-zoom/);
 await viewport.dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,pointerType:'touch',button:0,clientX:170,clientY:150});await viewport.dispatchEvent('pointermove',{pointerId:1,isPrimary:true,pointerType:'touch',buttons:1,clientX:120,clientY:150});
 await viewport.dispatchEvent('pointerdown',{pointerId:2,isPrimary:false,pointerType:'touch',button:0,clientX:190,clientY:150});assert.equal(await page.locator('.horizontal-pager').getAttribute('data-dragging'),'false');
 await viewport.dispatchEvent('pointercancel',{pointerId:1,isPrimary:true,pointerType:'touch'});await viewport.dispatchEvent('pointercancel',{pointerId:2,isPrimary:false,pointerType:'touch'});await waitIndex(0);assert.equal((await state()).active,'false');
});
await check('reduced motion still browses and selects',async()=>{
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await track.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 await viewport.focus();await page.keyboard.press('ArrowRight');await waitIndex(1);await page.keyboard.press('Enter');assert.equal((await state()).selected,'B');await page.emulateMedia({reducedMotion:'no-preference'});
});
await check('external index changes and unmount clean an in-progress gesture',async()=>{
 const point=await start();await move(point,-50);await page.getByRole('button',{name:'외부 마지막장'}).evaluate((e:HTMLButtonElement)=>e.click());await waitIndex(2);assert.equal(await page.locator('.horizontal-pager').getAttribute('data-dragging'),'false');await page.mouse.up();assert.equal((await state()).selections,'0');
 const next=await start();await move(next,50);await page.getByRole('button',{name:'닫기',exact:true}).evaluate((e:HTMLButtonElement)=>e.click());await page.mouse.up();assert.equal(await page.locator('.horizontal-pager').count(),0);assert.equal((await state()).active,'false');
});
await check('zero peek uses a complete page width and keeps the inter-page gap outside it',async()=>{
 await page.getByRole('button',{name:'전체 폭',exact:true}).click();const box=(await viewport.boundingBox())!,card=(await page.locator('[data-page-index="0"]').boundingBox())!;assert.ok(Math.abs(card.width-box.width)<.5);
 await page.getByRole('button',{name:'시험 의류 다음',exact:true}).click();await waitIndex(1);const next=(await page.locator('[data-page-index="1"]').boundingBox())!;assert.ok(Math.abs(next.x-box.x)<.5);assert.ok(Math.abs(next.width-box.width)<.5);assert.equal((await state()).selections,'0');
});
await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'horizontal-pager-results.json'),JSON.stringify({results,errors,external},null,2));
console.log(JSON.stringify({results,errors,external},null,2));await browser.close();assert.equal(results.filter(r=>r.status==='FAIL').length,0);assert.equal(errors.length,0);assert.equal(external.length,0);
