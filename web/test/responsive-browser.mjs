import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const checks = [], errors = [];
page.on("pageerror", e => errors.push(e.message));
const origin = process.env.RESPONSIVE_ORIGIN || "http://127.0.0.1:5181";
const metrics = () => page.evaluate(() => {
  const mirror = document.querySelector('.photo-mirror').getBoundingClientRect();
  return { viewport: [innerWidth, innerHeight], mirror: [mirror.x,mirror.y,mirror.width,mirror.height],
    mode: document.querySelector('.photo-wardrobe').dataset.displayMode,
    background: getComputedStyle(document.querySelector('.photo-background')).display,
    led: getComputedStyle(document.querySelector('.photo-led-layer')).display,
    mirrorBackground: getComputedStyle(document.querySelector('.photo-mirror')).backgroundImage,
    horizontal: document.documentElement.scrollWidth > innerWidth };
});
const menu = name => page.getByRole('button', {name, exact:true}).click();
try {
  await page.goto(origin);
  for (const [width,height] of [[360,800],[390,844],[430,932],[767,844],[667,375],[768,844],[1366,768],[1672,941],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.waitForFunction(w => document.querySelector('.photo-wardrobe')?.dataset.displayMode === (w<768?'mobile':'desktop'), width);
    await page.waitForTimeout(150);
    const m = await metrics();
    assert.equal(m.horizontal,false);
    if(width<768){m.mirror.forEach((v,i)=>assert.ok(Math.abs(v-[0,0,width,height][i])<1));assert.equal(m.background,'none');assert.equal(m.led,'none');assert.ok(m.mirrorBackground.includes('wardrobe-base-led-off.png'));}
    else {const scale=Math.min(width/1672,height/941);const expected=[(width-1672*scale)/2+714*scale,(height-941*scale)/2+28*scale,248*scale,824*scale];m.mirror.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1));assert.notEqual(m.background,'none');}
    checks.push(m);
  }
  await page.setViewportSize({width:390,height:844});
  await menu('마이');await menu('내 계정');await menu('시연용 로그인');
  await page.waitForFunction(()=>document.querySelector('[data-profile-id]')?.dataset.profileId.startsWith('20000000'));
  if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
  await menu('옷장');await page.waitForFunction(()=>document.querySelectorAll('[data-garment-id]').length===6 && [...document.querySelectorAll('[data-photo-state]')].every(e=>e.dataset.photoState==='ready'));
  await page.screenshot({path:'test-results/responsive-mobile-wardrobe.png'});
  await page.getByRole('button',{name:'옷 검색',exact:true}).click();await page.getByPlaceholder('옷 이름').fill('없는검색어');assert.equal(await page.locator('[data-garment-id]').count(),0);await page.getByPlaceholder('옷 이름').fill('');
  await menu('사진 등록');assert.equal(await page.locator('.mx-registration').count(),1);
  await page.screenshot({path:'test-results/responsive-mobile-registration.png'});
  await menu('코디');await menu('스타일 보관함');assert.equal(await page.locator('[data-garment-id]').count(),6);
  await menu('쇼핑몰');await menu('내 옷장');await page.locator('[data-garment-id]').first().click();await page.locator('.mow-builder-heading').waitFor();
  const revision=await page.locator('.mx-surface').getAttribute('data-look-revision');
  const profile=await page.evaluate(async()=>(await import('/src/mirror/source/appInstance.ts')).app.getState().activeProfileId);
  const requests=[];const listen=r=>{if(r.url().includes('/api/v1/garments')||r.url().includes('/assets/'))requests.push(new URL(r.url()).pathname)};page.on('request',listen);
  for (const [width,height] of [[1672,941],[390,844],[667,375],[390,844]]) {await page.setViewportSize({width,height});await page.waitForTimeout(300);assert.equal(await page.locator('.mx-surface').getAttribute('data-look-revision'),revision);assert.equal(await page.evaluate(async()=>(await import('/src/mirror/source/appInstance.ts')).app.getState().activeProfileId),profile);}
  page.off('request',listen);assert.deepEqual(requests,[]);
  await page.screenshot({path:'test-results/responsive-mobile-builder.png'});
  await page.setViewportSize({width:667,height:375});await menu('옷장');await menu('사진 등록');await page.getByRole('button',{name:'다음',exact:true}).scrollIntoViewIfNeeded();const nextBox=await page.getByRole('button',{name:'다음',exact:true}).boundingBox();assert.ok(nextBox.y>=0&&nextBox.y+nextBox.height<=375);await page.getByRole('button',{name:'등록 닫기',exact:true}).click();await menu('마이');await page.setViewportSize({width:390,height:844});
  await menu('홈');await page.screenshot({path:'test-results/responsive-mobile-home.png'});
  for(const name of ['캘린더','케어','마이'])await menu(name);
  assert.deepEqual(errors,[]);checks.push({login:true,garments:6,search:true,registration:true,style_tabs:true,selection:true,resize_preserves_draft:true,resize_image_requests:requests,errors});
  console.log(JSON.stringify(checks));
} finally {await writeFile('test-results/responsive-browser.json',JSON.stringify(checks,null,2));await browser.close();}
