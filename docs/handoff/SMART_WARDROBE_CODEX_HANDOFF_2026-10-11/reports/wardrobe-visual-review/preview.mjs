import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(new URL('../../../../../web/package.json',import.meta.url))('playwright');
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const manifest=JSON.parse(await readFile(here+'proposal.json','utf8'));
assert.equal(manifest.candidates.length,33);
assert.equal(manifest.hanger_positions.length,21);
assert.equal(manifest.folded_stacks.length,24);
assert.ok(manifest.folded_stacks.every(stack=>stack.layers===3));
assert.equal(new Set(manifest.candidates.map(item=>item.source_product_id)).size,33);
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1712,height:1200}});
 const external=[];
 page.on('request',request=>{if(/^https?:/.test(request.url()))external.push(request.url());});
 await page.goto(new URL('proposal.html',import.meta.url).href);
 await page.locator('img').evaluateAll(nodes=>Promise.all(nodes.map(image=>image.decode())));
 assert.equal(await page.locator('article').count(),33);
 await page.locator('.stage').screenshot({path:here+'placement.png'});
 await page.locator('.cards').screenshot({path:here+'candidate-board.png'});
 await page.getByRole('button',{name:'B3 의류 찾기 조명 시안',exact:true}).click();
 assert.equal(await page.locator('.lamp').isVisible(),true);
 await page.locator('.stage').screenshot({path:here+'led-concept.png'});
 assert.deepEqual(external,[]);
 await writeFile(here+'preview-check.json',JSON.stringify({status:'PASS',official_candidate_photos_decoded:33,
  proposal_only:true,app_or_db_requests:0,live_led_verified:false,replacement_image_generated:false},null,2));
 console.log('Proposal preview PASS: 33 official images decoded; original diagram + CSS LED concept; no app/DB requests');
}finally{await browser.close();}
