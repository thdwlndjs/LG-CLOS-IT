import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('../../test-results/remediation/',import.meta.url));
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1672,height:941}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5193');
 await page.getByRole('button',{name:'마이',exact:true}).click();
 await page.getByRole('button',{name:'내 계정',exact:true}).click();
 await page.getByRole('button',{name:/최휘재.*시연용 로그인/}).click();
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
  if(stats?.total===52&&stats.connection==='supabase')break;await page.waitForTimeout(500);
 }
 assert.equal(stats.total,52);assert.equal(stats.visible,stats.derivative);
 assert.equal(stats.connection,'supabase');
 assert.ok(stats.hanging>0&&stats.folded>0);
 if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'홈',exact:true}).click();
 await page.waitForFunction(n=>document.querySelectorAll('svg[data-scene-item-id]').length===n,stats.visible);
 await page.locator('svg[data-scene-item-id] image').evaluateAll(async nodes=>{
  await Promise.all(nodes.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();}));
 });
 await page.screenshot({path:out+'wardrobe-sprites-applied.png'});
 assert.deepEqual(errors,[]);
 await writeFile(out+'wardrobe-sprites-browser.json',JSON.stringify({stats,errors,result:'PASS',product_photo_ids_preserved:true},null,2));
 console.log(JSON.stringify({stats,errors,result:'PASS'}));
}finally{await browser.close();}
