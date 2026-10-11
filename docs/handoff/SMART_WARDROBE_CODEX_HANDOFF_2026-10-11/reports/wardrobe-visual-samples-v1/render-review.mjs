import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(new URL('../../../../../web/package.json',import.meta.url))('playwright');
const here=fileURLToPath(new URL('.',import.meta.url));
const manifest=JSON.parse(await readFile(here+'samples.json','utf8'));
const labels={A5:'검정 코트 · 왼쪽 A5',B3:'데님 셔츠 · 왼쪽 B3',C6:'에크루 진 · 왼쪽 C6',K1:'샌드 니트 · E1 왼쪽 위',K2:'네이비 니트 · E1 오른쪽 중간',K3:'차콜 니트 · E4 왼쪽 위'};
function client(manifest) {
 const loadImage=src=>new Promise((resolve,reject)=>{const i=new Image;i.onload=()=>resolve(i);i.onerror=reject;i.src=src});
 let base,images,app,mode='samples';
 function draw(){
  const ctx=document.getElementById('scene').getContext('2d');ctx.drawImage(base,0,0);
  if(mode!=='original')manifest.samples.forEach(s=>{const [x,y,w,h]=s.bounds;ctx.drawImage(images[s.id],x,y,w,h,x,y,w,h)});
  if(mode==='ui')ctx.drawImage(app,712,22,255,832,712,22,255,832);
 }
 (async()=>{
  base=await loadImage(manifest.reference);app=await loadImage('app-before.png');images={};
  for(const s of manifest.samples){
   images[s.id]=await loadImage(s.file);
   const [x,y,w,h]=s.bounds;
   for(const kind of ['original','sample']){
    const c=document.querySelector('.'+kind+'-detail[data-id="'+s.id+'"]');
    const margin=s.id.startsWith('K')?12:10,scale=s.id.startsWith('K')?4:2;
    c.width=(w+margin*2)*scale;c.height=(h+margin*2)*scale;
    const ctx=c.getContext('2d');ctx.scale(scale,scale);
    ctx.drawImage(base,x-margin,y-margin,w+margin*2,h+margin*2,0,0,w+margin*2,h+margin*2);
    if(kind==='sample')ctx.drawImage(images[s.id],x,y,w,h,margin,margin,w,h);
   }
  }
  draw();window.reviewReady=true;
  document.getElementById('original').onclick=()=>{mode='original';draw()};
  document.getElementById('samples').onclick=()=>{mode='samples';draw()};
  document.getElementById('ui').onclick=()=>{mode='ui';draw()};
  window.sampleDimensions=manifest.samples.map(s=>({id:s.id,width:images[s.id].naturalWidth,height:images[s.id].naturalHeight}));
 })();
}
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><title>의류 6개 검수</title><style>body{margin:20px;font:16px system-ui;background:#eee9e1;color:#29251f}h1{font-size:24px}button{padding:10px 18px;margin:0 6px 12px 0}canvas{max-width:100%;height:auto;display:block}#stage{width:1672px;max-width:100%}#scene{width:1672px;height:941px;max-width:none}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:25px}.card{padding:16px;background:white;min-width:0}.pair{display:flex;align-items:center;gap:10px}.pair>div{flex:1;min-width:0}.detail{width:100%;max-height:540px;object-fit:contain}.product{height:130px;width:auto;max-width:100%;object-fit:contain}small{display:block;margin:8px 0;color:#655a4b}</style><h1>원본 옷장에 합성한 의류 샘플 6개</h1><p>행거 A5·B3·C6 / 선반 K1·K2·K3. 나머지 의류와 구조는 원본 유지. 앱·DB 미반영.</p><button id="original">원본 보기</button><button id="samples">샘플 합성 보기</button><button id="ui">실제 미러 UI 합성 보기</button><div id="stage"><canvas id="scene" width="1672" height="941"></canvas></div><div class="cards">'+manifest.samples.map(s=>'<article class="card" data-id="'+s.id+'"><h2>'+s.id+' · '+labels[s.id]+'</h2><small>원본 / 생성 샘플 (동일 좌표, 확대)</small><div class="pair"><div><canvas class="detail original-detail" data-id="'+s.id+'"></canvas></div><div><canvas class="detail sample-detail" data-id="'+s.id+'"></canvas></div></div><small>상품 정체성 참고용 사진 · 최종 에셋 아님</small><img class="product" src="../wardrobe-visual-review/candidate-photos/'+s.id+'.jpg"></article>').join('')+'</div><script>('+client.toString()+')('+JSON.stringify(manifest)+');</script></html>';
await writeFile(here+'review.html',html);
const browser=await chromium.launch({args:['--allow-file-access-from-files']});
try{
 const page=await browser.newPage({viewport:{width:1712,height:1200}});
 const remote=[];page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 await page.goto(new URL('review.html',import.meta.url).href);
 await page.waitForFunction(()=>window.reviewReady);
 await page.locator('#stage').evaluate(n=>{const r=n.getBoundingClientRect();n.style.transform='translate('+(Math.ceil(r.x)-r.x)+'px,'+(Math.ceil(r.y)-r.y)+'px)';});
 await page.locator('img').evaluateAll(nodes=>Promise.all(nodes.map(i=>i.decode())));
 const dimensions=await page.evaluate(()=>window.sampleDimensions);
 dimensions.forEach(d=>{assert.ok(d.width===1672 || d.width===1671);assert.equal(d.height,941)});
 const saveScene=async name=>writeFile(here+name,Buffer.from(await page.locator('#scene').evaluate(n=>n.toDataURL('image/png').split(',')[1]),'base64'));
 await saveScene('wardrobe-composite.png');
 await page.locator('.cards').screenshot({path:here+'six-sample-closeups.png'});
 for(const s of manifest.samples)await page.locator('.sample-detail[data-id="'+s.id+'"]').screenshot({path:here+s.id+'-sample.png'});
 await page.locator('#ui').click();await saveScene('actual-screen-composite.png');
 await page.locator('#original').click();await saveScene('original-browser.png');
 assert.deepEqual(remote,[]);
 await writeFile(here+'verification.json',JSON.stringify({render:'PASS',sample_count:6,dimensions,review_network_requests:0,app_applied:false,db_applied:false,visual_approval:'PENDING_USER',note:'Rendering verification only. Actual-screen composite uses read-only captured mirror UI; not an integrated runtime screenshot.'},null,2));
 console.log('PASS: six context edits, original/sample/UI composites, six closeups, no review network requests.');
}finally{await browser.close();}
