// Actual backend/storage/browser verification. No route interception or preview substitution.
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../node_modules/playwright/index.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const pkg=join(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11');
const out=join(pkg,'reports/b01-common-v1');
const manifest=JSON.parse(await readFile(join(pkg,'templates/b01_common_shelf_manifest.json'),'utf8'));
const trace=JSON.parse(await readFile(join(out,'reference-trace.json'),'utf8'));
const browser=await chromium.launch();const results=[];
try{
 for(const name of ['김수진','최휘재']){
  const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1});
  const page=await context.newPage();let scene;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async r=>{if(r.status()===200&&r.url().endsWith('/scene'))scene=await r.json();});
  await page.goto('http://127.0.0.1:5193');await page.getByRole('button',{name:'마이',exact:true}).click();
  const response=page.waitForResponse(r=>r.url().endsWith('/integration/demo-login'));
  await page.getByRole('button',{name:name+' 프로필 선택',exact:true}).click();
  if((await response).status()!==200)throw Error('Profile login failed');
  await page.getByRole('button',{name:'홈',exact:true}).click();
  await page.waitForFunction(n=>document.querySelector('.mx-home-name')?.textContent.includes(n),name);
  await page.waitForFunction(()=>document.querySelectorAll('[data-scene-item-id]').length===87);
  await page.locator('[data-scene-item-id] image').evaluateAll(async ns=>Promise.all(ns.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();})));
  const measurements=[];
  for(const item of manifest.items){
   const live=scene.items.find(i=>i.garment_id===item.garment_id);if(!live)throw Error('Missing shelf ID');
   if(live.location_id!==item.compartment_id)throw Error('Physical compartment changed');
   if(item.kind==='common'&&live.image.asset_id!==item.derivative_asset_id)throw Error('Real derivative missing');
   const m=await page.locator(`[data-scene-item-id="${item.garment_id}"]`).evaluate(async(n,mask)=>{
    const r=n.getBoundingClientRect(),image=new Image();image.src=n.querySelector('image').getAttribute('href');await image.decode();
    const c=document.createElement('canvas');c.width=Math.ceil(r.width);c.height=Math.ceil(r.height);const ctx=c.getContext('2d');
    const [x,y,w,h]=mask.crop,s=Math.min(r.width/w,r.height/h);
    ctx.translate((r.width-w*s)/2,r.height-h*s);ctx.scale(s,s);ctx.translate(-x,-y);ctx.clip(new Path2D(mask.path));ctx.drawImage(image,0,0,mask.width,mask.height);
    const b=ctx.getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=0,y1=0,col0=c.height,col1=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(b[(y*c.width+x)*4+3]>=240){x0=Math.min(x0,x);x1=Math.max(x1,x+1);y0=Math.min(y0,y);y1=Math.max(y1,y+1);if(x===Math.floor(c.width/2)){col0=Math.min(col0,y);col1=Math.max(col1,y+1);}}
    return {bbox:[r.x+x0,r.y+y0,r.x+x1,r.y+y1],center_column:[r.y+col0,r.y+col1],display:{x:r.x,y:r.y,width:r.width,height:r.height}};
   },live.image_mask);
   measurements.push({...m,garment_id:item.garment_id,bin:item.compartment,side:item.side,layer:item.layer,kind:item.kind,asset_id:live.image.asset_id});
  }
  await page.screenshot({path:join(out,name+'-actual.png')});
  const stacks=[];
  for(const bin of Object.keys(trace.compartments))for(const side of ['left','right']){
   const rows=measurements.filter(i=>i.bin===bin&&i.side===side).sort((a,b)=>a.layer-b.layer);if(rows.length!==3)throw Error('Bad stack count');
   const bbox=[Math.min(...rows.map(r=>r.bbox[0])),Math.min(...rows.map(r=>r.bbox[1])),Math.max(...rows.map(r=>r.bbox[2])),Math.max(...rows.map(r=>r.bbox[3]))];
   const ref=trace.compartments[bin][side],height=(bbox[3]-bbox[1])/(ref[3]-ref[1])-1,width=(bbox[2]-bbox[0])/(ref[2]-ref[0])-1;
   const gap=Math.max(...rows.slice(0,2).map((r,n)=>r.center_column[0]-rows[n+1].center_column[1]));
   const floor=trace.compartments[bin].floor-rows[0].center_column[1];
   stacks.push({bin,side,bbox,width_error_pct:width*100,height_error_pct:height*100,gap_px:gap,floor_gap_px:floor,pass:Math.abs(width)<=.1&&Math.abs(height)<=.1&&gap<=2&&gap>=-3&&floor>=0&&floor<=2});
  }
  const groups=Object.keys(trace.compartments).map(bin=>{const l=stacks.find(s=>s.bin===bin&&s.side==='left'),r=stacks.find(s=>s.bin===bin&&s.side==='right');const ref=trace.compartments[bin];const delta=(r.bbox[0]-l.bbox[2])-(ref.right[0]-ref.left[2]);return{bin,inter_stack_gap_error_px:delta,pass:Math.abs(delta)<=5};});
  if(errors.length)throw Error(errors.join(';'));
  results.push({profile:name,scene_ids:scene.items.map(i=>i.garment_id),measurements,stacks,groups,errors,failed_stacks:stacks.filter(s=>!s.pass)});
  await context.close();
 }
 await writeFile(join(out,'browser.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.map(r=>({profile:r.profile,common:r.measurements.filter(i=>i.kind==='common').length,total:r.measurements.length,failed_stacks:r.failed_stacks.map(s=>({bin:s.bin,side:s.side,gap:s.gap_px,floor:s.floor_gap_px,height:s.height_error_pct})),failed_groups:r.groups.filter(g=>!g.pass)}))));
}finally{await browser.close();}
