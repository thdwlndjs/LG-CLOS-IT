import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const {chromium}=createRequire(new URL('../web/package.json',import.meta.url))('playwright');
const dir=resolve(fileURLToPath(new URL('..',import.meta.url)),'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/hanger-individual-v1');
const raw=await readFile(resolve(dir,'B3-clean-v4.png'));
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 const result=await page.evaluate(async source=>{
  const im=new Image;im.src=source;await im.decode();
  const c=document.createElement('canvas');c.width=im.width;c.height=im.height;
  const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(im,0,0);
  const p=g.getImageData(0,0,c.width,c.height),data=p.data;
  // Remove generated matte artifacts. Canvas-only finishing of the generated asset,
  // not generation of a garment or editing of the original wardrobe scene.
  const keep=new Uint8Array(c.width*c.height);
  for(let i=0;i<keep.length;i++){
   const [r,green,b,a]=data.subarray(i*4,i*4+4);
   const chroma=Math.max(r,green,b)-Math.min(r,green,b);
   keep[i]=a>=230&&!(chroma>130&&(b>r+90||r>green+100||green>r+100))?1:0;
  }
  let left=c.width,top=c.height,right=0,bottom=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
   const i=y*c.width+x;
   const retained=x>0&&y>0&&x<c.width-1&&y<c.height-1&&keep[i]&&keep[i-1]&&keep[i+1]&&keep[i-c.width]&&keep[i+c.width];
   if(!retained)data[i*4+3]=0;
   else{data[i*4+3]=255;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
  }
  g.putImageData(p,0,0);
  const target=document.createElement('canvas');target.width=53;target.height=310;
  const t=target.getContext('2d'),w=right-left+1,h=bottom-top+1;
  const scale=Math.min(51/w,308/h),dw=w*scale,dh=h*scale;
  t.imageSmoothingEnabled=true;t.imageSmoothingQuality='high';
  t.drawImage(c,left,top,w,h,(53-dw)/2,1,dw,dh);
  return {raw_size:[im.width,im.height],alpha_crop:[left,top,w,h],placement:[486,121,53,310],png:target.toDataURL(),highres:c.toDataURL()};
 },'data:image/png;base64,'+raw.toString('base64'));
 for(const [name,key] of [['B3-clean-final.png','png'],['B3-clean-highres.png','highres']])await writeFile(resolve(dir,name),Buffer.from(result[key].split(',')[1],'base64'));
 delete result.png;delete result.highres;
 await writeFile(resolve(dir,'B3-clean-placement.json'),JSON.stringify({status:'GENERATED_CLEANUP_VISUAL_REVIEW',...result,source:'B3.png',generator:'image_gen.imagegen',finishing:'Canvas alpha fringe removal, one-pixel matte erosion, aspect-preserving fit to original 53x310 canvas',limitation:'Generated texture is not pixel-identical to source. Existing pose approximated; final visual approval pending.'},null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser.close()}
