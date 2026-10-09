import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { markup } from '../src/template.mjs';

test('six-slot Korean card fits, renders deterministically and performs no network fetch', async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1080,height:1350},deviceScaleFactor:1,javaScriptEnabled:false});
    const urls = [];
    page.on('request', req => {if (!req.url().startsWith('data:')) urls.push(req.url());});
    await page.route('**/*', route => route.abort());
    const payload = {template:'minimal-v1',format:'PNG',title:'오늘의 코디 · 여섯 가지 의류',style_tag:'CASUAL',
      date:'2026-10-08',weather_label:'[MOCK] CLOUDY / 18',
      items:['TOP','DRESS','OUTER','BOTTOM','SHOES','ACCESSORY'].map(slot => ({slot,image:null}))};
    await page.setContent(markup(payload),{waitUntil:'load'});
    for (const item of await page.locator('.item').all()) {
      const box = await item.boundingBox();
      assert.ok(box.x >= 64 && box.y >= 64 && box.x + box.width <= 1016 && box.y + box.height <= 1286);
      assert.ok(box.height > 200);
    }
    const first = await page.screenshot({type:'png'});
    await page.setContent(markup(payload),{waitUntil:'load'});
    const second = await page.screenshot({type:'png'});
    assert.deepEqual(first,second);
    assert.deepEqual(urls,[]);
    if (process.env.CARD_RENDER_RESULTS) await writeFile(process.env.CARD_RENDER_RESULTS+'/sprint4-six-slot-preview.png',first);
  } finally {await browser.close();}
});
