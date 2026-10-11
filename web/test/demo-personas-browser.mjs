import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const output = '../test-results/remediation/';
await mkdir(output, {recursive:true});
const browser = await chromium.launch();
const results = [];
try {
  const page = await browser.newPage({viewport:{width:1672,height:941}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['http:','https:'].includes(url.protocol) && !['localhost','127.0.0.1'].includes(url.hostname)
      ? route.abort() : route.continue();
  });
  await page.goto('http://127.0.0.1:5193');
  await page.getByRole('button',{name:'마이',exact:true}).click();
  await page.getByRole('button',{name:'내 계정',exact:true}).click();
  await page.getByRole('button',{name:/김수진.*42세.*엄마/}).waitFor();
  await page.getByRole('button',{name:/최휘재.*27세.*아들/}).waitFor();
  await page.screenshot({path:output+'demo-personas.png'});
  for (const [profile, name] of [['mother','김수진'],['son','최휘재']]) {
    const response = page.waitForResponse(r => r.url().endsWith('/integration/demo-login'));
    await page.getByRole('button',{name:new RegExp(name)}).click();
    const login = await response;
    assert.equal(login.status(),200);
    assert.equal(login.request().postDataJSON().profile,profile);
    const member = (await login.json()).member;
    assert.equal(member.display_name,name);
    let state;
    for (let attempt=0;attempt<60;attempt++) {
      state=await page.evaluate(async () => {
        const {app}=await import('/src/mirror/source/appInstance.ts');
        return {count:app.garments().length,photos:app.garments().filter(g=>g.asset?.id).length,
          owners:new Set(app.garments().map(g=>g.ownerId)).size};
      });
      if(state.count===52) break;
      await page.waitForTimeout(500);
    }
    assert.deepEqual(state,{count:52,photos:52,owners:4});
    if (!(await page.getByRole('button',{name:'로그아웃',exact:true}).count())) {
      await page.getByRole('button',{name:'마이',exact:true}).click();
      await page.getByRole('button',{name:'내 계정',exact:true}).click();
    }
    await page.getByRole('dialog').getByText(name,{exact:true}).waitFor();
    const logout=page.waitForResponse(r=>r.url().endsWith('/integration/logout'));
    await page.getByRole('button',{name:'로그아웃',exact:true}).click();
    assert.equal((await logout).status(),200);
    await page.waitForFunction(async () => {
      const {app}=await import('/src/mirror/source/appInstance.ts');
      const {currentMember}=await import('/src/mirror/source/integrations/backendClient.ts');
      return !currentMember() && app.connection.kind!=='supabase';
    });
    await page.waitForTimeout(300);
    if (!(await page.getByRole('dialog').count())) {
      await page.getByRole('button',{name:'마이',exact:true}).click();
      await page.getByRole('button',{name:'내 계정',exact:true}).click();
    }
    await page.getByRole('button',{name:/김수진.*42세.*엄마/}).waitFor();
    await page.getByRole('button',{name:/최휘재.*27세.*아들/}).waitFor();
    results.push({profile,name,member_id:member.id,...state,login:'PASS',logout:'PASS'});
  }
  assert.notEqual(results[0].member_id,results[1].member_id);
  assert.deepEqual(errors,[]);
  await writeFile(output+'demo-personas-browser.json',JSON.stringify({results,errors,result:'PASS'},null,2));
  console.log(JSON.stringify({results,errors,result:'PASS'}));
} finally { await browser.close(); }
