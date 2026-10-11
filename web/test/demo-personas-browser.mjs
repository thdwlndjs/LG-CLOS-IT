import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const approved=JSON.parse(await readFile('../docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/templates/approved_scene_manifest.json','utf8'));
const expectedCount=52+approved.items.length;
const output='../test-results/remediation/';
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1672,height:941}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5193');
 const showProfiles=async()=>{
  await page.getByRole('button',{name:'마이',exact:true}).click();
  await page.getByRole('button',{name:'김수진 프로필 선택',exact:true}).waitFor();
  await page.getByRole('button',{name:'최휘재 프로필 선택',exact:true}).waitFor();
 };
 await showProfiles();
 await page.getByText('42세 · 엄마',{exact:true}).waitFor();
 await page.getByText('27세 · 아들',{exact:true}).waitFor();
 await page.screenshot({path:output+'demo-personas.png'});
 const results=[];
 for(const [profile,name] of [['mother','김수진'],['son','최휘재'],['mother','김수진']]){
  const response=page.waitForResponse(r=>r.url().endsWith('/integration/demo-login'));
  await page.getByRole('button',{name:`${name} 프로필 선택`,exact:true}).click();
  const login=await response;assert.equal(login.status(),200);
  assert.equal(login.request().postDataJSON().profile,profile);
  const member=(await login.json()).member;assert.equal(member.display_name,name);
  let state;
  for(let i=0;i<60;i++){
   state=await page.evaluate(async()=>{
    const {app}=await import('/src/mirror/source/appInstance.ts');
    const state=app.getState();
    return {count:app.garments().length,photos:app.garments().filter(g=>g.asset?.id).length,
      owners:new Set(app.garments().map(g=>g.ownerId)).size,
      member:state.profiles.find(p=>p.id===state.activeProfileId)?.name};
   });
   if(state.count===expectedCount&&state.member===name)break;
   await page.waitForTimeout(500);
  }
  assert.deepEqual(state,{count:expectedCount,photos:expectedCount,owners:4,member:name});
  await showProfiles();
  assert.equal(await page.getByRole('button',{name:`${name} 프로필 선택`,exact:true}).getAttribute('aria-pressed'),'true');
  results.push({profile,name,member_id:member.id,...state,result:'PASS'});
 }
 assert.notEqual(results[0].member_id,results[1].member_id);
 await page.getByRole('button',{name:'내 계정',exact:true}).click();
 assert.equal(await page.getByRole('dialog').locator('[data-profile-id]').count(),0);
 assert.deepEqual(errors,[]);
 await writeFile(output+'demo-personas-browser.json',JSON.stringify({entry:'누가 옷장을 사용하나요?',results,errors,result:'PASS'},null,2));
 console.log(JSON.stringify({entry:'profile selector',results,errors,result:'PASS'}));
}finally{await browser.close();}
