/** Read-only photo analysis -> SVG clipping geometry; original raster bytes are untouched. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const root=resolve('..');
const approved=process.argv.includes('--approved');
const file=resolve(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/templates/'+(approved?'approved_scene_manifest.json':'remediation_products.json'));
const manifest=JSON.parse(await readFile(file,'utf8'));
const browser=await chromium.launch();
const page=await browser.newPage();
try {
 for(const row of manifest.items){
  const bytes=await readFile(resolve(root,approved?'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/wardrobe-visual-review/'+row.product.local_photo:row.local_image));
  const input=`data:${approved?'image/jpeg':row.image_content_type};base64,${bytes.toString('base64')}`;
  // C6 has near-white fabric touching the background threshold. Its visible source contour
  // is traced in the original 450x600 coordinates; no color-based removal inside the cloth.
  const manualOutline=approved && row.id==='C6' ? [[153,92],[301,92],[306,132],[313,235],[319,370],[325,509],[247,514],[234,365],[224,253],[216,369],[206,514],[127,509],[130,355],[135,231],[143,132]] : null;
  const mask=await page.evaluate(async ({src,approved,manualOutline})=>{
    const image=new Image();image.src=src;await image.decode();
    const w=384,h=Math.round(w*image.naturalHeight/image.naturalWidth);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);
    const pixels=ctx.getImageData(0,0,w,h).data, outside=new Uint8Array(w*h),queue=[];
    const corners=[0,w-1,(h-1)*w,w*h-1].map(i=>[...pixels.slice(i*4,i*4+3)]);
    const empty=i=>pixels[i*4+3]<8 || Math.min(pixels[i*4],pixels[i*4+1],pixels[i*4+2])>=244 ||
      (approved && corners.some(rgb=>Math.min(...rgb)>200 && rgb.every((v,c)=>Math.abs(v-pixels[i*4+c])<=8)));
    const add=i=>{if(!outside[i]&&empty(i)){outside[i]=1;queue.push(i);}};
    for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}
    for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
    for(let k=0;k<queue.length;k++){
      const i=queue[k],x=i%w,y=Math.floor(i/w);
      if(x>0)add(i-1);if(x<w-1)add(i+1);if(y>0)add(i-w);if(y<h-1)add(i+w);
    }
    let path='',kept=0;
    if(manualOutline){
      const polygon=manualOutline.map(([x,y])=>[x*w/image.naturalWidth,y*h/image.naturalHeight]);
      for(let y=0;y<h;y++){
        const intersections=[];
        for(let i=0;i<polygon.length;i++){
          const [x1,y1]=polygon[i],[x2,y2]=polygon[(i+1)%polygon.length],sy=y+.5;
          if((y1<=sy&&y2>sy)||(y2<=sy&&y1>sy))intersections.push(x1+(sy-y1)*(x2-x1)/(y2-y1));
        }
        intersections.sort((a,b)=>a-b);
        for(let i=0;i+1<intersections.length;i+=2){const x=Math.max(0,Math.floor(intersections[i])),end=Math.min(w,Math.ceil(intersections[i+1]));if(end>x){path+=`M${x} ${y}h${end-x}v1h${x-end}z`;kept+=end-x;}}
      }
      return {width:w,height:h,path,foreground_ratio:kept/(w*h),basis:'manual visible C6 source-pixel contour (450x600); fabric pixels preserved; no raster modification',review_status:'source_contour_manually_inspected'};
    }
    for(let y=0;y<h;y++){
      let x=0;
      while(x<w){while(x<w&&(outside[y*w+x]||pixels[(y*w+x)*4+3]<8))x++;
        const start=x;
        while(x<w&&!outside[y*w+x]&&pixels[(y*w+x)*4+3]>=8)x++;
        if(x>start){path+=`M${start} ${y}h${x-start}v1h${start-x}z`;kept+=x-start;}
      }
    }
    return {width:w,height:h,path,foreground_ratio:kept/(w*h),basis:approved?'outside-connected-white/corner-color SVG clipping; original photo bytes retained':'outside-connected-white-background SVG clipping; original photo bytes retained',review_status:'automatic_mask_needs_visual_review'};
  },{src:input,approved,manualOutline});
  if(mask.foreground_ratio<0.03||mask.foreground_ratio>0.9)throw Error(`${row.id ?? row.item_id}: invalid mask ${mask.foreground_ratio}`);
  row.display_mask=mask;
 }
 await writeFile(file,JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({native_svg_masks:manifest.items.length,source_rasters_modified:false}));
}finally{await browser.close();}
