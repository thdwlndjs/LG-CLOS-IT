import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const evidence=fileURLToPath(new URL('../../test-results/remediation/',import.meta.url));
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1672,height:941}});
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  return ['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname)
   ? route.abort() : route.continue();
 });
 const account=async()=>{
  await page.getByRole('button',{name:'마이',exact:true}).click();
  await page.getByRole('button',{name:'내 계정',exact:true}).click();
 };
 await page.goto('http://127.0.0.1:5193');
 await account();
 const response=page.waitForResponse(r=>r.url().includes('/integration/demo-login'));
 await page.getByRole('button',{name:/최휘재.*시연용 로그인/}).click();
 assert.equal((await response).status(),200);
 let state;
 for(let i=0;i<60;i++){
  state=await page.evaluate(async()=>{
   const {app}=await import('/src/mirror/source/appInstance.ts');
   return {count:app.garments().length,photos:app.garments().filter(g=>g.asset?.id).length,
    owners:new Set(app.garments().map(g=>g.ownerId)).size};
  });
  if(state.count===52)break;
  await page.waitForTimeout(500);
 }
 assert.deepEqual(state,{count:52,photos:52,owners:4});
 if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'홈',exact:true}).click();
 await page.locator('[data-scene-item-id]').first().waitFor();
 await page.screenshot({path:evidence+'demo-login-fixed.png'});
 if(!(await page.getByRole('button',{name:'로그아웃',exact:true}).count()))await account();
 const logout=page.waitForResponse(r=>r.url().includes('/integration/logout'));
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();
 assert.equal((await logout).status(),200);
 await page.waitForTimeout(300);
 if(!(await page.getByRole('dialog').count()))await account();
 await page.getByRole('button',{name:/최휘재.*시연용 로그인/}).waitFor();
 console.log(JSON.stringify({demo_button:'PASS',family_data:state,scene:'PASS',logout:'PASS'}));
}finally{await browser.close();}
