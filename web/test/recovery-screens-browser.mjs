// Recovered local environment QA. No VTON, upload, seed or hardware requests.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../node_modules/playwright/index.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const origin='http://127.0.0.1:5196';
const out=join(root,'test-results/recovery-normalization/browser');
const inventory=JSON.parse(await readFile(join(root,'test-results/reconstruction-plans/approved104-v1.json'),'utf8'));
const expected=new Set([...inventory.left21,...inventory.right66.map(i=>i.garment_id)]);
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const result=[];
try {
 for(const [key,name] of [['mom','김수진'],['son','최휘재']]) {
  const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1});
  const record={profile:name,errors:[],httpErrors:[],blockedWrites:[],external:[],screens:[]};
  let scene;
  await context.route('**/*',route=>{
   const request=route.request(),u=new URL(request.url());
   if(!['127.0.0.1','localhost'].includes(u.hostname)){record.external.push(u.hostname);return route.abort();}
   if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!u.pathname.endsWith('/integration/demo-login')){
    record.blockedWrites.push({method:request.method(),path:u.pathname});return route.abort();
   }
   return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>record.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')record.errors.push(message.text());});
  page.on('response',async response=>{
   if(response.status()>=400)record.httpErrors.push({status:response.status(),path:new URL(response.url()).pathname});
   if(response.status()===200&&response.url().endsWith('/scene'))scene=await response.json();
  });
  try {
   await page.goto(origin);
   await page.getByRole('button',{name:'마이',exact:true}).click();
   const logged=page.waitForResponse(r=>r.url().endsWith('/integration/demo-login')&&r.request().method()==='POST');
   await page.getByRole('button',{name:name+' 프로필 선택',exact:true}).click();
   assert.equal((await logged).status(),200,'demo profile login');
   await page.getByRole('button',{name:'홈',exact:true}).click();
   await page.waitForFunction(n=>document.querySelector('.mx-home-name')?.textContent.includes(n),name);
   await page.waitForFunction(()=>document.querySelectorAll('[data-scene-item-id]').length===87);
   assert.ok(scene,'actual scene API response');
   assert.equal(scene.items.length,87);
   const actual=new Set(scene.items.map(i=>i.garment_id));
   assert.deepEqual([...actual].sort(),[...expected].sort());
   for(const item of inventory.right66){
    const live=scene.items.find(i=>i.garment_id===item.garment_id);
    assert.equal(live.location_id,item.compartment_id);
    const apiGeometry = Object.fromEntries(['x','y','width','height','z_index'].map(key=>[key,item.geometry[key]]));
    assert.deepEqual(live.geometry,apiGeometry);
    assert.equal(live.image.asset_id,item.derivative_asset_id);
   }
   const measurements=await page.locator('[data-scene-item-id]').evaluateAll(async nodes=>Promise.all(nodes.map(async node=>{
    const image=node.matches('img')?node:node.querySelector('image');
    const decoded=new Image();decoded.src=image.getAttribute('href')||image.getAttribute('src');await decoded.decode();
    const rect=node.getBoundingClientRect();const style=getComputedStyle(node);
    return {id:node.getAttribute('data-scene-item-id'),width:rect.width,height:rect.height,x:rect.x,y:rect.y,
      decoded:decoded.naturalWidth>0,visible:rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&rect.right>0&&rect.left<innerWidth&&rect.bottom>0&&rect.top<innerHeight};
   })));
   assert.equal(measurements.filter(i=>i.decoded&&i.visible).length,87);
   assert.equal(new Set(measurements.map(i=>i.id)).size,87);
   record.desktop={right:inventory.right66.length,left:inventory.left21.length,measurements};
   await page.screenshot({path:join(out,key+'-desktop-home.png')});
   const hits=await page.locator('[data-scene-hit-id]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.sceneHitId,rect:{width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}})));
   assert.equal(hits.length,87);record.desktop.hits=hits;
   await page.setViewportSize({width:390,height:844});
   await page.waitForFunction(()=>document.querySelector('.photo-wardrobe')?.dataset.displayMode==='mobile');
   record.mobile=await page.evaluate(()=>{
    const parent=document.querySelector('.photo-db-scene');
    return {display:getComputedStyle(parent).display,visibleItems:[...document.querySelectorAll('[data-scene-item-id]')].filter(n=>n.getBoundingClientRect().width>0).length,
     activeHitAreas:[...document.querySelectorAll('[data-scene-hit-id]')].filter(n=>n.getBoundingClientRect().width>0).length,
     sceneIntercepts:[[50,150],[195,400],[350,700]].some(([x,y])=>document.elementFromPoint(x,y)?.closest('.photo-db-scene')!==null)};
   });
   assert.equal(record.mobile.display,'none');assert.equal(record.mobile.visibleItems,0);assert.equal(record.mobile.activeHitAreas,0);assert.equal(record.mobile.sceneIntercepts,false);
   for(const [route,label] of [['home','홈'],['wardrobe','옷장'],['outfit','코디'],['calendar','캘린더'],['care','케어'],['my','마이']]){
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.waitForTimeout(500);
    await page.screenshot({path:join(out,key+'-mobile-'+route+'.png')});
    const nav=page.getByRole('button',{name:label,exact:true});
    assert.equal(await nav.getAttribute('aria-current'),'page','navigation route must become active');
    const box=await nav.boundingBox();assert.ok(box&&box.width>0&&box.height>0);
    record.screens.push({route,label,navBox:box});
   }
   await page.setViewportSize({width:1672,height:941});
   await page.waitForFunction(()=>document.querySelector('.photo-wardrobe')?.dataset.displayMode==='desktop');
   await page.getByRole('button',{name:'홈',exact:true}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-scene-item-id]')].filter(n=>n.getBoundingClientRect().width>0).length===87);
   await page.screenshot({path:join(out,key+'-desktop-restored.png')});
   record.restoredDesktop=true;
   assert.deepEqual(record.errors,[]);assert.deepEqual(record.httpErrors,[]);assert.deepEqual(record.blockedWrites,[]);assert.deepEqual(record.external,[]);
   record.pass=true;
  } catch(error){record.pass=false;record.failure=error.stack;await page.screenshot({path:join(out,key+'-failure.png')}).catch(()=>{});}
  finally {result.push(record);await context.close();}
 }
}finally {await browser.close();await writeFile(join(out,'results.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify(result.map(r=>({profile:r.profile,pass:r.pass,failure:r.failure,errors:r.errors,httpErrors:r.httpErrors,blockedWrites:r.blockedWrites}))));
if(result.some(r=>!r.pass))process.exitCode=1;
