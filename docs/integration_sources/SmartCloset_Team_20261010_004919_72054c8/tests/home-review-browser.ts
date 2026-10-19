import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const phase=process.env.REVIEW_PHASE||'before';
assert.ok(['before','after'].includes(phase));
const output=path.resolve('evidence/home-resume-20261008',phase);
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,slowMo:70,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
const context=await browser.newContext({viewport:{width:1600,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block',...(phase==='after'?{recordVideo:{dir:path.join(output,'recordings'),size:{width:1600,height:1000}}}:{})});
const external:string[]=[],failures:string[]=[];
await context.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)){external.push(u.origin);return route.abort();}return route.continue();});
const page=await context.newPage();page.on('pageerror',e=>failures.push(e.message));
async function ready(){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>undefined)));});}
async function shot(name:string){await ready();await page.screenshot({path:path.join(output,name+'.png')});}
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('smartcloset.stage1.demo.v1')||'null'));
try{
 await page.goto('http://127.0.0.1:4311/');await page.getByRole('button',{name:'새 이미지팩 시연',exact:true}).waitFor();await shot('01-first-screen');
 await page.getByRole('button',{name:'새 이미지팩 시연',exact:true}).click();await page.getByRole('button',{name:'LOOK02 열기',exact:true}).click();await shot('02-outfit-open');
 await page.getByRole('button',{name:'고정',exact:true}).click();await page.locator('.candidate-list').getByRole('button',{name:'블랙 슬랙스 블랙 슬랙스',exact:true}).click();
 let s=await state();assert.deepEqual(s.outfitDrafts['wardrobe-pack-demo'].items,{top:'T05',bottom:'B01',shoes:'S04'});assert.equal(await page.locator('[data-compartment-id="left-hanger-d"]').getAttribute('data-led'),'on');await shot('03-bottom-led');
 await page.getByRole('button',{name:'입어보기',exact:true}).click();await page.getByRole('button',{name:'준비된 착장 예시 보기',exact:true}).click();assert.equal(await page.locator('.person-stage').getAttribute('data-person-id'),'DEMO_PERSON01');assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'true');assert.match(await page.locator('.person-stage img').getAttribute('src')||'',/LOOK03/);await shot('04-prepared-fitting');
 await page.getByRole('button',{name:'피팅 종료',exact:true}).click();await page.getByLabel('코디 이름',{exact:true}).fill('검수 · 상의 유지, 하의 교체');await page.getByRole('button',{name:'코디 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'코디를 저장했어요'}).waitFor();await page.reload();await page.getByRole('button',{name:'이 저장 코디로 편집',exact:true}).waitFor();s=await state();const saved=s.outfits.find((o:any)=>o.id===s.ui['wardrobe-pack-demo'].selectedOutfitId);assert.deepEqual(saved.items,{top:'T05',bottom:'B01',shoes:'S04'});assert.equal(s.events.length,0);await shot('05-saved-reloaded');
 await page.getByRole('button',{name:'이 저장 코디로 편집',exact:true}).click();const lock=page.getByRole('button',{name:'고정됨',exact:true});if(await lock.count())await lock.click();await page.getByLabel('바꿀 종류',{exact:true}).selectOption('top');await page.locator('.candidate-list').getByRole('button',{name:'그레이 맨투맨 그레이 맨투맨',exact:true}).click();s=await state();assert.deepEqual(s.outfitDrafts['wardrobe-pack-demo'].items,{top:'T07',bottom:'B01',shoes:'S04'});assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');await page.getByRole('button',{name:'입어보기',exact:true}).click();await page.getByRole('button',{name:'준비된 착장 예시 보기',exact:true}).click();assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'false');assert.match(await page.locator('#mirror-control-panel').innerText(),/일치하는 준비 결과가 없습니다/);await shot('06-top-no-false-fitting');
 for(const label of ['홈','옷장','캘린더','케어','마이','코디']){await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:label,exact:true}).click();assert.equal(await page.locator('.person-stage').getAttribute('data-person-id'),'DEMO_PERSON01');assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);}
 await shot('07-menu-context');
 // Explicit availability confirmations govern review suggestions; the backing inventory is untouched.
 const review=page.getByRole('region',{name:'보유 의류 점검'});
 const originalInventory=structuredClone(s.garments);const targetName=s.garments.find((g:any)=>g.ownerId==='wardrobe-pack-demo'&&g.id==='B03').name;
 const candidate=review.locator('.outfit-review-candidates li').filter({hasText:targetName});
 assert.equal(await candidate.getByRole('button',{name:'이 옷으로 교체'}).isEnabled(),false);
 await candidate.getByRole('combobox').selectOption('available');assert.equal(await candidate.getByRole('button',{name:'이 옷으로 교체'}).isEnabled(),true);
 await candidate.getByRole('button',{name:'이 옷으로 교체'}).click();s=await state();assert.deepEqual(s.outfitDrafts['wardrobe-pack-demo'].items,{top:'T07',bottom:'B03',shoes:'S04'});assert.deepEqual(s.garments,originalInventory);await shot('08-owned-card-review');
 const openSaved=async()=>{await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'코디',exact:true}).click();const details=page.locator('.saved-outfits-panel');if(await details.getAttribute('open')===null)await details.locator('summary').click();await page.locator('.saved-looks').getByRole('button').filter({hasText:'검수 · 상의 유지, 하의 교체'}).click();};
 await openSaved();await page.getByRole('button',{name:'실제 착용 기록',exact:true}).click();await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'사용자가 확인한 기록을 저장했어요'}).waitFor();s=await state();assert.equal(s.events.filter((e:any)=>e.kind==='wear').length,1);await shot('09-confirmed-wear');
 await openSaved();await page.getByRole('button',{name:'실제 착용 기록',exact:true}).click();await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'중복으로 추가하지 않았어요'}).waitFor();s=await state();assert.equal(s.events.filter((e:any)=>e.kind==='wear').length,1);
 await openSaved();await page.getByRole('button',{name:'착용 계획',exact:true}).click();await page.getByRole('button',{name:'확인하여 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'사용자가 확인한 기록을 저장했어요'}).waitFor();s=await state();assert.equal(s.events.filter((e:any)=>e.kind==='wear').length,1);assert.equal(s.events.filter((e:any)=>e.kind==='plan').length,1);await shot('10-plan-wear-separated');
 assert.deepEqual(external,[]);assert.deepEqual(failures,[]);await fs.writeFile(path.join(output,'results.json'),JSON.stringify({phase,tests:'core flow, exact input matching, top/bottom isolation, reload, no implicit wear, six menus, overflow, available-only review candidates, explicit wear, duplicate wear guard, plan/wear separation',status:'PASS',external,failures,mode:'local prepared-static; no remote DB or paid calls',viewport:{width:1600,height:1000}},null,2));console.log('PASS '+phase+' review; screenshots in '+output);
}catch(e){await shot('failure');throw e;}finally{const video=page.video();await context.close();if(video)await video.saveAs(path.join(output,'core-flow.webm'));await browser.close();}
