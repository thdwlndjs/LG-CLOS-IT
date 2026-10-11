import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(new URL('../../../../../web/package.json',import.meta.url))('playwright');
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1672,height:941}});
 await page.goto('http://localhost:5193', {waitUntil:'networkidle'});
 await page.screenshot({path:fileURLToPath(new URL('app-before.png',import.meta.url))});
 console.log(JSON.stringify(await page.locator('.mirror').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}))));
}finally {await browser.close();}
