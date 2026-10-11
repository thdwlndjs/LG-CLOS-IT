import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('..');
const runtime=JSON.parse(await readFile(resolve(root,'test-results/handoff/runtime.json'),'utf8'));
const expectedCount=JSON.parse(await readFile(resolve(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/templates/remediation_products.json'),'utf8')).count;
const evidence=resolve(root,'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/remediation');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1672,height:941}});
const checks=[],errors=[],failed=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400 && !r.url().includes('favicon'))failed.push({url:new URL(r.url()).pathname,status:r.status()});});
await page.route('**/*',route=>{
 const u=new URL(route.request().url());
 if(['http:','https:'].includes(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
 return route.continue();
});
const menu=name=>page.getByRole('button',{name,exact:true}).click();
const state=()=>page.evaluate(async()=>{
 const {app}=await import('/src/mirror/source/appInstance.ts');
 return {count:app.garments().length,owners:[...new Set(app.garments().map(g=>g.ownerId))],
   photos:app.garments().filter(g=>g.asset?.id).length,connection:app.connection.kind};
});
const snap=name=>page.screenshot({path:resolve(evidence,name+'.png')});
try {
 await page.goto('http://127.0.0.1:5193');
 for(const actor of ['mom','son']){
  await menu('마이');await menu('내 계정');
  await page.getByLabel('계정',{exact:true}).fill('remediation-'+actor);
  await page.getByLabel('비밀번호',{exact:true}).fill(runtime.demo_password);
  await page.locator('summary').filter({hasText:'다른 기기에서 접속'}).click();
  await page.getByLabel('접속 기기 ID · 선택').fill(runtime.remediation_station_id);
  await page.getByLabel('기기 인증 · 선택').fill(runtime.remediation_station_credential);
  await menu('내 계정으로 로그인');
  for(let i=0;i<60;i++){
    if((await state()).count===expectedCount&&(await state()).connection==='supabase')break;
    await page.waitForTimeout(500);
  }
  const loaded=await state();
  assert.equal(loaded.count,expectedCount);assert.equal(loaded.photos,expectedCount);assert.equal(loaded.connection,'supabase');
  assert.equal((await state()).owners.length,4);
  if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
  await menu('홈');
  const expectedScene=await page.evaluate(async()=>{const {api,currentDevice}=await import('/src/mirror/source/integrations/backendClient.ts');return (await api().get(`/integration/devices/${currentDevice()}/scene`)).items.length;});
  assert.ok(expectedScene>=30);
  await page.waitForFunction(n=>document.querySelectorAll('[data-scene-item-id]').length===n,expectedScene);
  await page.evaluate(async()=>{
    for(const node of document.querySelectorAll('[data-scene-item-id]')){
      const image=new Image();image.src=node.tagName==='IMG'?node.src:node.querySelector('image').getAttribute('href');
      await image.decode();if(image.naturalWidth<=100)throw Error('Placeholder scene image');
    }
  });
  await snap(actor+'-home-51-images');
  const recommendations=await page.locator('.mx-home-open').count();
  assert.ok(recommendations>=2&&recommendations<=3,actor+' distinct owned recommendations');
  checks.push({actor,step:'login/family/verified image assets/internal scene/owned recommendations',result:'PASS',dataset:expectedCount,visible:expectedScene,recommendations});
  const hit=page.locator('[data-scene-hit-id]').first();
  const gid=await hit.getAttribute('data-scene-hit-id');await hit.click();
  await page.waitForFunction(()=>document.querySelectorAll('.photo-scene-led[data-led="on"]').length===1);
  const same=await page.evaluate(id=>{
   const hit=document.querySelector(`[data-scene-hit-id="${id}"]`).getBoundingClientRect();
   const led=document.querySelector('.photo-scene-led[data-led="on"]').getBoundingClientRect();
   return Math.abs(hit.x-led.x)<1&&Math.abs(hit.y-led.y)<1&&Math.abs(hit.width-led.width)<1;
  },gid);assert.equal(same,true);await snap(actor+'-find-led');
  await page.waitForFunction(()=>document.querySelectorAll('.photo-scene-led[data-led="on"]').length===0,{},{timeout:16000});
  checks.push({actor,step:'click actual garment -> same slot Mock LED -> automatic off',result:'PASS'});
  await menu('홈');
  await page.locator('.mx-home-carousel').evaluate(el=>{el.scrollLeft=el.clientWidth;});
  const carouselPosition=await page.locator('.mx-home-carousel').evaluate(el=>el.scrollLeft);
  await page.locator('.mx-home-open').nth(1).click();
  await page.getByRole('button',{name:'Mock 피팅',exact:true}).click();
  await page.getByRole('group',{name:'Mock 피팅 입력'}).getByRole('checkbox').check();
  await page.getByRole('group',{name:'Mock 피팅 입력'}).locator('input[type=file]').setInputFiles(resolve(root,'web/public/assets/wardrobe-pack/demo/LOOK01_sweats.png'));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Mock VTON 실행'&&!b.disabled));
  await menu('Mock VTON 실행');
  await page.waitForFunction(()=>document.querySelector('.mx-person-result img')?.complete || document.body.textContent.includes('Mock VTON 결과 · 실제 피팅 아님'),{},{timeout:45000});
  await snap(actor+'-owned-mock-vton');
  await page.getByRole('button',{name:'카드 탐색으로 돌아가기'}).click();
  await page.waitForFunction(()=>document.querySelector('.mx-surface')?.dataset.screen==='home');
  assert.equal(await page.locator('.mx-home-open').count(),recommendations);
  assert.ok(Math.abs((await page.locator('.mx-home-carousel').evaluate(el=>el.scrollLeft))-carouselPosition)<2,'home carousel selection remains unchanged');
  checks.push({actor,step:'owned recommendation -> consent/upload -> Mock VTON -> same home recommendations',result:'PASS'});
  {
    await page.locator('.mx-home-open').first().click();
    await page.getByRole('button',{name:'비교 더 보기',exact:true}).click();
    for(const template of ['T1-v1','T2-v1','T3-v1','T4-v1']){
      const previous=await page.evaluate(async()=>{const {api}=await import('/src/mirror/source/integrations/backendClient.ts');return (await api().get('/cards?limit=100')).items.map(c=>c.id);});
      await page.getByLabel('카드 레이아웃').selectOption(template);
      await menu('코디카드로 저장');
      for(let i=0;i<90;i++){
        const done=await page.evaluate(async({id,previous})=>{
          const {api}=await import('/src/mirror/source/integrations/backendClient.ts');
          const cards=await api().get('/cards?limit=100');
          return cards.items.find(c=>c.template_id===id&&!previous.includes(c.id)&&c.is_saved&&c.image_asset);
        },{id:template,previous});
        if(done){
          const file=await page.request.get(new URL('/local-storage'+new URL(done.image_asset.read_url).pathname+new URL(done.image_asset.read_url).search,'http://127.0.0.1:5193').href);
          assert.equal(file.status(),200);const png=await file.body();assert.ok(png.length>10000);
          await writeFile(resolve(evidence,actor+'-'+template+'.png'),png);
          checks.push({actor,step:template+' UI select -> React/Playwright -> private MinIO -> saved DB -> requery/download',result:'PASS',bytes:png.length});
          break;
        }
        if(i===89)throw Error(template+' card not saved');
        await page.waitForTimeout(500);
      }
      await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent==='카드 저장 중'));
    }
    await snap('mom-card-templates');
    await page.getByRole('button',{name:'카드 탐색으로 돌아가기'}).click();
    if(actor==='mom'){
    await menu('실제 기록');
    const before=await page.evaluate(async()=>{const {api}=await import('/src/mirror/source/integrations/backendClient.ts');return (await api().get('/garments?limit=100')).items.map(g=>[g.id,g.location_id]).sort((a,b)=>a[0].localeCompare(b[0]));});
    await menu('겨울 보관·회수 제안 만들기');
    await page.waitForFunction(()=>document.querySelectorAll('[data-storage-action-id]').length>0,{},{timeout:45000});
    await snap('mom-winter-proposal');
    const rows=page.locator('[data-storage-action-id]');
    let selected;
    for(const row of await rows.all()){
      if(await row.getByRole('button',{name:'제안 승인',exact:true}).count()){selected=row;break;}
    }
    assert.ok(selected,'actual feasible storage proposal');
    const actionId=await selected.getAttribute('data-storage-action-id');
    await selected.getByRole('button',{name:'제안 승인',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector(`[data-storage-action-id="${id}"]`)?.textContent.includes('APPROVED'),actionId);
    const approved=await page.evaluate(async()=>{const {api}=await import('/src/mirror/source/integrations/backendClient.ts');return (await api().get('/garments?limit=100')).items.map(g=>[g.id,g.location_id]).sort((a,b)=>a[0].localeCompare(b[0]));});
    assert.deepEqual(approved,before,'approval must not change locations');
    selected=page.locator(`[data-storage-action-id="${actionId}"]`);
    await selected.getByRole('checkbox').first().check();
    await selected.getByRole('button',{name:'선택한 의류 이동 완료 저장',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('선택한 품목의 이동 완료를 저장했습니다.'),{},{timeout:30000});
    const after=await page.evaluate(async()=>{const {api}=await import('/src/mirror/source/integrations/backendClient.ts');return (await api().get('/garments?limit=100')).items.map(g=>[g.id,g.location_id]).sort((a,b)=>a[0].localeCompare(b[0]));});
    assert.notDeepEqual(after,before);await snap('mom-storage-completed-scene-refreshed');
    checks.push({actor,step:'winter proposal -> approve leaves DB intact -> explicit completion changes DB -> scene refresh',result:'PASS',actionId});
    // Independently exercise retrieval, rather than inferring it from a store success.
    const retrieval=await page.evaluate(async()=>{
      const {api}=await import('/src/mirror/source/integrations/backendClient.ts');
      const actions=(await api().get('/storage-actions?limit=100')).items;
      const garments=(await api().get('/garments?limit=100')).items;
      for(const action of actions.filter(a=>['PROPOSED','APPROVED','AWAITING_CONFIRMATION'].includes(a.status))){
        const item=action.items.find(i=>['PENDING','AWAITING_CONFIRMATION'].includes(i.status)&&garments.some(g=>g.id===i.garment_id&&g.status==='STORED'&&g.location_id===i.source_location_id));
        if(item)return {action,item};
      }
      return null;
    });
    assert.ok(retrieval,'winter retrieval remains feasible');
    const retrievalRow=page.locator(`[data-storage-action-id="${retrieval.action.id}"]`);
    if(retrieval.action.status==='PROPOSED'){
      await retrievalRow.getByRole('button',{name:'제안 승인',exact:true}).click();
      await page.waitForFunction(id=>document.querySelector(`[data-storage-action-id="${id}"]`)?.textContent.includes('APPROVED'),retrieval.action.id);
    }
    const index=retrieval.action.items.findIndex(i=>i.id===retrieval.item.id);
    await retrievalRow.getByRole('checkbox').nth(index).check();
    await retrievalRow.getByRole('button',{name:'선택한 의류 이동 완료 저장',exact:true}).click();
    for(let i=0;i<60;i++){
      const location=await page.evaluate(async(id)=>{const {api}=await import('/src/mirror/source/integrations/backendClient.ts');return (await api().get('/garments/'+id)).location_id;},retrieval.item.garment_id);
      if(location===retrieval.item.destination_location_id)break;
      if(i===59)throw Error('retrieval did not change DB');await page.waitForTimeout(500);
    }
    await page.waitForSelector(`[data-scene-item-id="${retrieval.item.garment_id}"]`);
    await snap('mom-winter-retrieved-scene');
    checks.push({actor,step:'explicit winter retrieval -> destination DB -> newly visible scene item',result:'PASS',garment_id:retrieval.item.garment_id});
    }
  }
  await menu('마이');await menu('내 계정');
  if(actor==='mom'){
    await page.locator('summary').filter({hasText:'쇼핑 및 추가 기능'}).click();
    const tools=page.getByRole('region',{name:'통합 기능'});
    await tools.getByRole('checkbox').first().check();
    await tools.locator('input[type=file]').setInputFiles(resolve(root,'web/public/assets/wardrobe-pack/demo/LOOK01_sweats.png'));
    await page.waitForFunction(()=>document.body.textContent.includes('인물 사진 업로드 완료'));
    await tools.getByRole('button',{name:'LIKED 조회',exact:true}).click();
    await tools.getByRole('button',{name:'이 상품 Mock VTON',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('LIKED Mock VTON 성공'),{},{timeout:45000});
    assert.equal((await state()).count,expectedCount);
    const history=await page.evaluate(async()=>{const {api}=await import('/src/mirror/source/integrations/backendClient.ts');return (await api().get('/history?limit=100')).items;});
    assert.equal(history.length,0,'VTON/card/storage do not auto-create wear history');
    await snap('mom-liked-mock-no-owned-or-wear');
    checks.push({actor,step:'LIKED browser Mock VTON -> same inventory -> no automatic wear history',result:'PASS'});
  }
  await menu('로그아웃');
  await page.waitForFunction(async()=>{const {currentMember}=await import('/src/mirror/source/integrations/backendClient.ts');return !currentMember();});
 }
 assert.equal(errors.length,0);
 await writeFile(resolve(evidence,'browser.json'),JSON.stringify({checks,errors,failed,paid_calls:false,hardware:false},null,2));
 console.log(JSON.stringify({checks,errors,failed}));
}catch(e){await snap('failure');await writeFile(resolve(evidence,'browser-failure.json'),JSON.stringify({checks,errors,failed,error:String(e)},null,2));throw e;}
finally{await browser.close();}
