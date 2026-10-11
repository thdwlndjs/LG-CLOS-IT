import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=createRequire(new URL('../../../../../web/package.json',import.meta.url))('playwright');
const here=fileURLToPath(new URL('.',import.meta.url));
const spec=JSON.parse(await readFile(here+'lighting.json','utf8'));
const browser=await chromium.launch({args:['--allow-file-access-from-files']});
try {
 const page=await browser.newPage({viewport:{width:1712,height:1200}});
 const errors=[],remote=[],local=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url())){const u=new URL(r.url());if(u.hostname==='127.0.0.1'&&u.port==='5194'&&/^\/wardrobe-(lighting-review-v1|visual-samples-v1)\//.test(u.pathname))local.push(r.url());else remote.push(r.url())}});
 await page.goto(process.argv[2] || new URL('review.html',import.meta.url).href);
 await page.waitForFunction(()=>window.lightingReady || window.lightingError);
 assert.equal(await page.evaluate(()=>window.lightingError),undefined);
 const dims=await page.evaluate(()=>window.lightingDimensions);
 for(const d of dims){assert.ok(Math.abs(d.width-1672)<=1);assert.ok(Math.abs(d.height-941)<=1)}
 await page.locator('#ui').uncheck();
 const silhouettes=await page.evaluate(()=>window.lightingSilhouetteData);
 for(const [id,data] of Object.entries(silhouettes))await writeFile(here+id+'-silhouette-mask.png',Buffer.from(data.split(',')[1],'base64'));
 const settled=()=>page.waitForFunction(()=>window.lightingState.settled);
 const save=async name=>writeFile(here+name,Buffer.from(await page.locator('#scene').evaluate(n=>n.toDataURL('image/png').split(',')[1]),'base64'));
 await settled();await save('baseline.png');
 const checks=[],fullData={};
 for(const v of spec.variants){
  await page.locator('button[data-selection="'+v.id+'"]').click();await settled();
  assert.deepEqual(await page.evaluate(()=>window.lightingState.selected),[v.id]);
  await save(v.id+'-selected.png');
  fullData[v.id]=await page.locator('#scene').evaluate(n=>n.toDataURL('image/png'));
  checks.push({scenario:v.id+' selected',status:'PASS'});
 }
 await page.locator('button[data-selection="B"]').click();await settled();
 await page.locator('#ui').check();await save('B-with-mirror-ui.png');await page.locator('#ui').uncheck();
 await page.locator('button[data-selection="A,B,E1"]').click();await settled();
 assert.deepEqual(await page.evaluate(()=>window.lightingState.selected),['A','B','E1']);
 await save('multi-selected.png');checks.push({scenario:'three compartments together',status:'PASS'});
 await page.locator('#unknown').click();await settled();
 assert.deepEqual(await page.evaluate(()=>window.lightingState.selected),[]);
 await save('unknown-location.png');checks.push({scenario:'unknown location restores ambient, no arbitrary selection',status:'PASS'});
 await page.locator('#auto').check();
 await page.locator('button[data-selection="B"]').click();await settled();
 assert.equal(await page.evaluate(()=>window.lightingState.autoArmed),true);
 await page.waitForFunction(()=>window.lightingState.reason==='자동 소등 완료'&&window.lightingState.settled,{},{timeout:7000});
 assert.deepEqual(await page.evaluate(()=>window.lightingState.selected),[]);
 assert.equal(await page.evaluate(()=>window.lightingState.activity),0);
 await save('auto-off.png');checks.push({scenario:'5-second preview timer restores ambient and cancels dimming',status:'PASS'});
 await page.locator('#auto').uncheck();
 await page.locator('button[data-selection="A"]').click();await settled();
 await page.locator('button[data-selection="B"]').click();await settled();
 assert.deepEqual(await page.evaluate(()=>window.lightingState.selected),['B']);
 checks.push({scenario:'new selection clears previous compartment',status:'PASS'});
 await page.evaluate(async ({spec,fullData})=>{
  const load=src=>new Promise((resolve,reject)=>{const im=new Image;im.onload=()=>resolve(im);im.onerror=reject;im.src=src});
  const base=await load(spec.base),board=document.createElement('div');board.id='closeups';
  Object.assign(board.style,{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'20px',width:'1672px',padding:'20px',boxSizing:'border-box',background:'#eee9e1'});
  for(const v of spec.variants){
   const lit=await load(fullData[v.id]),card=document.createElement('article');
   Object.assign(card.style,{background:'white',padding:'16px'});
   const heading=document.createElement('h2');heading.textContent=v.title+' — 의류 표면';card.append(heading);
   const pair=document.createElement('div');Object.assign(pair.style,{display:'flex',gap:'12px'});
   for(const [label,img] of [['기본 조명',base],['선택 칸 표면 조명',lit]]){
    const col=document.createElement('div');col.style.flex='1';col.style.minWidth='0';const title=document.createElement('p');title.textContent=label;
    const c=document.createElement('canvas'),[x,y,w,h]=v.review_bounds || v.detail;c.width=w*3;c.height=h*3;
    c.style.width='100%';c.style.height='auto';c.style.maxHeight='680px';c.style.objectFit='contain';
    c.getContext('2d').drawImage(img,x,y,w,h,0,0,c.width,c.height);col.append(title,c);pair.append(col);
   }
   card.append(pair);board.append(card);
  }
  document.body.append(board);
 },{spec,fullData});
 await page.locator('#closeups').screenshot({path:here+'lighting-closeups.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 await writeFile(here+'browser-check.json',JSON.stringify({status:'PASS',checks,dimensions:dims,page_errors:errors,external_or_api_requests:remote,local_static_requests:local.length,review_url:page.url(),visual_approval:'PENDING_USER',scope:'Review-only canvas interaction; not application or hardware verification'},null,2)+'\n');
 console.log('PASS: surface-light variants, multi-selection, switching, unknown location, auto-off; no page errors or API requests.');
} finally {await browser.close();}
