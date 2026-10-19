import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:4311';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext();
const blocked:string[]=[];
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin!==origin||url.pathname.startsWith('/api/')){blocked.push(url.href);await route.abort();return;}
 await route.continue();
});
const page=await context.newPage();
try{
 await page.goto(origin+'/tests/fixtures/fitting-stream.html');
 await page.getByRole('button',{name:'Synthetic: start',exact:true}).click();
 await page.waitForFunction(()=>{const video=document.querySelector('.person-stage video') as HTMLVideoElement|null;return video?.srcObject instanceof MediaStream&&video.readyState>=2;});
 assert.equal(await page.locator('.person-stage').getAttribute('data-fitting-applied'),'true');
 const firstId=await page.getByTestId('active-stream').textContent();
 await page.getByRole('button',{name:'Synthetic: late event',exact:true}).click();
 assert.equal(await page.getByTestId('active-stream').textContent(),firstId);
 assert.deepEqual(await page.evaluate(()=>window.streamFixture.streams[1].getTracks().map(track=>track.readyState)),['ended']);
 await page.getByRole('button',{name:'Synthetic: start',exact:true}).click();
 await page.waitForFunction(()=>window.streamFixture.streams[0].getTracks().every(track=>track.readyState==='ended'));
 assert.notEqual(await page.getByTestId('active-stream').textContent(),firstId);
 await page.getByRole('button',{name:'Synthetic: change owner',exact:true}).click();
 assert.equal(await page.getByTestId('active-stream').textContent(),'');
 assert.equal(await page.locator('.person-stage video').count(),0);
 assert.ok(await page.evaluate(()=>window.streamFixture.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));
 await page.getByRole('button',{name:'Synthetic: start',exact:true}).click();
 const handle=await page.locator('.person-stage video').elementHandle();
 await page.getByRole('button',{name:'Synthetic: toggle mirror',exact:true}).click();
 assert.equal(await handle!.evaluate(video=>(video as HTMLVideoElement).srcObject),null);
 assert.equal(await page.evaluate(()=>window.streamFixture.streams.at(-1)!.getTracks()[0].readyState),'live');
 await page.getByRole('button',{name:'Synthetic: stop',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.streamFixture.streams.at(-1)!.getTracks()[0].readyState),'ended');
 await page.getByRole('button',{name:'Synthetic: start',exact:true}).click();
 await page.getByRole('button',{name:'Synthetic: unmount session',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.streamFixture.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));
 assert.deepEqual(blocked,[]);
 console.log('PASS: central MirrorPersonStage plays a synthetic canvas stream; late events, replacement, owner change, video detach, stop and session unmount clean up correctly. No camera, provider or API calls.');
}finally{await context.close();await browser.close();}

