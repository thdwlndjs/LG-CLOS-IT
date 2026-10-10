import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const b=await chromium.launch(),p=await b.newPage(),checks=[],errors=[];
p.on('pageerror',e=>errors.push(e.message));
const open=async()=>{await p.getByRole('button',{name:'마이',exact:true}).click();await p.getByRole('button',{name:'내 계정',exact:true}).click();};
try{
 for(const [width,height] of [[360,800],[390,844],[667,375],[1366,768],[1672,941]]){
  await p.setViewportSize({width,height});await p.goto(process.env.ACCOUNT_ORIGIN||'http://127.0.0.1:5181');await open();
  const panel=p.locator('.mx-auth-dialog .mirror-account-panel');
  await p.getByLabel('계정',{exact:true}).fill('qa-user');await p.getByLabel('비밀번호',{exact:true}).fill('qa-password');
  await p.getByText('다른 기기에서 접속 · 선택',{exact:true}).click();await p.getByLabel('접속 기기 ID · 선택',{exact:true}).fill('qa-device');
  const submit=p.getByRole('button',{name:'내 계정으로 로그인',exact:true});await submit.scrollIntoViewIfNeeded();
  const box=await submit.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height);
  const sizes=await panel.evaluate(e=>({height:e.clientHeight,width:e.clientWidth,scroll:e.scrollHeight,horizontal:e.scrollWidth>e.clientWidth+1}));assert.ok(sizes.height>100);assert.equal(sizes.horizontal,false);
  await p.getByText('다른 기기에서 접속 · 선택',{exact:true}).click();await panel.evaluate(e=>e.scrollTop=0);
  await p.screenshot({path:`test-results/account-after-${width}.png`});
  await p.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();assert.equal(await p.getByRole('dialog').count(),0);
  checks.push({viewport:[width,height],...sizes,fields:true,submit_reachable:true,close:true});
 }
 await p.setViewportSize({width:390,height:844});await open();
 const response=p.waitForResponse(r=>r.url().endsWith('/integration/demo-login')&&r.request().method()==='POST');await p.getByRole('button',{name:'시연용 로그인',exact:true}).click();assert.equal((await response).status(),200);
 await p.waitForFunction(()=>document.querySelector('[data-profile-id]')?.dataset.profileId.startsWith('20000000'));
 await open();assert.equal(await p.getByRole('button',{name:'내 옷장 다시 불러오기',exact:true}).count(),1);await p.getByRole('button',{name:'내 옷장 다시 불러오기',exact:true}).click();await p.getByText('내 옷장을 다시 불러왔습니다.',{exact:true}).waitFor();
 await p.getByText('연결된 옷장',{exact:true}).click();await p.screenshot({path:'test-results/account-after-connected.png'});
 await p.getByText('쇼핑 및 추가 기능',{exact:true}).click();await p.getByRole('button',{name:'LIKED 조회',exact:true}).click();await p.getByText('LIKED · 보유 의류 아님',{exact:true}).waitFor();
 await p.getByText('쇼핑 및 추가 기능',{exact:true}).click();await p.getByRole('button',{name:'로그아웃',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('[data-profile-id]')?.dataset.profileId.startsWith('20000000'));
 checks.push({demo_login:true,reload:true,device_details:true,liked_read_only:true,logout:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
}finally{await writeFile('test-results/account-browser.json',JSON.stringify({checks,errors},null,2));await b.close();}
