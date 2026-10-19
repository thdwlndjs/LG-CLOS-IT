import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base='http://127.0.0.1:4311';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext();
let mode:'success'|'failure'|'missing'='success';
let savedRequests=0;
const blocked:string[]=[];
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmLcAAAAASUVORK5CYII=','base64');
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.origin!==base){blocked.push(request.url());await route.abort();return;}
 if(url.pathname==='/api/try-on'){
  const body=request.postDataJSON();assert.equal(body.mode,'saved_result');savedRequests++;
  if(mode==='failure')return route.fulfill({status:503,json:{error:{code:'backend_unavailable',message:'Fixture retrieval failed'}}});
  if(mode==='missing')return route.fulfill({status:404,json:{error:{code:'result_unavailable',message:'Fixture result missing'}}});
  return route.fulfill({status:200,json:{mode:'saved_result',processing_status:'succeeded',apply_status:'not_applied',
   operation_id:'33333333-3333-4333-8333-333333333333',result_asset_id:'44444444-4444-4444-8444-444444444444'}});
 }
 if(url.pathname==='/api/assets/44444444-4444-4444-8444-444444444444/content')return route.fulfill({status:200,contentType:'image/png',body:image});
 if(url.pathname.startsWith('/api/')){blocked.push(request.url());await route.abort();return;}
 await route.continue();
});
const page=await context.newPage();
const load=async()=>{
 mode='success';await page.goto(base+'/tests/fixtures/fitting-recovery.html');
 await page.getByRole('checkbox',{name:/입력 영상은 중앙에 선택한 사진/}).check();
 await page.getByRole('button',{name:'저장된 피팅 결과 조회 · 새 API 실행 없음'}).click();
 await page.waitForFunction(()=>document.querySelector('[data-testid="scene-result"]')?.textContent?.startsWith('blob:'));
 assert.equal(await page.getByTestId('scene-request').textContent(),'completed');
 return await page.getByTestId('scene-result').textContent();
};
try{
 const successfulUrl=await load();
 mode='failure';
 await page.getByRole('button',{name:'저장된 피팅 결과 조회 · 새 API 실행 없음'}).click();
 await page.getByRole('status').filter({hasText:'이전 정상 피팅 결과를 유지합니다.'}).waitFor();
 assert.equal(await page.getByTestId('scene-result').textContent(),successfulUrl);
 assert.equal(await page.getByTestId('scene-request').textContent(),'completed');
 mode='missing';
 await page.getByRole('button',{name:'저장된 피팅 결과 조회 · 새 API 실행 없음'}).click();
 await page.getByRole('status').filter({hasText:'이전 정상 피팅 결과를 유지합니다.'}).waitFor();
 assert.equal(await page.getByTestId('scene-result').textContent(),successfulUrl);
 assert.equal(await page.getByTestId('scene-request').textContent(),'completed');
 await page.getByRole('button',{name:'Fixture: change outfit'}).click();
 assert.equal(await page.getByTestId('scene-result').textContent(),'');
 assert.equal(await page.getByTestId('scene-request').textContent(),'none');
 await load();await page.getByRole('button',{name:'연결 종료',exact:true}).click();
 assert.equal(await page.getByTestId('scene-result').textContent(),'');
 await load();await page.getByRole('button',{name:'Fixture: logout'}).click();
 assert.equal(await page.getByTestId('scene-result').textContent(),'');
 assert.equal(await page.getByTestId('scene-request').textContent(),'none');
 assert.equal(savedRequests,5);assert.deepEqual(blocked,[]);
 console.log('PASS: actual FittingControls retains the prior result after same-input HTTP failure / missing result; outfit change, stop and logout clear it. Five fixture-only saved lookups; no live/provider calls.');
}finally{await context.close();await browser.close();}


