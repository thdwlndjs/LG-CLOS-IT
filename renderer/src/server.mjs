import http from 'node:http';
import { chromium } from 'playwright';
import { markup } from './template.mjs';

let busy = false;
export const server = http.createServer(async (req, res) => {
  if (req.url === '/health/ready' && req.method === 'GET') {
    let probe;
    try {
      probe = await chromium.launch({headless:true,timeout:3000});
      const page = await probe.newPage({viewport:{width:1,height:1}});
      await page.screenshot({timeout:3000});
      res.writeHead(200, {'Content-Type':'application/json'});res.end('{"status":"ready"}');
    } catch {res.writeHead(503);res.end('{"status":"unavailable"}');}
    finally {if (probe) await probe.close().catch(()=>{});}
    return;
  }
  if (req.url !== '/render' || req.method !== 'POST') {res.writeHead(404); return res.end();}
  if (busy) {res.writeHead(429); return res.end();}
  busy = true;
  let browser;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 84_000_000) {res.writeHead(413);res.end();return;}
      chunks.push(chunk);
    }
    let payload, html;
    try {payload = JSON.parse(Buffer.concat(chunks));html = markup(payload);}
    catch {res.writeHead(422);res.end();return;}
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1080,height:1350},deviceScaleFactor:1,javaScriptEnabled:false});
    await page.route('**/*', route => route.abort());
    page.setDefaultTimeout(20_000);
    await page.setContent(html, {waitUntil:'load',timeout:20_000});
    // Image decoding is observed through locators without enabling page scripts.
    for (const img of await page.locator('img').all()) {
      if (!(await img.evaluate(el => el.complete && el.naturalWidth > 0))) throw Error('image');
    }
    const image = await page.screenshot({type:'png',timeout:20_000});
    res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-store'});res.end(image);
  } catch { if (!res.headersSent) res.writeHead(503);res.end(); }
  finally { if (browser) await browser.close().catch(() => {});busy = false; }
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(3000, '0.0.0.0');
