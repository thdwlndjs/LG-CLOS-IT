// Local code-native side-fold PoC. Does not register assets or write any DB row.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out=dirname(fileURLToPath(import.meta.url));
const root=resolve(out,'../../../../..');
const {chromium}=await import(pathToFileURL(join(root,'web/node_modules/playwright/index.mjs')));
const trace=JSON.parse(await readFile(join(out,'reference-trace.json'),'utf8'));
const samples=[
 {id:'REM-03',garment:'fa6caeb1-0966-58c2-a81e-2754d7643c2c',compartment:'F2',side:'right',layer:2,kind:'fine-knit',patch:[.43,.44,.16,.14],base:'#a3aaa0',height:91},
 {id:'REM-11',garment:'883a6a25-4c2c-510b-bbe5-0ca8e5a44e32',compartment:'E4',side:'right',layer:0,kind:'fleece',patch:[.35,.43,.13,.14],base:'#bcb0c2',height:96},
 {id:'REM-23',garment:'2904fd43-cb31-530d-b4bd-2d9783d3c762',compartment:'E2',side:'left',layer:1,kind:'woven-camouflage',patch:[.53,.43,.25,.21],base:'#aaa28c',height:91}
];
const data=(b,mime)=>`data:${mime};base64,${b.toString('base64')}`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch();
await mkdir(out,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:640,height:180},deviceScaleFactor:1});
 const manifest=[];
 for(const s of samples){
  const source=await readFile(join(root,`test-results/remediation/source-images/${s.id}.jpg`));
  const material=await page.evaluate(async({url,patch})=>{
   const i=new Image();i.src=url;await i.decode();const c=document.createElement('canvas');
   // Only an unlabelled textile patch, uniformly resampled, not a garment photo warp.
   const [x,y,w,h]=patch;c.width=Math.round(i.width*w);c.height=Math.round(i.height*h);
   c.getContext('2d').drawImage(i,i.width*x,i.height*y,c.width,c.height,0,0,c.width,c.height);
   return {url:c.toDataURL('image/png'),width:c.width,height:c.height};
  },{url:data(source,'image/jpeg'),patch:s.patch});
  const y=35+s.height;
  const outer=`M52 42 Q105 33 213 35 L554 38 Q591 39 602 62 L602 ${y-12} Q600 ${y} 573 ${y} L55 ${y} Q26 ${y-2} 26 ${y-20} L27 66 Q29 48 52 42Z`;
  const details=s.kind==='fine-knit'?Array.from({length:130},(_,i)=>`<path d="M${43+i*4.15} 48 q-3 4 0 8 t0 8 t0 8 t0 8 t0 8 t0 8 t0 8" stroke="#dce0d8" stroke-width=".75" opacity=".14"/>`).join(''):
    s.kind==='fleece'?'<rect x="24" y="32" width="583" height="109" filter="url(#pile)" opacity=".22"/>':'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180">
  <defs><clipPath id="body"><path d="${outer}"/></clipPath>
  <pattern id="textile" width="${s.kind==='woven-camouflage'?284:190}" height="${s.kind==='woven-camouflage'?238:166}" patternUnits="userSpaceOnUse"><image href="${material.url}" width="${s.kind==='woven-camouflage'?284:190}" height="${s.kind==='woven-camouflage'?238:166}" preserveAspectRatio="xMidYMid slice"/></pattern>
  <linearGradient id="light" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".21"/><stop offset=".38" stop-color="#fff" stop-opacity=".03"/><stop offset=".75" stop-color="#000" stop-opacity=".19"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
  <linearGradient id="fold"><stop stop-color="#000" stop-opacity=".64"/><stop offset=".08" stop-color="#000" stop-opacity=".30"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
  <filter id="pile"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="11"/><feColorMatrix type="saturate" values="0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
  <filter id="shadow" x="-20%" y="-120%" width="140%" height="340%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>
  <ellipse cx="314" cy="${y+1}" rx="280" ry="3" fill="#171512" opacity=".28" filter="url(#shadow)"/>
  <g clip-path="url(#body)"><path d="${outer}" fill="${s.base}"/><path d="${outer}" fill="url(#textile)"/>
  <path d="${outer}" fill="url(#light)"/>
  <path d="M37 65 Q94 49 213 50 L579 50 Q594 53 597 64 Q358 56 104 65 Q45 69 41 86 Q42 107 66 110 L580 110" fill="none" stroke="#000" stroke-opacity=".20" stroke-width="3.2"/>
  <path d="M31 86 Q28 50 71 48 L572 47" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2.5"/>
  <path d="M32 100 Q32 114 62 117 L580 117" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2.6"/>
  <path d="M35 69 Q28 90 41 111 L80 117 L79 58Z" fill="url(#fold)"/>
  <path d="M48 76 Q67 69 78 73 Q65 82 53 81 Q47 86 55 91 L83 90" fill="none" stroke="#161812" stroke-opacity=".45" stroke-width="4" stroke-linecap="round"/>
  <path d="M87 119 Q220 122 373 119 T582 117" fill="none" stroke="#eee" stroke-opacity=".26" stroke-width="1" stroke-dasharray="2 2"/>
  ${details}</g></svg>`;
  await writeFile(join(out,s.id+'-side-v1.svg'),svg);
  await page.setContent(`<style>html,body{margin:0;background:transparent;width:640px;height:180px}</style>${svg}`);
  await page.locator('svg image').evaluateAll(async ns=>Promise.all(ns.map(async n=>{const i=new Image();i.src=n.getAttribute('href');await i.decode();})));
  await page.screenshot({path:join(out,s.id+'-side-v1.png'),omitBackground:true});
  const raster=await page.evaluate(async()=>{
   const svg=document.querySelector('svg'),blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),u=URL.createObjectURL(blob);
   const i=new Image();i.src=u;await i.decode();const c=document.createElement('canvas');c.width=640;c.height=180;
   const ctx=c.getContext('2d');ctx.drawImage(i,0,0);const pix=ctx.getImageData(0,0,640,180).data;
   let minX=640,minY=180,maxX=0,maxY=0,zeros=0,opaque=0;
   for(let y=0;y<180;y++)for(let x=0;x<640;x++){const a=pix[(y*640+x)*4+3];if(a===0)zeros++;if(a>=240){opaque++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
   URL.revokeObjectURL(u);return {opaque_bbox:[minX,minY,maxX+1,maxY+1],transparent_pixels:zeros,opaque_pixels:opaque};
  });
  const [x0,y0,x1,y1]=raster.opaque_bbox;const ref=trace.compartments[s.compartment][s.side];
  const width=ref[2]-ref[0],scale=width/(x1-x0),height=(y1-y0)*scale;
  const placement={x:ref[0]-x0*scale,y:trace.compartments[s.compartment].floor-1-height*(s.layer+1)-y0*scale,width:640*scale,height:180*scale,z_index:20+s.layer};
  manifest.push({...s,source_sha256:sha(source),svg_sha256:sha(Buffer.from(svg)),png_sha256:sha(await readFile(join(out,s.id+'-side-v1.png'))),raster,scale,placement,trial_stack:{opaque_width:width,opaque_height:height*3,width_error_pct:0,height_error_pct:100*(height*3/(ref[3]-ref[1])-1),stack_gap_px:0,floor_gap_px:1},material_status:'photo-sampled visible surface; fiber composition unknown; unobserved folds are modeled'});
 }
 await writeFile(join(out,'samples.json'),JSON.stringify({version:'b01-local-surface-model-v1',method:'Code-native curved side/top profiles with photo-sampled textile only; no AI calls or full garment photo deformation',reference_trace_sha256:sha(await readFile(join(out,'reference-trace.json'))),samples:manifest},null,2));
 console.log(JSON.stringify(manifest.map(m=>({id:m.id,opaque:m.raster.opaque_bbox,stack_height_error_pct:m.trial_stack.height_error_pct}))));
}finally{await browser.close();}
