/* Local CPU inference. Neither source images nor frames leave this worker/browser. */
let segmenter,initializing;
function alpha(p){const t=Math.max(0,Math.min(1,(p-.12)/.76));return Math.round(255*t*t*(3-2*t));}
async function initialize(){
 if(initializing)return initializing;
 initializing=(async()=>{
  importScripts('/vendor/mediapipe/vision_bundle.js');
  const files=await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  segmenter=await Vision.ImageSegmenter.createFromOptions(files,{
   baseOptions:{modelAssetPath:'/vendor/mediapipe/selfie_segmenter.tflite',delegate:'CPU'},
   runningMode:'IMAGE',outputConfidenceMasks:true,outputCategoryMask:false,
  });
 })();
 return initializing;
}
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{await initialize();self.postMessage({type:'ready'});}catch{self.postMessage({type:'error',message:'인물 분리 엔진을 준비하지 못했어요.'});}
  return;
 }
 if(data.type!=='frame')return;
 const {bitmap,ticket}=data;let result;
 const began=performance.now();
 try{
  await initialize();
  // Exact transferred RGB is used for both model inference and final compositing.
  result=segmenter.segment(bitmap);
  const masks=result.confidenceMasks,mask=masks?.[masks.length===1?0:1];
  if(!mask)throw new Error('No person confidence');
  const values=mask.getAsFloat32Array(),pixels=new Uint8ClampedArray(mask.width*mask.height*4);
  let foreground=0;
  for(let i=0;i<values.length;i++){pixels[i*4]=255;pixels[i*4+1]=255;pixels[i*4+2]=255;pixels[i*4+3]=alpha(values[i]);if(values[i]>.5)foreground++;}
  if(foreground===0)throw new Error('No person foreground');
  const matte=new OffscreenCanvas(mask.width,mask.height),matteContext=matte.getContext('2d');
  matteContext.putImageData(new ImageData(pixels,mask.width,mask.height),0,0);
  const output=new OffscreenCanvas(bitmap.width,bitmap.height),context=output.getContext('2d');
  context.drawImage(bitmap,0,0);context.globalCompositeOperation='destination-in';
  context.drawImage(matte,0,0,bitmap.width,bitmap.height);
  const composed=output.transferToImageBitmap();
  self.postMessage({type:'frame',ticket,bitmap:composed,processingMs:performance.now()-began,foregroundRatio:foreground/values.length},[composed]);
 }catch{
  self.postMessage({type:'frame-error',ticket,message:'인물 분리를 확인하지 못했어요. 마지막 확인 화면을 유지해요.'});
 }finally{bitmap?.close();result?.close();}
};
