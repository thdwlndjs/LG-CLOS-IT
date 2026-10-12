// Production read-only admission gate; never submits a paid provider request.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out = '../test-results/cloud-release/20261013-v1/browser';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1672,height:941}});
const report={origin:'https://lg-clos-it.vercel.app',requests:[],errors:[],pass:false};
page.on('response',r=>{if(r.url().includes('onrender.com'))report.requests.push({path:new URL(r.url()).pathname,status:r.status()});});
page.on('requestfailed',r=>report.errors.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}));
try {
 await page.goto(report.origin,{waitUntil:'domcontentloaded',timeout:30000});
 await page.getByRole('button',{name:'마이',exact:true}).click();
 await page.getByRole('button',{name:'김수진 프로필 선택',exact:true}).waitFor({timeout:45000});
 await page.getByRole('button',{name:'최휘재 프로필 선택',exact:true}).waitFor({timeout:5000});
 report.profilesVisible=true;
 report.pass=true;
}catch(error){report.failure=String(error);}
finally{
 await page.screenshot({path:out+'/production-profile-gate.png'}).catch(()=>{});
 report.body=await page.locator('body').innerText().catch(()=>null);
 await writeFile(out+'/production-profile-gate.json',JSON.stringify(report,null,2));
 await browser.close();
}
console.log(JSON.stringify({pass:report.pass,profilesVisible:report.profilesVisible,requests:report.requests,errors:report.errors,failure:report.failure}));
if(!report.pass)process.exitCode=1;
