import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('../../test-results/remediation/',import.meta.url));
const approved=JSON.parse(await readFile(new URL('../../docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/templates/approved_scene_manifest.json',import.meta.url),'utf8'));
const expectedCount=52+approved.items.length;
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1672,height:941}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5193');
 await page.getByRole('button',{name:'마이',exact:true}).click();
 const login=page.waitForResponse(r=>r.url().endsWith('/integration/demo-login'));
 await page.getByRole('button',{name:'최휘재 프로필 선택',exact:true}).click();
 assert.equal((await login).status(),200);
 let stats;
 for(let i=0;i<60;i++){
  stats=await page.evaluate(async()=>{
   const {api,currentDevice}=await import('/src/mirror/source/integrations/backendClient.ts');
   if(!currentDevice())return null;
   const scene=await api().get('/integration/devices/'+currentDevice()+'/scene');
   const garments=(await api().get('/garments?limit=100')).items;
   const {app}=await import('/src/mirror/source/appInstance.ts');
   return {total:scene.total,visible:scene.items.length,
    connection:app.connection.kind,
    derivative:scene.items.filter(i=>garments.find(g=>g.id===i.garment_id)?.image_asset_id!==i.image.asset_id).length,
    hanging:scene.items.filter(i=>i.image_mask?.scene_alignment==='hanging').length,
    folded:scene.items.filter(i=>i.image_mask?.scene_alignment==='shelf').length};
  });
  if(stats?.total===expectedCount&&stats.connection==='supabase')break;await page.waitForTimeout(500);
 }
 assert.equal(stats.total,expectedCount);assert.equal(stats.visible,stats.derivative);
 assert.equal(stats.visible,approved.items.length);
 assert.equal(stats.connection,'supabase');
 assert.ok(stats.hanging>0&&stats.folded>0);
 if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'홈',exact:true}).click();
 await page.waitForFunction(n=>document.querySelectorAll('svg[data-scene-item-id]').length===n,stats.visible);
 await page.locator('svg[data-scene-item-id] image').evaluateAll(async nodes=>{
  await Promise.all(nodes.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();}));
 });
 await page.screenshot({path:out+'wardrobe-sprites-applied.png'});
 const first=page.locator('[data-scene-hit-id]').first();const selected=await first.getAttribute('data-scene-hit-id');await first.click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-scene-item-id][data-led="on"]').length===1);
 await page.waitForTimeout(350);
 const light=await page.evaluate(id=>{
  const nodes=[...document.querySelectorAll('[data-scene-item-id]')];
  return {selected:getComputedStyle(nodes.find(n=>n.dataset.sceneItemId===id)).filter,
   others:nodes.filter(n=>n.dataset.sceneItemId!==id).map(n=>getComputedStyle(n).filter),
   frame:getComputedStyle(document.querySelector('.photo-db-scene')).filter,
   rectangles:document.querySelectorAll('.photo-scene-led').length};
 },selected);
 assert.equal(light.selected,'brightness(1)');assert.ok(light.others.every(f=>f==='brightness(0.4)'));
 assert.equal(light.frame,'none');assert.equal(light.rectangles,0);
 await page.screenshot({path:out+'wardrobe-selected-light.png'});
 await page.waitForFunction(()=>document.querySelectorAll('[data-scene-item-id][data-led="on"]').length===0,{}, {timeout:16000});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-scene-item-id]')].every(n=>getComputedStyle(n).filter==='brightness(1)'),{}, {timeout:3000});
 assert.ok(await page.locator('[data-scene-item-id]').evaluateAll(ns=>ns.every(n=>getComputedStyle(n).filter==='brightness(1)')));
 // Observe real local DB changes through the existing API, not a client-only slot simulation.
 const movementId=await page.evaluate(mapping=>{return import('/src/mirror/source/integrations/backendClient.ts').then(({currentMember})=>mapping.find(m=>m.owner_id===currentMember().id).garment_id)},approved.mapping);
 const movement=await page.evaluate(async gid=>{
  const {api,currentDevice}=await import('/src/mirror/source/integrations/backendClient.ts');
  const {app}=await import('/src/mirror/source/appInstance.ts');
  const client=api(),device=currentDevice();
  const garment=await client.get('/garments/'+gid);
  const box=(await client.get('/integration/devices/'+device+'/locations')).items.find(l=>l.location_type==='BOX');
  if(!box)throw Error('No registered external box');
  const observe=async(location,confidence)=>{
   await client.send('POST','/garment-observations',{garment_id:gid,location_id:location,sensor_type:'MOCK',confidence,observed_at:new Date().toISOString(),source_id:'approved-scene-browser:'+crypto.randomUUID()});
   await app.reloadRemote();
   return client.get('/integration/devices/'+device+'/scene');
  };
  let hidden,blocked,denied;
  try{
   hidden=!(await observe(box.id,1)).items.some(i=>i.garment_id===gid);
   const uncertain=await observe(garment.location_id,.1);
   const kept=await client.get('/garments/'+gid);
   blocked=kept.location_id===box.id&&!uncertain.items.some(i=>i.garment_id===gid);
   try{
    const led=await client.send('POST','/integration/led-commands',{device_id:device,garment_ids:[gid]});
    denied=!led.anchor_ids.length;
   }catch(e){if(e.status!==409)throw e;denied=true;}
  }finally{await observe(garment.location_id,1);}
  return {hidden,blocked,denied,restored:(await client.get('/integration/devices/'+device+'/scene')).items.some(i=>i.garment_id===gid)};
 },movementId);
 assert.deepEqual(movement,{hidden:true,blocked:true,denied:true,restored:true});
 await page.waitForFunction(n=>document.querySelectorAll('[data-scene-item-id]').length===n,approved.items.length);
 assert.deepEqual(errors,[]);
 await writeFile(out+'wardrobe-sprites-browser.json',JSON.stringify({stats,light,movement,errors,result:'PASS',product_photo_ids_preserved:true},null,2));
 console.log(JSON.stringify({stats,errors,result:'PASS'}));
}finally{await browser.close();}
