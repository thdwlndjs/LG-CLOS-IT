// Browser-only preview. Intercepts THREE Scene items; no backend asset registration.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=dirname(fileURLToPath(import.meta.url)),root=resolve(out,'../../../../..');
const {chromium}=await import(pathToFileURL(join(root,'web/node_modules/playwright/index.mjs')));
const manifest=JSON.parse(await readFile(join(out,'samples.json'),'utf8'));
const trace=JSON.parse(await readFile(join(out,'reference-trace.json'),'utf8'));
const asData=(bytes,mime)=>`data:${mime};base64,${bytes.toString('base64')}`;
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1});
 const page=await context.newPage();let baselineScene;const requests=[],errors=[];
 page.on('request',r=>{if(r.url().includes('/api/v1/'))requests.push({method:r.method(),path:new URL(r.url()).pathname});});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/local-storage/wardrobe-assets/assets/b01-poc-v1/*',async route=>{
  const file=new URL(route.request().url()).pathname.split('/').at(-1);
  await route.fulfill({status:200,contentType:'image/png',body:await readFile(join(out,file))});
 });
 await page.route('**/api/v1/integration/devices/*/scene',async route=>{
  const response=await route.fetch();if(response.status()!==200)return route.fulfill({response});
  const scene=await response.json();baselineScene=structuredClone(scene);
  for(const sample of manifest.samples){
   const i=scene.items.find(i=>i.garment_id===sample.garment);if(!i)throw Error('Missing approved garment');
   const p=sample.placement;
   i.image={...i.image,asset_id:`00000000-0000-4000-8000-${sample.id.replace('REM-','').padStart(12,'0')}`,read_url:`http://localhost:9000/wardrobe-assets/assets/b01-poc-v1/${sample.id}-side-v1.png`};
   i.image_mask={width:640,height:180,crop:[0,0,640,180],path:'M0 0h640v180h-640z',scene_alignment:'shelf'};
   i.geometry={x:p.x/1672,y:p.y/941,width:p.width/1672,height:p.height/941,z_index:p.z_index};
  }
  await route.fulfill({response,json:scene});
 });
 await page.goto('http://127.0.0.1:5193');await page.getByRole('button',{name:'마이',exact:true}).click();
 const login=page.waitForResponse(r=>r.url().endsWith('/integration/demo-login'));
 await page.getByRole('button',{name:'최휘재 프로필 선택',exact:true}).click();if((await login).status()!==200)throw Error('Login failed');
 await page.getByRole('button',{name:'홈',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.mx-home-name')?.textContent.includes('최휘재'));
 await page.waitForFunction(()=>document.querySelectorAll('[data-scene-item-id]').length===87);
 await page.locator('[data-scene-item-id] image').evaluateAll(async ns=>Promise.all(ns.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();})));
 await page.screenshot({path:join(out,'app-three-samples.png')});
 const display=[];
 for(const s of manifest.samples){
  const r=await page.locator(`[data-scene-item-id="${s.garment}"]`).boundingBox();
  display.push({id:s.id,garment_id:s.garment,compartment_id:baselineScene.items.find(i=>i.garment_id===s.garment).location_id,display:r});
 }
 const unchanged=baselineScene.items.filter(i=>!manifest.samples.some(s=>s.garment===i.garment_id)).map(i=>i.garment_id);
 if(unchanged.length!==84)throw Error('Unexpected preview replacement count');
 const unexpected=requests.filter(r=>r.method!=='GET'&&!r.path.endsWith('/integration/demo-login'));
 if(errors.length||unexpected.length)throw Error('Unexpected browser errors/mutations');
 // A separate measurement fixture: 3 repetitions of each of the THREE samples,
 // not new garments, and not represented as app inventory or backend integration.
 const fixture=await browser.newPage({viewport:{width:1672,height:941},deviceScaleFactor:1});
 const frame=asData(await readFile(join(root,'web/public/assets/remediation/wardrobe-clean-plate-v1.png')),'image/png');
 const svg=async(reference=false,annotated=false)=>{
  const source=reference?asData(await readFile(join(root,trace.reference)),'image/png'):frame;
  let markup=`<svg xmlns="http://www.w3.org/2000/svg" width="1672" height="941"><image href="${source}" width="1672" height="941"/>`;
  for(const s of manifest.samples){
   const c=trace.compartments[s.compartment];
   if(!reference)for(const side of ['left','right']){
    const ref=c[side],w=ref[2]-ref[0],b=s.raster.opaque_bbox,scale=w/(b[2]-b[0]),h=(b[3]-b[1])*scale;
    for(let layer=0;layer<3;layer++)markup+=`<image data-trial="${s.id}:${side}:${layer}" href="${asData(await readFile(join(out,s.id+'-side-v1.png')),'image/png')}" x="${ref[0]-b[0]*scale}" y="${c.floor-1-h*(layer+1)-b[1]*scale}" width="${640*scale}" height="${180*scale}"/>`;
   }
   if(annotated){
    for(const side of ['left','right']){const [x,y,x1,y1]=c[side];markup+=`<rect x="${x}" y="${y}" width="${x1-x}" height="${y1-y}" fill="none" stroke="#29dfb6" stroke-width="1"/>`;}
    markup+=`<path d="M${c.left[0]-4} ${c.floor}H${c.right[2]+4}" stroke="#ffce49" stroke-width="1"/>`;
   }
  }
  return markup+'</svg>';
 };
 for(const [name,ref,ann] of [['reference-traced.png',true,true],['trial-stacks.png',false,false],['trial-stacks-traced.png',false,true]]){
  await fixture.setContent(`<style>html,body{margin:0}</style>${await svg(ref,ann)}`);
  await fixture.locator('svg image').evaluateAll(async ns=>Promise.all(ns.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();})));
  await fixture.screenshot({path:join(out,name)});
 }
 const crops={E2:{x:990,y:184,width:275,height:96},E4:{x:990,y:415,width:275,height:104},F2:{x:1298,y:185,width:300,height:99}};
 for(const [name,ref] of [['reference',true],['trial',false]]){
  await fixture.setContent(`<style>html,body{margin:0}</style>${await svg(ref,false)}`);
  await fixture.locator('svg image').evaluateAll(async ns=>Promise.all(ns.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();})));
  for(const s of manifest.samples)await fixture.screenshot({path:join(out,`${s.id}-${name}-shelf.png`),clip:crops[s.compartment]});
 }
 // Compare original and local derivative at a useful size; originals remain untouched.
 await fixture.setViewportSize({width:1200,height:1040});
 let comparison='<style>body{margin:0;background:#eee;font:14px Arial}.row{display:grid;grid-template-columns:300px 300px 540px;gap:10px;height:330px;padding:8px}img{width:100%;height:280px;object-fit:contain}.new{background:repeating-conic-gradient(#eee 0% 25%,#ddd 0% 50%) 0/16px 16px}</style>';
 const legacy=JSON.parse(await readFile(join(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/b01/asset-measurements.json'),'utf8')).mapping;
 const spriteManifest=JSON.parse(await readFile(join(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/templates/wardrobe_sprite_manifest.json'),'utf8'));
 for(const s of manifest.samples){
  const old=Object.values(legacy).flat().find(v=>v.id===s.garment),batch=spriteManifest.batches.find(b=>b.items.some(i=>i.item_id===s.id));
  const atlas=asData(await readFile(join(root,`assets/wardrobe-scene-sprites/${batch.batch}-v1.png`)),'image/png');
  comparison+=`<div class="row"><div>${s.id} original<img src="${asData(await readFile(join(root,`test-results/remediation/source-images/${s.id}.jpg`)),'image/jpeg')}"/></div><div>Legacy frontal fold<svg width="300" height="280" viewBox="${old.crop.join(' ')}"><image href="${atlas}" width="1536" height="1024"/></svg></div><div>Local side-fold v1 (checkerboard transparency)<img class="new" src="${asData(await readFile(join(out,s.id+'-side-v1.png')),'image/png')}"/></div></div>`;
 }
 await fixture.setContent(comparison);await fixture.locator('img').evaluateAll(async ns=>Promise.all(ns.map(i=>i.decode())));
 await fixture.screenshot({path:join(out,'source-legacy-side-comparison.png')});
 const measurements=[];
 for(const s of manifest.samples){
  const c=trace.compartments[s.compartment],box=s.raster.opaque_bbox;
  const stacks=[];
  for(const side of ['left','right']){
   const ref=c[side],scale=(ref[2]-ref[0])/(box[2]-box[0]),h=(box[3]-box[1])*scale;
   const actual=await fixture.evaluate(async({url,ref,scale,h,floor,box})=>{
    const img=new Image();img.src=url;await img.decode();
    const cv=document.createElement('canvas');cv.width=1672;cv.height=941;const ctx=cv.getContext('2d');
    let gap=0;const center=Math.round((ref[0]+ref[2])/2),bounds=[];
    for(let layer=0;layer<3;layer++){
     ctx.clearRect(0,0,1672,941);
     ctx.drawImage(img,ref[0]-box[0]*scale,floor-1-h*(layer+1)-box[1]*scale,640*scale,180*scale);
     const p=ctx.getImageData(0,0,1672,941).data;let x0=1672,y0=941,x1=0,y1=0,colMin=941,colMax=0;
     for(let y=Math.floor(floor-h*3-10);y<floor+5;y++)for(let x=Math.floor(ref[0]-5);x<ref[2]+5;x++){
      if(p[(y*1672+x)*4+3]>=240){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);if(x===center){colMin=Math.min(colMin,y);colMax=Math.max(colMax,y+1);}}
     }
     bounds.push({bbox:[x0,y0,x1,y1],center_column:[colMin,colMax]});
    }
    for(let i=0;i<2;i++)gap=Math.max(gap,bounds[i].center_column[0]-bounds[i+1].center_column[1]);
    return {bbox:[Math.min(...bounds.map(b=>b.bbox[0])),Math.min(...bounds.map(b=>b.bbox[1])),Math.max(...bounds.map(b=>b.bbox[2])),Math.max(...bounds.map(b=>b.bbox[3]))],center_inter_layer_gap_px:gap,floor_gap_px:floor-bounds[0].center_column[1],layers:bounds};
   },{url:asData(await readFile(join(out,s.id+'-side-v1.png')),'image/png'),ref,scale,h,floor:c.floor,box});
   const b=actual.bbox;stacks.push({side,...actual,width_px:b[2]-b[0],height_px:b[3]-b[1],width_deviation_pct:100*((b[2]-b[0])/(ref[2]-ref[0])-1),height_deviation_pct:100*((b[3]-b[1])/(ref[3]-ref[1])-1)});
  }
  const actualGap=stacks[1].bbox[0]-stacks[0].bbox[2];
  measurements.push({id:s.id,stacks,size_pass:stacks.every(t=>Math.abs(t.height_deviation_pct)<=10&&Math.abs(t.width_deviation_pct)<=10),inter_stack_gap_px:actualGap,inter_stack_gap_deviation_px:actualGap-(c.right[0]-c.left[2]),inter_layer_gap_px:Math.max(...stacks.map(t=>t.center_inter_layer_gap_px)),floor_gap_px:Math.max(...stacks.map(t=>t.floor_gap_px)),transparent_background:s.raster.transparent_pixels>0,opaque_surface:s.raster.opaque_pixels>0,mode:'isolated repeated-sample trial, not completed app shelf; actual Canvas alpha>=240 pixels, central-column contact'});
 }
 await writeFile(join(out,'verification.json'),JSON.stringify({measurements,app:{preview_only:true,replaced_items:display,other_items_preserved:unchanged.length,errors,unexpected_mutations:unexpected},limits:['No real Scene/DB mapping changes','Other35 legacy cells except3 remain frontal','Isolated stack repetition is not new garment inventory','Visual and material fidelity requires separate review']},null,2));
 console.log(JSON.stringify({samples:display.length,other_scene_items:unchanged.length,geometry_pass:measurements.every(m=>m.size_pass),errors}));
}finally{await browser.close();}
