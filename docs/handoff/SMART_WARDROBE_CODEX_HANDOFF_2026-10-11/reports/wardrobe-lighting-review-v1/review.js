/* Review-only native composition. No application session, API or DB writes. */
(() => {
 const spec=window.LIGHTING_REVIEW;
 const scene=document.querySelector('#scene'),ctx=scene.getContext('2d');
 const status=document.querySelector('#status');
 const auto=document.querySelector('#auto'),ui=document.querySelector('#ui');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const images={},weights=Object.fromEntries(spec.variants.map(v=>[v.id,0]));
 let base,mirror,selected=[],activity=0,raf=0,timer=0,lastReason='기본 조명';
 const create=()=>{const c=document.createElement('canvas');c.width=1672;c.height=941;return c};
 const loadImage=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('이미지 로딩 실패: '+src));im.src=src});
 function mask(w,h,feather=8){
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);
  g.globalCompositeOperation='destination-in';
  const fx=Math.min(feather/w,.25),fy=Math.min(feather/h,.25);
  const x=g.createLinearGradient(0,0,w,0);
  x.addColorStop(0,'transparent');x.addColorStop(fx,'white');x.addColorStop(1-fx,'white');x.addColorStop(1,'transparent');
  g.fillStyle=x;g.fillRect(0,0,w,h);
  const y=g.createLinearGradient(0,0,0,h);
  y.addColorStop(0,'transparent');y.addColorStop(fy,'white');y.addColorStop(1-fy,'white');y.addColorStop(1,'transparent');
  g.fillStyle=y;g.fillRect(0,0,w,h);return c;
 }
 const silhouetteLayers={};
 function silhouette(variant){
  const c=create(),g=c.getContext('2d');
  g.fillStyle='#fff';g.fill(new Path2D(variant.cloth_path));
  g.fill(new Path2D(variant.hanger_path));
  g.strokeStyle='#fff';g.lineWidth=1.8;g.lineCap='round';
  g.stroke(new Path2D(variant.hook_path));
  return c;
 }
 function makeLayers(){
  for(const variant of spec.variants){
   const [x,y,w,h]=variant.sector_bounds || variant.bounds,c=create(),g=c.getContext('2d');
   const shape=variant.cloth_path?silhouette(variant):null;
   g.drawImage(images[variant.id],0,0);
   g.globalCompositeOperation='destination-in';
   if(shape){g.drawImage(shape,0,0);silhouetteLayers[variant.id]=shape}
   else g.drawImage(mask(w,h,6),x,y);
   images[variant.id+'-layer']=c;
  }
 }
 function draw(){
  ctx.clearRect(0,0,1672,941);ctx.drawImage(base,0,0);
  for(const v of spec.variants){
   ctx.globalAlpha=spec.relight_mix*weights[v.id];ctx.drawImage(images[v.id+'-layer'],0,0);
  }
  ctx.globalAlpha=1;
  if(ui.checked)ctx.drawImage(mirror,712,22,255,832,712,22,255,832);
  window.lightingState={selected:[...selected],weights:{...weights},activity,reason:lastReason,settled:raf===0,autoArmed:!!timer};
 }
 function settle(ids,reason){
  clearTimeout(timer);timer=0;cancelAnimationFrame(raf);raf=0;
  selected=[...new Set(ids.filter(id=>spec.variants.some(v=>v.id===id)))];lastReason=reason;
  const from={...weights},startActivity=activity,targetActivity=selected.length?1:0;
  const start=performance.now(),duration=reduced?0:spec.fade_ms;
  document.querySelectorAll('button[data-selection]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.selection.split(',').join(',')===selected.join(','))));
  status.textContent=reason+(selected.length?' · 비선택 칸 감광 / 표면 조명':' · 감광 해제');
  function frame(now){
   const progress=duration?Math.min((now-start)/duration,1):1,t=progress*progress*(3-2*progress);
   for(const v of spec.variants)weights[v.id]=from[v.id]+((selected.includes(v.id)?1:0)-from[v.id])*t;
   activity=startActivity+(targetActivity-startActivity)*t;
   raf=progress<1?requestAnimationFrame(frame):0;draw();
  }
  raf=requestAnimationFrame(frame);
  if(auto.checked&&selected.length)timer=setTimeout(()=>settle([],'자동 소등 완료'),spec.auto_off_ms);
  draw();
 }
 async function boot(){
  base=await loadImage(spec.base);mirror=await loadImage(spec.mirror_ui);
  for(const v of spec.variants)images[v.id]=await loadImage(v.file);
  window.lightingDimensions=spec.variants.map(v=>({id:v.id,width:images[v.id].naturalWidth,height:images[v.id].naturalHeight}));
  makeLayers();draw();status.textContent='기본 조명 · 의류 찾기를 선택하세요';
  document.querySelectorAll('button[data-selection]').forEach(b=>b.onclick=()=>settle(b.dataset.selection?b.dataset.selection.split(','):[],b.textContent.trim()));
  document.querySelector('#unknown').onclick=()=>settle([],'위치 미확인 — 임의 칸을 점등하지 않음');
  ui.onchange=draw;
  auto.onchange=()=>settle(selected,auto.checked?'선택 유지 · 검수용 5초 자동 소등':'선택 유지 · 자동 소등 해제');
  window.lightingReady=true;
  window.lightingSilhouetteData=Object.fromEntries(Object.entries(silhouetteLayers).map(([id,c])=>[id,c.toDataURL('image/png')]));
 }
 boot().catch(e=>{status.textContent=e.message;window.lightingError=e.message});
})();
