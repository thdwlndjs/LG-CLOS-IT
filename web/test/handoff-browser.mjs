import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const runtime = JSON.parse(await readFile(fileURLToPath(new URL('../../test-results/handoff/runtime.json',import.meta.url)),'utf8'));
const evidence = fileURLToPath(new URL('../../docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence',import.meta.url));
await mkdir(evidence,{recursive:true});
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1672,height:941}});
const errors=[], checks=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*', route => {
  const url=new URL(route.request().url());
  if (['http:','https:'].includes(url.protocol) && !['localhost','127.0.0.1'].includes(url.hostname)) return route.abort();
  return route.continue();
});
try {
  await page.goto('http://127.0.0.1:5192');
  const ready = await page.request.get('http://127.0.0.1:18080/health/ready');
  assert.equal(ready.status(),200);checks.push({name:'dedicated API readiness',result:'PASS'});
  const probe = JSON.parse(await readFile(fileURLToPath(new URL('../../test-results/handoff/storage-probe.json',import.meta.url)),'utf8'));
  const dimensions = await page.evaluate(async (url) => {
    const {assetUrl}=await import('/src/api.js');
    const image=new Image();image.src=assetUrl(url);
    await image.decode();return [image.naturalWidth,image.naturalHeight];
  },probe.signed_url);
  assert.deepEqual(dimensions,[8,8]);
  checks.push({name:'signed synthetic image via isolated MinIO relay; browser decode',result:'PASS'});
  const menu=name=>page.getByRole('button',{name,exact:true}).click();
  const waitState = async (read) => {
    for(let i=0;i<60;i++) {
      const result=await page.evaluate(read);
      if(result) return result;
      await page.waitForTimeout(500);
    }
    throw Error('Account state did not settle in 30 seconds');
  };
  for (const actor of ['mom','son']) {
    await menu('마이');await menu('내 계정');
    await page.getByLabel('계정',{exact:true}).fill('handoff-'+actor);
    await page.getByLabel('비밀번호',{exact:true}).fill(runtime.demo_password);
    await page.getByRole('button',{name:'내 계정으로 로그인',exact:true}).click();
    const state = await waitState(async()=>{
      const {app}=await import('/src/mirror/source/appInstance.ts');
      if(app.connection.kind!=='supabase' || app.garments().length!==11) return false;
      return {count:app.garments().length, owners:[...new Set(app.garments().map(g=>g.ownerId))],
        locations:app.garments().map(g=>g.location)};
    });
    assert.equal(state.count,11);assert.equal(state.owners.length,2);
    assert.ok(state.locations.every(x=>!x));
    checks.push({name:actor+' login/shared wardrobe/unknown locations',result:'PASS',count:state.count});
    if(await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
    await menu('홈');
    await page.waitForFunction(()=>document.querySelector('[data-scene-status]')?.dataset.sceneStatus==='BLOCKED_CLEAN_PLATE');
    assert.equal(await page.locator('[data-scene-item-id]').count(),0);
    await page.screenshot({path:resolve(evidence,`${actor}-home-blocked-assets.png`)});
    await menu('옷장');
    await page.screenshot({path:resolve(evidence,`${actor}-wardrobe-metadata.png`)});
    await menu('마이');await menu('내 계정');await menu('로그아웃');
    await waitState(async()=>{
      const {currentMember}=await import('/src/mirror/source/integrations/backendClient.ts');
      const {app}=await import('/src/mirror/source/appInstance.ts');
      return currentMember()===null && app.connection.kind==='local';
    });
  }
  await page.setViewportSize({width:390,height:844});await menu('홈');
  await page.waitForFunction(()=>document.querySelector('.photo-wardrobe')?.dataset.displayMode==='mobile');
  await page.screenshot({path:resolve(evidence,'mobile-mirror-handoff.png')});
  assert.equal(errors.length,0);
  checks.push({name:'missing clean plate fails closed; no imaginary garment layer',result:'PASS'});
  await writeFile(resolve(evidence,'handoff-browser.json'),JSON.stringify({checks,uncaught_errors:errors,
    paid_calls:false,product_photos_verified:false,scene_visual_approval:false},null,2));
  console.log(JSON.stringify(checks));
} finally {await browser.close();}
