import fs from 'node:fs/promises';
import path from 'node:path';
import {createDemoApp,STORAGE_KEY} from '../src/core';
import {createWardrobePackBundle} from '../src/wardrobePack';
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('tmp/browser-tools');
const {chromium}=await import('playwright');
const origin='http://127.0.0.1:4311',out='evidence/ux-refinement-125618-20261009/before';
await fs.mkdir(out,{recursive:true});
const memory=new Map<string,string>();const app=createDemoApp({getItem:k=>memory.get(k)??null,setItem:(k,v)=>{memory.set(k,v)},removeItem:k=>{memory.delete(k)}});app.installLocalDemoProfile(createWardrobePackBundle());const seed=app.getState();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
for(const [width,height] of [[1920,1080],[2560,1440]]){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
 await context.addInitScript(({key,seed})=>localStorage.setItem(key,JSON.stringify(seed)),{key:STORAGE_KEY,seed});
 await context.route('**/*',async r=>{const u=new URL(r.request().url());if(['http:','https:'].includes(u.protocol)){if(u.origin!==origin)return r.abort();if(u.pathname.startsWith('/api/')){if(u.pathname==='/api/config')return r.continue();if(u.pathname==='/api/session')return r.fulfill({contentType:'application/json',body:'{"authenticated":false}'});if(u.pathname==='/api/auth-status')return r.fulfill({contentType:'application/json',body:'{"email_password_enabled":true,"email_confirmation_required":true}'});return r.abort();}}return r.continue();});
 const p=await context.newPage();p.setDefaultTimeout(20000);await p.goto(origin,{waitUntil:'networkidle'});
 const nav=async(name:string)=>p.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name,exact:true}).click();
 const shot=async(name:string)=>{await p.evaluate(()=>document.fonts.ready);await p.waitForFunction(()=>[...document.images].filter(i=>i.offsetWidth&&i.offsetHeight).every(i=>i.complete));await p.waitForTimeout(400);await p.screenshot({path:`${out}/${width}-${name}.png`});await p.locator('.photo-mirror').screenshot({path:`${out}/${width}-${name}-mirror.png`});console.log('CAPTURE '+width+' '+name)};
 await shot('home');await p.locator('.mx-home-mini[data-look-id="LOOK01"]').click();await p.locator('[data-foreground-state="ready"]').waitFor({timeout:60000});await shot('compare');await p.getByRole('button',{name:'상의 바꾸기',exact:true}).click();await shot('builder');await nav('코디');await shot('library');await nav('홈');await shot('home-after-compare');for(const [menu,name] of [['옷장','wardrobe'],['캘린더','calendar'],['마이','profiles']]){await nav(menu);await shot(name)}
 await context.close();
}
await browser.close();await fs.writeFile(`${out}/capture-context.json`,JSON.stringify({head:'7abae583e852cd1e0079219fcfe4410708225fba',viewports:[[1920,1080],[2560,1440]],dpr:1,zoom:'100%',data:'isolated existing local demonstration profile',providerCalls:0,capturedAt:new Date().toISOString()},null,2));
