/** Read-only photo analysis -> SVG clipping geometry; original raster bytes are untouched. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const root=resolve('..');
const file=resolve(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/templates/remediation_products.json');
const manifest=JSON.parse(await readFile(file,'utf8'));
const browser=await chromium.launch();
const page=await browser.newPage();
try {
 for(const row of manifest.items){
  const bytes=await readFile(resolve(root,row.local_image));
  const input=`data:${row.image_content_type};base64,${bytes.toString('base64')}`;
  const mask=await page.evaluate(async src=>{
    const image=new Image();image.src=src;await image.decode();
    const w=384,h=Math.round(w*image.naturalHeight/image.naturalWidth);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);
    const pixels=ctx.getImageData(0,0,w,h).data, outside=new Uint8Array(w*h),queue=[];
    const empty=i=>pixels[i*4+3]<8 || Math.min(pixels[i*4],pixels[i*4+1],pixels[i*4+2])>=244;
    const add=i=>{if(!outside[i]&&empty(i)){outside[i]=1;queue.push(i);}};
    for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}
    for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
    for(let k=0;k<queue.length;k++){
      const i=queue[k],x=i%w,y=Math.floor(i/w);
      if(x>0)add(i-1);if(x<w-1)add(i+1);if(y>0)add(i-w);if(y<h-1)add(i+w);
    }
    let path='',kept=0;
    for(let y=0;y<h;y++){
      let x=0;
      while(x<w){while(x<w&&(outside[y*w+x]||pixels[(y*w+x)*4+3]<8))x++;
        const start=x;
        while(x<w&&!outside[y*w+x]&&pixels[(y*w+x)*4+3]>=8)x++;
        if(x>start){path+=`M${start} ${y}h${x-start}v1h${start-x}z`;kept+=x-start;}
      }
    }
    return {width:w,height:h,path,foreground_ratio:kept/(w*h),basis:'outside-connected-white-background SVG clipping; original photo bytes retained',review_status:'automatic_mask_needs_visual_review'};
  },input);
  if(mask.foreground_ratio<0.03||mask.foreground_ratio>0.9)throw Error(`${row.item_id}: invalid mask ${mask.foreground_ratio}`);
  row.display_mask=mask;
 }
 await writeFile(file,JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({native_svg_masks:manifest.items.length,source_rasters_modified:false}));
}finally{await browser.close();}
