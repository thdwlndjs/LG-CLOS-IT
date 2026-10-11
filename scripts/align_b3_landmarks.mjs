import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const {chromium}=createRequire(new URL('../web/package.json',import.meta.url))('playwright');
const dir=resolve(fileURLToPath(new URL('..',import.meta.url)),'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/hanger-individual-v1');
const contract=JSON.parse(await readFile(resolve(dir,'B3_GEOMETRY_CONTRACT.json'),'utf8'));
const raw=await readFile(resolve(dir,contract.source_asset));
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 const result=await page.evaluate(async ({contract,source})=>{
  const image=new Image;image.src=source;await image.decode();
  const sourceCanvas=document.createElement('canvas');sourceCanvas.width=image.width;sourceCanvas.height=image.height;
  const sg=sourceCanvas.getContext('2d',{willReadFrequently:true});sg.drawImage(image,0,0);
  const src=sg.getImageData(0,0,image.width,image.height).data;
  // Thin-plate spline inverse map. Geometry is deterministic and anchored to
  // source/reference anatomical points, not generated canvas padding.
  const kernel=r=>r<1e-14?0:r*Math.log(r);
  function solve(matrix,vector){
   const a=matrix.map((r,i)=>[...r,vector[i]]),n=a.length;
   for(let col=0;col<n;col++){
    let pivot=col;for(let j=col+1;j<n;j++)if(Math.abs(a[j][col])>Math.abs(a[pivot][col]))pivot=j;
    [a[col],a[pivot]]=[a[pivot],a[col]];
    if(Math.abs(a[col][col])<1e-12)throw Error('Singular landmark contract');
    const d=a[col][col];for(let k=col;k<=n;k++)a[col][k]/=d;
    for(let j=0;j<n;j++)if(j!==col){const f=a[j][col];for(let k=col;k<=n;k++)a[j][k]-=f*a[col][k]}
   }return a.map(r=>r[n]);
  }
  const [originX,originY]=contract.output_origin,[width,height]=contract.output_size;
  const points=contract.landmarks.map(p=>[(p.target[0]-originX)/width,(p.target[1]-originY)/height]);
  const n=points.length,size=n+3;
  const matrix=Array.from({length:size},()=>Array(size).fill(0));
  for(let i=0;i<n;i++){
   for(let j=0;j<n;j++)matrix[i][j]=kernel((points[i][0]-points[j][0])**2+(points[i][1]-points[j][1])**2);
   matrix[i][n]=matrix[n][i]=1;matrix[i][n+1]=matrix[n+1][i]=points[i][0];matrix[i][n+2]=matrix[n+2][i]=points[i][1];
  }
  const coefficients=[0,1].map(axis=>solve(matrix,[...contract.landmarks.map(p=>p.source[axis]),0,0,0]));
  function inverse(x,y){
   const u=(x-originX)/width,v=(y-originY)/height;
   return coefficients.map(c=>{let value=c[n]+c[n+1]*u+c[n+2]*v;for(let j=0;j<n;j++)value+=c[j]*kernel((u-points[j][0])**2+(v-points[j][1])**2);return value});
  }
  const sampling=4,out=document.createElement('canvas');out.width=contract.output_size[0]*sampling;out.height=contract.output_size[1]*sampling;
  const g=out.getContext('2d'),p=g.createImageData(out.width,out.height),[ox,oy]=contract.output_origin;
  let foldSamples=0,opaqueSamples=0;
  for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){
   const [sx,sy]=inverse((x+.5)/sampling+ox,(y+.5)/sampling+oy),ix=Math.floor(sx),iy=Math.floor(sy);
   if(ix<0||iy<0||ix+1>=image.width||iy+1>=image.height)continue;
   const fx=sx-ix,fy=sy-iy,samples=[[ix,iy,(1-fx)*(1-fy)],[ix+1,iy,fx*(1-fy)],[ix,iy+1,(1-fx)*fy],[ix+1,iy+1,fx*fy]];
   const rgba=[0,0,0,0];
   for(const [px,py,w] of samples){const i=(py*image.width+px)*4,a=src[i+3]/255;for(let c=0;c<3;c++)rgba[c]+=src[i+c]*a*w;rgba[3]+=a*w}
   const i=(y*out.width+x)*4;if(rgba[3]>0){for(let c=0;c<3;c++)p.data[i+c]=Math.round(rgba[c]/rgba[3]);p.data[i+3]=Math.round(rgba[3]*255)}
   if(rgba[3]>.75&&x%sampling===0&&y%sampling===0){
    const wx=(x+.5)/sampling+ox,wy=(y+.5)/sampling+oy,dx=inverse(wx+.1,wy),dy=inverse(wx,wy+.1);
    const determinant=(dx[0]-sx)*(dy[1]-sy)-(dx[1]-sx)*(dy[0]-sy);
    opaqueSamples++;if(determinant<=0)foldSamples++;
   }
  }
  g.putImageData(p,0,0);
  const final=document.createElement('canvas');[final.width,final.height]=contract.output_size;
  const fg=final.getContext('2d');fg.imageSmoothingQuality='high';fg.drawImage(out,0,0,final.width,final.height);
  const finalPixels=fg.getImageData(0,0,final.width,final.height).data;
  const landmarks=contract.landmarks.map(l=>{
   let alpha=0;const x=Math.round(l.target[0]-ox),y=Math.round(l.target[1]-oy);
   for(let dy=-l.tolerance_px;dy<=l.tolerance_px;dy++)for(let dx=-l.tolerance_px;dx<=l.tolerance_px;dx++)if(x+dx>=0&&y+dy>=0&&x+dx<final.width&&y+dy<final.height)alpha=Math.max(alpha,finalPixels[((y+dy)*final.width+x+dx)*4+3]);
   const mapped=inverse(...l.target);
   const minimum=l.id.startsWith('hook_')?64:200;
   return {id:l.id,target:l.target,source_fit_error:Math.hypot(mapped[0]-l.source[0],mapped[1]-l.source[1]),rendered_alpha_near_target:alpha,minimum_alpha:minimum};
  });
  return {png:final.toDataURL(),landmarks,fold_samples:foldSamples,opaque_samples:opaqueSamples};
 },{contract,source:'data:image/png;base64,'+raw.toString('base64')});
 await writeFile(resolve(dir,contract.output_asset),Buffer.from(result.png.split(',')[1],'base64'));
 const passed=result.landmarks.every(l=>l.rendered_alpha_near_target>=l.minimum_alpha)&&result.fold_samples===0;
 await writeFile(resolve(dir,'B3-contract-anchor-check.json'),JSON.stringify({status:passed?'PASS_ANCHOR_PRESENCE':'FAIL_ANCHOR_OR_FOLD_CHECK',landmarks:result.landmarks,fold_samples:result.fold_samples,opaque_samples:result.opaque_samples,scope:'Anchor presence and local fold check only; no visual-quality approval',alpha_rule:'Subpixel metal hook: >=64 alpha, textile/wood: >=200 alpha within declared tolerance.'},null,2)+'\n');
 if(!passed)throw Error('Rendered landmark presence failed');
 console.log(JSON.stringify(result.landmarks.map(l=>({id:l.id,alpha:l.rendered_alpha_near_target,error:l.source_fit_error}))));
}finally{await browser.close()}
