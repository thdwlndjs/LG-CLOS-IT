import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve('web/node_modules/playwright/index.mjs')).href);
import {mkdir,writeFile} from 'node:fs/promises';
const out='docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/stage-c/responsive-scene-fix';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const results=[];
try {
  for(const name of ['김수진','최휘재']){
    const context=await browser.newContext({viewport:{width:1672,height:941}});
    const page=await context.newPage();const errors=[],mutations=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.url().includes('/api/v1/')&&r.method()!=='GET')mutations.push({method:r.method(),path:new URL(r.url()).pathname});});
    await page.goto('http://127.0.0.1:5193');
    await page.getByRole('button',{name:'마이',exact:true}).click();
    const login=page.waitForResponse(r=>r.url().endsWith('/integration/demo-login'));
    await page.getByRole('button',{name:name+' 프로필 선택',exact:true}).click();
    const lr=await login;if(lr.status()!==200)throw Error('Login failed');if((await lr.json()).member.display_name!==name)throw Error('Wrong profile'); await page.getByRole('button',{name:'\uD648',exact:true}).click();
    await page.waitForFunction(n=>document.querySelector('.mx-home-name')?.textContent.includes(n),name);
    await page.waitForFunction(()=>document.querySelectorAll('[data-scene-item-id]').length===87);
    await page.locator('[data-scene-item-id] image').evaluateAll(async nodes=>Promise.all(nodes.map(async n=>{const image=new Image();image.src=n.getAttribute('href');await image.decode();})));
    const views=[];
    for(const [width,height,label] of [[1672,941,'desktop-before'],[390,844,'mobile-portrait'],[667,375,'mobile-landscape'],[767,844,'mobile-boundary'],[768,844,'desktop-boundary'],[1672,941,'desktop-after']]){
      await page.setViewportSize({width,height});
      await page.waitForFunction(w=>document.querySelector('.photo-wardrobe')?.dataset.displayMode===(w<768?'mobile':'desktop'),width);
      await page.waitForTimeout(200);
      const metrics=await page.evaluate(()=>{
        const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        const visible=n=>{const r=n.getBoundingClientRect();return n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&r.width>0&&r.height>0;};
        const mirror=document.querySelector('.photo-mirror'), rect=mirror.getBoundingClientRect();
        const scene=document.querySelector('.photo-db-scene');
        const layers=[...scene.querySelectorAll('img,svg,image,button,span')];
        const grid=[];
        for(let y=0;y<12;y++)for(let x=0;x<12;x++){
          const px=rect.left+(x+.5)*rect.width/12,py=rect.top+(y+.5)*rect.height/12;
          const top=document.elementFromPoint(px,py);
          if(top?.closest('.photo-db-scene'))grid.push({x:Math.round(px),y:Math.round(py),tag:top.tagName,garment_id:top.closest('[data-scene-hit-id]')?.dataset.sceneHitId||null});
        }
        return {viewport:[innerWidth,innerHeight],mode:document.querySelector('.photo-wardrobe').dataset.displayMode,
          backgroundDisplay:getComputedStyle(document.querySelector('.photo-background')).display,
          sceneDisplay:getComputedStyle(scene).display,sceneVisible:visible(scene),
          visibleSceneLayers:layers.filter(visible).length,visibleItems:[...scene.querySelectorAll('[data-scene-item-id]')].filter(visible).length,
          visibleHits:[...scene.querySelectorAll('[data-scene-hit-id]')].filter(visible).length,
          mirror:box(mirror),mirrorBackground:getComputedStyle(mirror).backgroundImage,
          interceptedGridPoints:grid,
          items:[...scene.querySelectorAll('[data-scene-item-id]')].map(n=>({id:n.dataset.sceneItemId,box:box(n),filter:getComputedStyle(n).filter})),
          hits:[...scene.querySelectorAll('[data-scene-hit-id]')].map(n=>({id:n.dataset.sceneHitId,box:box(n)}))};
      });
      const nav=[];
      for(const target of ['옷장','코디','마이','홈']){
        const button=page.getByRole('button',{name:target,exact:true});
        const hit=await button.evaluate(n=>{const r=n.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n.contains(top);});
        try{await button.click({timeout:3000});const expected=({'\uc637\uc7a5':'wardrobe','\ucf54\ub514':'outfit','\ub9c8\uc774':'my','\ud648':'home'})[target];await page.waitForFunction(e=>document.querySelector('.mx-surface')?.dataset.screen===e,expected,{timeout:3000});nav.push({target,hitTest:hit,click:true,screen:await page.locator('.mx-surface').getAttribute('data-screen')});}
        catch{nav.push({target,hitTest:hit,click:false});}
      }
      metrics.navigation=nav;
      metrics.hidePass=width>=768||(!metrics.sceneVisible&&metrics.visibleSceneLayers===0&&metrics.visibleItems===0&&metrics.visibleHits===0);
      metrics.pointerPass=metrics.interceptedGridPoints.length===0&&nav.every(n=>n.hitTest&&n.click);
      await page.screenshot({path:out+'/'+name+'-'+label+'.png'});
      views.push(metrics);
    }
    const before=views[0],after=views.at(-1);
    results.push({profile:name,views,desktopRestored:JSON.stringify(before.items)===JSON.stringify(after.items)&&JSON.stringify(before.hits)===JSON.stringify(after.hits),
      sameItemIds:new Set(before.items.map(i=>i.id)).size===87&&views.every(v=>JSON.stringify(v.items.map(i=>i.id))===JSON.stringify(before.items.map(i=>i.id))),
      errors,mutations});
    await context.close();
  }
  await writeFile(out+'/results.json',JSON.stringify({readOnly:true,profiles:results},null,2));
  console.log(JSON.stringify(results.map(p=>({profile:p.profile,desktopRestored:p.desktopRestored,sameItemIds:p.sameItemIds,
    mobile:p.views.filter(v=>v.mode==='mobile').map(v=>({viewport:v.viewport,visibleItems:v.visibleItems,visibleHits:v.visibleHits,intercepts:v.interceptedGridPoints.length,hidePass:v.hidePass,pointerPass:v.pointerPass,navigation:v.navigation})),errors:p.errors,mutations:p.mutations})),null,2));
}catch(error){const page=browser.contexts().at(-1)?.pages().at(-1);if(page){await page.screenshot({path:out+'/failed-initial.png'});await writeFile(out+'/failed-initial.txt',String(error)+'\n'+await page.locator('body').innerText());}throw error;}finally{await browser.close();}
