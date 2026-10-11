import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const evidence=fileURLToPath(new URL('../../docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/remediation/',import.meta.url));
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:2240,height:740}});
for(const t of ['T1','T2','T3','T4']){
 await page.goto(pathToFileURL(resolve(evidence,t+'-comparison.html')).href);
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await page.screenshot({path:resolve(evidence,t+'-comparison.png'),fullPage:true});
}
await browser.close();
console.log('Four source/restoration/plate/registered-photo comparisons captured; no visual gate automatically certified.');
