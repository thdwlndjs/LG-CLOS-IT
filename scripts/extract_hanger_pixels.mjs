/** Deterministic source-pixel extraction. No generation, resizing or colour edits. */
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(new URL('../web/package.json',import.meta.url))('playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const reports=resolve(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports');
const out=resolve(reports,'hanger-individual-v1');
await mkdir(out,{recursive:true});
const source=await readFile(resolve(reports,'wardrobe-visual-samples-v1/wardrobe-composite.png'));
const empty=await readFile(resolve(root,'web/public/assets/remediation/wardrobe-clean-plate-v1.png'));
const lighting=JSON.parse(await readFile(resolve(reports,'wardrobe-lighting-review-v1/lighting.json'),'utf8'));
// Visible outlines only. Occluded backs are unavailable in the source and are not invented.
const definitions=[
 ['A1',120,[[116,155],[109,162],[102,178],[96,215],[91,279],[85,370],[82,447],[84,511],[95,515],[94,622],[119,625],[139,621],[141,546],[137,440],[134,308],[137,210],[132,172],[125,156]]],
 ['A2',157,[[152,155],[143,164],[138,183],[131,224],[128,318],[126,432],[129,518],[126,619],[151,624],[172,618],[174,539],[172,438],[175,278],[170,199],[165,164]]],
 ['A3',192,[[187,155],[178,171],[173,200],[169,264],[165,370],[160,477],[163,518],[173,520],[169,617],[194,621],[207,614],[211,517],[213,394],[212,257],[211,195],[203,164]]],
 ['A4',229,[[224,155],[216,168],[213,198],[207,263],[204,351],[201,453],[202,516],[203,578],[225,584],[240,579],[247,524],[248,436],[249,344],[246,237],[241,184],[233,157]]],
 ['A5',266,null],
 ['A6',303,[[296,155],[286,170],[281,192],[277,241],[274,329],[272,423],[273,506],[281,516],[279,626],[301,630],[320,622],[319,520],[319,413],[318,326],[319,234],[314,185],[308,161]]],
 ['A7',341,[[333,155],[326,167],[321,192],[318,243],[316,319],[312,407],[312,505],[318,515],[317,622],[340,625],[361,616],[360,528],[365,513],[365,427],[363,335],[365,239],[361,188],[352,162],[345,155]]],
 ['B1',434,[[428,155],[420,170],[414,193],[409,227],[404,274],[401,332],[403,375],[410,396],[424,399],[423,416],[438,424],[458,417],[463,405],[459,369],[457,281],[453,211],[448,174],[441,157]]],
 ['B2',477,[[470,155],[461,171],[455,198],[451,230],[447,282],[446,339],[449,387],[461,410],[483,423],[499,417],[496,387],[495,324],[494,253],[491,206],[485,171],[480,156]]],
 ['B3',517,null],
 ['B4',559,[[553,155],[548,171],[544,197],[538,226],[534,268],[535,337],[541,396],[549,405],[549,425],[568,431],[589,423],[591,409],[585,367],[584,303],[581,235],[574,184],[565,156]]],
 ['B5',603,[[597,155],[589,172],[584,198],[581,244],[578,313],[576,386],[585,405],[603,412],[607,433],[625,429],[636,419],[631,378],[633,309],[630,232],[623,182],[611,157]]],
 ['B6',645,[[638,155],[631,171],[626,195],[623,229],[621,285],[619,349],[617,400],[625,414],[625,429],[644,433],[665,423],[671,402],[669,333],[669,252],[665,203],[656,170],[649,155]]],
 ['C1',429,[[419,515],[416,533],[413,597],[410,664],[408,722],[424,728],[442,724],[444,640],[444,557],[438,519]]],
 ['C2',460,[[451,515],[445,537],[442,591],[439,652],[438,720],[454,725],[472,723],[475,665],[475,591],[470,530],[466,516]]],
 ['C3',491,[[482,515],[477,533],[475,596],[473,661],[471,722],[487,725],[504,723],[507,659],[506,583],[501,529],[496,515]]],
 ['C4',523,[[515,515],[511,533],[508,592],[505,667],[505,723],[522,727],[540,722],[541,650],[538,577],[535,529],[529,515]]],
 ['C5',555,[[548,515],[544,534],[541,587],[538,651],[537,722],[552,726],[570,722],[573,661],[573,590],[569,529],[562,515]]],
 ['C6',587,[[580,515],[577,531],[578,562],[577,620],[576,683],[577,726],[594,730],[609,725],[608,658],[607,590],[603,535],[598,516]]],
 ['C7',618,[[614,515],[608,534],[609,593],[607,654],[606,720],[622,726],[640,722],[643,664],[641,598],[637,540],[630,516]]],
 ['C8',650,[[654,516],[649,533],[647,591],[646,651],[645,722],[660,726],[676,719],[679,650],[676,588],[671,536],[665,518]]],
];
const defs=definitions.map(([id,hook,polygon])=>{
 const original=lighting.variants.find(v=>v.id===id[0]&&v.cloth_path);
 const approved=(id==='A5'||id==='B3')?original:null;
 const bottom=id[0]==='C';
 return {id,hook_x:hook,cloth_path:approved?.cloth_path||'M '+polygon.map(p=>p.join(' ')).join(' L ')+' Z',
  hanger_path:approved?.hanger_path||(bottom?`M ${hook-6} 494 L ${hook+7} 495 L ${hook+6} 518 L ${hook-9} 519 Z`:`M ${hook-3} 141 L ${hook+4} 142 L ${hook+2} 158 L ${hook-7} 159 Z`),
  hook_path:approved?.hook_path||(bottom?`M ${hook} 495 L ${hook+1} 481 Q ${hook+2} 474 ${hook-1} 475`:`M ${hook} 142 L ${hook+2} 129 Q ${hook+3} 122 ${hook} 122`)};
});
// Continuous visible row envelopes include the sleeve/hem fragments between traces.
// Per-item internal boundaries remain explicit visible-pixel ownership, not hidden backs.
const envelopes=[
 {row:'A',points:[[116,153],[125,155],[134,170],[140,188],[147,166],[153,154],[162,156],[170,179],[177,168],[186,154],[196,154],[205,172],[210,190],[218,168],[224,154],[234,155],[245,177],[250,194],[255,167],[261,153],[270,155],[279,174],[283,196],[290,168],[296,154],[307,155],[318,177],[322,193],[329,167],[337,153],[349,155],[362,176],[370,209],[372,307],[373,425],[372,521],[367,588],[361,625],[321,631],[280,631],[266,634],[227,633],[227,585],[204,586],[204,621],[174,625],[132,627],[96,625],[94,518],[83,516],[79,457],[81,373],[86,280],[92,211],[100,176],[110,158]]},
 {row:'B',points:[[428,153],[440,155],[450,176],[457,183],[465,161],[474,153],[485,157],[494,178],[498,200],[501,174],[507,153],[523,153],[531,180],[536,200],[546,173],[553,154],[566,154],[578,179],[583,197],[590,169],[596,154],[611,154],[624,177],[631,193],[633,165],[640,153],[651,155],[664,178],[673,217],[677,298],[677,370],[677,413],[666,431],[638,435],[620,434],[607,437],[584,432],[568,435],[548,431],[530,430],[507,425],[489,427],[466,426],[448,430],[427,425],[412,421],[411,401],[403,398],[399,366],[399,308],[402,257],[408,207],[417,174]]},
 {row:'C',points:[[418,515],[430,514],[438,519],[447,517],[455,513],[466,513],[474,518],[481,513],[496,512],[505,521],[512,516],[523,513],[537,517],[541,521],[548,514],[562,513],[572,521],[579,514],[598,512],[609,518],[615,513],[631,513],[642,520],[654,515],[667,516],[675,531],[680,591],[683,658],[681,725],[661,731],[639,728],[619,732],[599,732],[576,733],[553,731],[535,730],[510,731],[491,729],[471,731],[449,730],[427,731],[408,727],[405,691],[408,628],[411,573],[414,535]]},
];
const rows=[{id:'A',bounds:[78,121,300,551]},{id:'B',bounds:[398,121,289,316]},{id:'C',bounds:[400,475,288,263]}];
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 const result=await page.evaluate(async ({source,empty,defs,envelopes,rows})=>{
  const load=src=>new Promise((res,rej)=>{const i=new Image;i.onload=()=>res(i);i.onerror=rej;i.src=src});
  const src=await load(source),blank=await load(empty),W=src.width,H=src.height;
  const make=(w=W,h=H)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
  const original=make(),og=original.getContext('2d',{willReadFrequently:true});og.drawImage(src,0,0);
  const pixels=og.getImageData(0,0,W,H),owners=new Int16Array(W*H).fill(-1);
  // Render silhouette masks, then threshold to binary alpha. This avoids repeated-alpha
  // seams when source RGB pixels are placed back at their exact original coordinates.
  for(let index=0;index<defs.length;index++){
   const d=defs[index],c=make(),g=c.getContext('2d',{willReadFrequently:true});
   g.fillStyle='white';g.fill(new Path2D(d.cloth_path));g.fill(new Path2D(d.hanger_path));
   g.strokeStyle='white';g.lineWidth=1.8;g.lineCap='round';g.stroke(new Path2D(d.hook_path));
   const m=g.getImageData(0,0,W,H).data;
   for(let i=0;i<owners.length;i++)if(m[i*4+3]>0)owners[i]=index;
  }
  for(const envelope of envelopes){
   const c=make(),g=c.getContext('2d',{willReadFrequently:true});
   g.fillStyle='white';g.fill(new Path2D('M '+envelope.points.map(p=>p.join(' ')).join(' L ')+' Z'));
   const mask=g.getImageData(0,0,W,H).data;
   const members=defs.map((d,n)=>({d,n})).filter(({d})=>d.id[0]===envelope.row);
   for(let i=0;i<owners.length;i++)if(mask[i*4+3]>0&&owners[i]<0){
    const x=i%W;let closest=members[0];
    for(const candidate of members)if(Math.abs(x-candidate.d.hook_x)<Math.abs(x-closest.d.hook_x))closest=candidate;
    owners[i]=closest.n;
   }
  }
  // The black A5 hem extends below A4. Hook-distance alone would incorrectly
  // assign its left edge to the shorter neighboring green coat.
  const coat=defs.findIndex(d=>d.id==='A5');
  for(let y=585;y<635;y++)for(let x=224;x<271;x++){
   const i=y*W+x;if(owners[i]>=0&&defs[owners[i]].id[0]==='A')owners[i]=coat;
  }
  const base=make(),bg=base.getContext('2d',{willReadFrequently:true});bg.drawImage(blank,0,0);
  const bp=bg.getImageData(0,0,W,H);
  for(let i=0;i<owners.length;i++)if(owners[i]<0)bp.data.set(pixels.data.subarray(i*4,i*4+4),i*4);
  bg.putImageData(bp,0,0);
  // When a garment is removed, restore the complete corresponding wood/shadow area,
  // rather than leaving a garment-shaped patch of brighter background behind it.
  const clean=make(),cleanContext=clean.getContext('2d');cleanContext.drawImage(src,0,0);
  for(const {bounds:[x,y,w,h]} of rows)cleanContext.drawImage(blank,x,y,w,h,x,y,w,h);
  const assets=[];
  for(let n=0;n<defs.length;n++){
   let x0=W,y0=H,x1=0,y1=0,count=0;
   for(let i=0;i<owners.length;i++)if(owners[i]===n){const x=i%W,y=Math.floor(i/W);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);count++}
   const w=x1-x0+1,h=y1-y0+1,c=make(w,h),g=c.getContext('2d'),p=g.createImageData(w,h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y+y0)*W+x+x0;if(owners[i]===n)p.data.set(pixels.data.subarray(i*4,i*4+4),(y*w+x)*4)}
   g.putImageData(p,0,0);assets.push({...defs[n],x:x0,y:y0,width:w,height:h,pixel_count:count,png:c.toDataURL()});
  }
  const composite=make(),cg=composite.getContext('2d',{willReadFrequently:true});cg.drawImage(base,0,0);
  for(const a of assets)cg.drawImage(await load(a.png),a.x,a.y);
  const actual=cg.getImageData(0,0,W,H).data;let changed=0;
  for(let i=0;i<owners.length;i++)if(actual[i*4]!==pixels.data[i*4]||actual[i*4+1]!==pixels.data[i*4+1]||actual[i*4+2]!==pixels.data[i*4+2]||actual[i*4+3]!==pixels.data[i*4+3])changed++;
  return {width:W,height:H,assets,base:base.toDataURL(),clean:clean.toDataURL(),composite:composite.toDataURL(),changed_pixels:changed};
 },{source:'data:image/png;base64,'+source.toString('base64'),empty:'data:image/png;base64,'+empty.toString('base64'),defs,envelopes,rows});
 if(result.changed_pixels!==0)throw Error(`Recomposition drift: ${result.changed_pixels}`);
 const save=(name,data)=>writeFile(resolve(out,name),Buffer.from(data.split(',')[1],'base64'));
 await save('hanger-empty-background.png',result.base);await save('recomposed.png',result.composite);
 await save('hanger-clean-underlay.png',result.clean);
 for(const a of result.assets){await save(a.id+'.png',a.png);delete a.png;a.file=a.id+'.png'}
 const manifest={status:'EXTRACTED_VISIBLE_PIXELS_EDGE_REVIEW_PENDING',scope:'21 hanging items; folded shelves remain in background',
  source:'../wardrobe-visual-samples-v1/wardrobe-composite.png',source_sha256:createHash('sha256').update(source).digest('hex'),
  background:'hanger-empty-background.png',clean_underlay:'hanger-clean-underlay.png',rows,width:result.width,height:result.height,
  changed_pixels:result.changed_pixels,method:'Binary visible-pixel ownership masks; original RGB; no resizing or regeneration',
  limitations:['Masks need independent visual edge inspection: pixel-exact recomposition alone does not prove correct segmentation.','Hidden portions of overlapping garments are not reconstructed; moving exposes missing portions.','Background is original outside traced silhouettes and prior clean plate inside. Traces may retain unassigned edge fragments.','No product API/DB changes or lighting variants in this extraction step.'],items:result.assets};
 await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({count:result.assets.length,changed_pixels:result.changed_pixels,output:out}));
} finally {await browser.close()}
