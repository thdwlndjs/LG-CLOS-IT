// Offline SVG common-form production for the user-approved B-01 contract.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../node_modules/playwright/index.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const pkg=join(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11');
const out=join(pkg,'reports/b01-common-v1');await mkdir(out,{recursive:true});
const input=JSON.parse(await readFile(join(out,'catalog.json'),'utf8'));
const prior=JSON.parse(await readFile(join(pkg,'reports/b01-poc-v1/samples.json'),'utf8'));
const template=await readFile(join(pkg,'reports/b01-poc-v1/REM-11-side-v1.svg'),'utf8');
const products=JSON.parse(await readFile(join(pkg,'templates/remediation_products.json'),'utf8')).items;
const trace={basis:'Manual visual tracing of wardrobe-reference.png; independent of scene seed geometry',coordinate_space:[1672,941],uncertainty_px:2,compartments:{
 E1:{floor:152,left:[1008,100,1113,151],right:[1131,100,1244,151]},
 E2:{floor:265,left:[1007,211,1116,264],right:[1132,215,1244,264]},
 E3:{floor:389,left:[1008,331,1115,388],right:[1131,330,1244,388]},
 E4:{floor:503,left:[1007,443,1118,501],right:[1132,445,1245,502]},
 F1:{floor:152,left:[1310,100,1425,151],right:[1449,101,1560,151]},
 F2:{floor:267,left:[1311,215,1423,265],right:[1450,214,1563,266]},
 F3:{floor:390,left:[1310,334,1426,389],right:[1450,333,1565,389]},
 F4:{floor:507,left:[1310,445,1428,505],right:[1449,445,1565,505]},
 F5:{floor:616,left:[1310,550,1423,614],right:[1449,558,1563,614]},
 F6:{floor:725,left:[1310,657,1423,724],right:[1449,660,1563,724]},
 F7:{floor:844,left:[1310,763,1425,842],right:[1449,769,1568,842]}
}};
// Freeze the independent reference before computing or rasterizing placements.
await writeFile(join(out,'reference-trace.json'),JSON.stringify(trace,null,2));
const sha=b=>createHash('sha256').update(b).digest('hex');
const data=(b,mime)=>`data:${mime};base64,${b.toString('base64')}`;
const existingPath=join(pkg,'templates/b01_common_shelf_manifest.json');
let previous;try{previous=JSON.parse(await readFile(existingPath,'utf8'));}catch{}
const browser=await chromium.launch();const items=[],stacks=[];
try{
 const page=await browser.newPage({viewport:{width:640,height:180},deviceScaleFactor:1});
 const approvedMasks=new Map();
 for(const g of input.items.filter(g=>!g.attributes.product_reference?.item_id?.startsWith('REM-'))){
  const sprite=g.metadata.scene_sprites.folded;
  if(approvedMasks.has(sprite.asset_id))continue;
  const k=g.name.includes('SAND')?'K1':g.name.includes('NAVY')?'K2':g.name.includes('CHARCOAL')?'K3':null;
  if(!k)throw Error('Unknown approved source');
  const png=await readFile(join(root,`assets/wardrobe-scene-sprites/approved-v1/${k}.png`));
  const crop=await page.evaluate(async({url,mask})=>{
   const i=new Image();i.src=url;await i.decode();const c=document.createElement('canvas');c.width=mask.width;c.height=mask.height;const ctx=c.getContext('2d');ctx.clip(new Path2D(mask.path));ctx.drawImage(i,0,0);
   const p=ctx.getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=0,y1=0;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(p[(y*c.width+x)*4+3]>=240){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}return[x0,y0,x1-x0,y1-y0];
  },{url:data(png,'image/png'),mask:sprite.mask});
  approvedMasks.set(sprite.asset_id,{...sprite.mask,crop});
 }
 for(let start=0;start<66;start+=3){
  const group=input.items.slice(start,start+3),bin=group[0].compartment.split(' ')[0],side=start%6===0?'left':'right';
  const ref=trace.compartments[bin][side],floor=trace.compartments[bin].floor;
  const common=group.map(g=>Boolean(g.attributes.product_reference?.item_id?.startsWith('REM-')));
  const refWidth=ref[2]-ref[0],targetH=ref[3]-ref[1];
  const ratios=group.map((g,n)=>{if(common[n])return 96/576;const crop=approvedMasks.get(g.metadata.scene_sprites.folded.asset_id).crop;return crop[3]/crop[2];});
  // Rendering boxes may extend slightly beyond the opaque envelope due to
  // interpolation/curved edges. Acceptance measures actual opaque pixels.
  let factor=Math.max(.91,Math.min(1.112,targetH/(ratios.reduce((a,b)=>a+b,0)*refWidth)));
  if(common.some(Boolean))factor=.91;
  const widths=group.map((g,n)=>common[n]?refWidth:refWidth*factor);
  if(!common.some(Boolean)&&widths.reduce((sum,w,n)=>sum+w*ratios[n],0)>targetH*1.1){
   // Preserve image aspect ratios. The thinnest cloth stays full-width; the
   // thicker garments may fold to a narrower width within the SAME compartment.
   const thin=ratios.indexOf(Math.min(...ratios));widths[thin]=refWidth*.99;
   const restRatio=ratios.reduce((sum,r,n)=>sum+(n===thin?0:r),0);
   const restWidth=(targetH*1.085-widths[thin]*ratios[thin])/restRatio;
   if(restWidth>=refWidth*.82)for(let n=0;n<3;n++)if(n!==thin)widths[n]=restWidth;
  }
  const kHeight=group.reduce((sum,g,n)=>sum+(common[n]?0:widths[n]*ratios[n]),0);
  const cCount=common.filter(Boolean).length,commonHeight=(targetH-kHeight)/cCount;
  let y=floor-1;
  for(let layer=0;layer<3;layer++){
   const g=group[layer],kind=common[layer]?'common':'approved',source=g.attributes.product_reference?.item_id;
   const width=widths[layer],height=kind==='common'?commonHeight:width*ratios[layer];
   if(!(height>0))throw Error('No viable stack height');
   const x=side==='left'?ref[2]-width:ref[0];y-=height;
   const item={garment_id:g.id,source_asset_id:g.image_asset_id,source_sha256:g.metadata.checksum_sha256,source_location_id:g.source_location_id,compartment_id:g.compartment_id,compartment:bin,side,layer,kind,name:g.name,display_width:width,display_height:height};
   let crop;
   if(kind==='common'){
    const p=products.find(p=>p.item_id===source);if(!p)throw Error('Missing source product');
    const bytes=await readFile(join(root,`test-results/remediation/source-images/${source}.jpg`));
    if(sha(bytes)!==g.metadata.checksum_sha256)throw Error('Source checksum mismatch');
    const palette=await page.evaluate(async({url,mask,pattern})=>{
     const i=new Image();i.src=url;await i.decode();const c=document.createElement('canvas');c.width=384;c.height=384;const ctx=c.getContext('2d');
     ctx.save();ctx.clip(new Path2D(mask.path));ctx.drawImage(i,0,0,384,384);ctx.restore();
     const b=ctx.getImageData(0,0,384,384).data,bins=new Map();
     for(let n=0;n<b.length;n+=4)if(b[n+3]>=240){const key=[b[n]>>4,b[n+1]>>4,b[n+2]>>4].join(',');const v=bins.get(key)||[0,0,0,0];v[0]++;v[1]+=b[n];v[2]+=b[n+1];v[3]+=b[n+2];bins.set(key,v);}
     const top=[...bins.values()].sort((a,b)=>b[0]-a[0])[0];const rgb=top.slice(1).map(n=>Math.round(n/top[0]));
     let patch;
     if(pattern){const cv=document.createElement('canvas');cv.width=384;cv.height=320;cv.getContext('2d').drawImage(i,i.width*.53,i.height*.43,i.width*.25,i.height*.21,0,0,384,320);patch=cv.toDataURL('image/png');}
     return {rgb,patch};
    },{url:data(bytes,'image/jpeg'),mask:p.display_mask,pattern:['REM-23','REM-25'].includes(source)});
    const color='#'+palette.rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
    const pattern=palette.patch?`<pattern id="textile" width="284" height="238" patternUnits="userSpaceOnUse"><image href="${palette.patch}" width="284" height="238" preserveAspectRatio="xMidYMid slice"/></pattern>`:`<pattern id="textile" width="640" height="180" patternUnits="userSpaceOnUse"><rect width="640" height="180" fill="${color}"/></pattern>`;
    let svg=template.replace(/<pattern id="textile"[\s\S]*?<\/pattern>/,pattern).replaceAll('#bcb0c2',color);
    // Adjust native curve thickness before rasterization; do not stretch a product photograph.
    const thickness=(height/width)/(96/576);
    svg=svg.replace(/(<svg[^>]*>)/,'$1<g transform="translate(0 35) scale(1 '+thickness+') translate(0 -35)">').replace('</svg>','</g></svg>');
    await writeFile(join(out,source+'-common-v1.svg'),svg);
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
    await page.locator('svg image').evaluateAll(async ns=>Promise.all(ns.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();})));
    await page.screenshot({path:join(out,source+'-common-v1.png'),omitBackground:true});
    const bbox=await page.evaluate(async url=>{const i=new Image();i.src=url;await i.decode();const c=document.createElement('canvas');c.width=640;c.height=180;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);const p=ctx.getImageData(0,0,640,180).data;let x0=640,y0=180,x1=0,y1=0;for(let y=0;y<180;y++)for(let x=0;x<640;x++)if(p[(y*640+x)*4+3]>=240){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}return[x0,y0,x1-x0,y1-y0];},data(await readFile(join(out,source+'-common-v1.png')),'image/png'));
    crop=bbox;item.file=join(out,source+'-common-v1.png').slice(root.length+1).replaceAll('\\','/');item.sha256=sha(await readFile(join(out,source+'-common-v1.png')));item.item_id=source;item.color_rgb=palette.rgb;item.pattern_basis=palette.patch?'source camouflage patch; simplified repeat':'dominant source color; shared surface texture';
    item.mask={width:640,height:180,crop:bbox,path:'M0 0h640v180h-640z',scene_alignment:'shelf'};
    const prev=previous?.items.find(p=>p.garment_id===g.id&&p.sha256===item.sha256);if(prev?.derivative_asset_id)item.derivative_asset_id=prev.derivative_asset_id;
   }else{
    const sprite=g.metadata.scene_sprites.folded;item.derivative_asset_id=sprite.asset_id;
    item.mask=approvedMasks.get(sprite.asset_id);crop=item.mask.crop;
   }
   item.geometry={x:x/1672,y:y/941,width:width/1672,height:height/941,z_index:20+layer,approved:true,alignment:'shelf',basis:'B-01 common-form contract; independent reference trace'};
   items.push(item);
  }
  const totalH=floor-1-y,actualWidth=Math.max(...widths);
  stacks.push({bin,side,reference:ref,display_width:actualWidth,display_height:totalH,width_error_pct:100*(actualWidth/refWidth-1),height_error_pct:100*(totalH/targetH-1),gap_px:0,floor_gap_px:1,pass:Math.abs(totalH/targetH-1)<=.1&&Math.abs(actualWidth/refWidth-1)<=.1});
 }
 if(items.filter(i=>i.kind==='common').length!==35)throw Error('Expected35 common derivatives');
 await writeFile(existingPath,JSON.stringify({namespace:'b01-common-v1',source:'user decision: common side-fold form and color/pattern',items,stacks},null,2));
 console.log(JSON.stringify({common:35,approved:31,stacks:22,failed_geometry:stacks.filter(s=>!s.pass)}));
}finally{await browser.close();}

