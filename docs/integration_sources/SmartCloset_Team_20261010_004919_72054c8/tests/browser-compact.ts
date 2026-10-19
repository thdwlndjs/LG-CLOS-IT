import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin='http://127.0.0.1:4311';
const evidence=path.resolve('evidence');
const errors:string[]=[];const external:string[]=[];const results:unknown[]=[];
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-background-networking','--disable-sync','--no-first-run']});
const local=(url:string)=>['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
async function ready(page:Page){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>undefined)));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});}
async function geometry(page:Page){return page.evaluate(()=>({width:innerWidth,height:innerHeight,compact:matchMedia('(max-height:760px)').matches,rects:[...document.querySelectorAll('.home-clock,.home-weather,.daily-look,.home-notices,.mirror-nav button,.demo-footer,.demo-footer button')].map(element=>{const r=element.getBoundingClientRect();return {selector:element.className||element.getAttribute('aria-label')||element.textContent?.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,footer:element.classList.contains('demo-footer'),footerButton:element.matches('.demo-footer button')};}),mirror:(()=>{const r=document.querySelector('.mirror')!.getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()}));}
try{
 await fs.mkdir(evidence,{recursive:true});
 for(const viewport of [{width:643,height:660},{width:375,height:667},{width:614,height:672},{width:1920,height:1080},{width:1080,height:1920}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
  await context.route('**/*',route=>{if(/^https?:/.test(route.request().url())&&!local(route.request().url())){external.push(route.request().url());return route.abort();}return route.continue();});
  await context.routeWebSocket(/.*/,ws=>{if(local(ws.url()))ws.connectToServer();else{external.push(ws.url());ws.close();}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
  await page.goto(origin,{waitUntil:'networkidle'});await ready(page);const home=await geometry(page);
  assert.equal(home.compact,viewport.height<=760);
  assert.ok(home.mirror.top>=0&&home.mirror.bottom<=viewport.height+1,'Mirror fits viewport');
  for(const r of home.rects)assert.ok(r.left>=-1&&r.right<=viewport.width+1&&r.top>=-1&&r.bottom<=viewport.height+1,`Clipped ${JSON.stringify(r)}`);
  for(let i=0;i<home.rects.length;i++)for(let j=i+1;j<home.rects.length;j++){
    const a=home.rects[i],b=home.rects[j];if((a.footer&&b.footerButton)||(b.footer&&a.footerButton))continue;
    const intersects=Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
    assert.equal(intersects,false,`Overlapping ${a.selector} / ${b.selector}: ${JSON.stringify({a,b})}`);
  }
  if(viewport.height<=760){
    await page.screenshot({path:path.join(evidence,viewport.width===643?'home-compact.png':`home-compact-${viewport.width}.png`),fullPage:false});
    await page.getByRole('button',{name:'발표자 도구',exact:true}).click();await page.getByRole('heading',{name:'시연 제어',exact:true}).waitFor();await page.getByRole('button',{name:'발표자 도구 닫기',exact:true}).click();
    await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'옷장',exact:true}).click();await ready(page);
    const before=await page.locator('.mirror-content').evaluate(e=>({scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,scrollTop:e.scrollTop}));assert.ok(before.scrollHeight>before.clientHeight,'Wardrobe must scroll internally');
    await page.locator('.garment-card').last().scrollIntoViewIfNeeded();await ready(page);
    const after=await page.evaluate(()=>{const e=document.querySelector('.mirror-content')!;const last=document.querySelector('.garment-card:last-child')!.getBoundingClientRect();const footer=document.querySelector('.demo-footer')!.getBoundingClientRect();return {scrollTop:e.scrollTop,windowScrollY:scrollY,lastTop:last.top,lastBottom:last.bottom,footerTop:footer.top,footerBottom:footer.bottom};});
    assert.ok(after.scrollTop>0,'Internal wardrobe scrolling works');assert.equal(after.windowScrollY,0,'Outer frame must stay still');assert.ok(after.lastBottom<=after.footerTop+1,'Last garment must not hide behind footer');assert.ok(after.footerBottom<=viewport.height+1,'Footer remains visible');
    await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'마이',exact:true}).click();await page.getByRole('heading',{name:'마이',exact:true}).waitFor();await page.getByRole('heading',{name:'내 계정과 DB 연결',exact:true}).waitFor();await page.getByLabel('이메일',{exact:true}).fill('layout@example.test');assert.equal(await page.getByLabel('이메일',{exact:true}).inputValue(),'layout@example.test');
    results.push({viewport,status:'PASS',home,wardrobe:{before,after},presenterTool:'clickable',myMenu:'clickable'});
  }else results.push({viewport,status:'PASS',compactRuleInactive:true,home});
  await context.close();console.log(`PASS compact-layout ${viewport.width}x${viewport.height}`);
 }
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0,JSON.stringify(external));
}catch(error){errors.push(error instanceof Error?error.stack||error.message:String(error));process.exitCode=1;console.error(error);}finally{
 await browser.close();await fs.writeFile(path.join(evidence,'compact-layout-results.json'),JSON.stringify({generatedAt:new Date().toISOString(),origin,runner:'Playwright / isolated Chrome contexts',scope:'Home geometry at 643x660,375x667,614x672; wardrobe internal scrolling; nav/footer usability; media rule inactive above 760px',results,errors,externalRequests:external},null,2));
}
