import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(new URL('../web/package.json',import.meta.url))('playwright');
const here=resolve(fileURLToPath(new URL('..',import.meta.url)),'docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/hanger-individual-v1');
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1712,height:1200}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5194/hanger-individual-v1/review.html');await page.waitForFunction(()=>window.hangerReady);
 const manifest=JSON.parse(await readFile(resolve(here,'manifest.json'),'utf8'));assert.equal(manifest.items.length,21);
 const save=async name=>writeFile(resolve(here,name),Buffer.from(await page.locator('#scene').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const assembled=await page.locator('#scene').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data);
 await page.locator('#original').click();
 const equal=await page.locator('#scene').evaluate((c,assembled)=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==assembled[i])changed++;return changed},assembled);
 assert.equal(equal,0);
 await page.locator('#empty').click();await save('all-hidden.png');
 const cases=[];
 for(const item of manifest.items){await page.locator('#item').selectOption(item.id);await page.locator('#remove').click();assert.deepEqual(await page.evaluate(()=>window.hangerState),{mode:'remove',id:item.id});cases.push(item.id)}
 await page.locator('#item').selectOption('A5');await page.locator('#remove').click();await save('A5-hidden.png');await page.locator('#move').click();await save('A5-moved.png');
 await page.locator('#item').selectOption('B3');await page.locator('#remove').click();await save('B3-hidden.png');await page.locator('#move').click();await save('B3-moved.png');
 await page.locator('#assets').screenshot({path:resolve(here,'individual-assets-board.png')});
 assert.deepEqual(errors,[]);
 await writeFile(resolve(here,'browser-check.json'),JSON.stringify({status:'PASS',recomposition_changed_channels:equal,individual_hide_action_ids:cases,page_errors:errors,scope:'Local extraction preview, not app/DB integration',visual_edge_quality:'NOT_CONFIRMED',hidden_surface_reconstruction:'NOT_IMPLEMENTED'},null,2)+'\n');
 console.log('PASS: exact reassembly, 21 hide actions, move previews, no page errors. Visual segmentation quality is separate.');
}finally{await browser.close()}
