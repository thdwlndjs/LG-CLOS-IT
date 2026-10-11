import {chromium} from 'playwright';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const dir=fileURLToPath(new URL('../../test-results/remediation/sprite-inputs/',import.meta.url));
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:960,height:600}});
 for(let i=1;i<=7;i++){
  const name=`batch-${String(i).padStart(2,'0')}`;
  await page.goto(pathToFileURL(resolve(dir,name+'.html')).href);
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  await page.screenshot({path:resolve(dir,name+'.png'),fullPage:true});
 }
}finally{await browser.close();}
