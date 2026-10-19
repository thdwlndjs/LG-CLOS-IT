import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.FLATLAY_PORT||4391);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
export const server=http.createServer(async(req,res)=>{
 try {
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const rel=pathname==='/'?'index.html':pathname.slice(1);
  const allowed=['index.html','style.css','reference/prototype/index.html','reference/prototype/style.css','reference/prototype/data/demo-pack.json','reference/prototype/data/demo-pack.js'].includes(rel)||/^src\/[a-z-]+\.mjs$/.test(rel)||/^reference\/prototype\/src\/(app|card-core)\.js$/.test(rel)||/^reference\/prototype\/assets\/[A-Z][0-9]{2}\.webp$/.test(rel);
  if(!allowed){res.writeHead(404).end('Not found');return;}
  const target=path.resolve(root,rel);
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const s=await stat(target);if(!s.isFile())throw Error('not file');
  const content=await readFile(target);
  res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
  res.end(req.method==='HEAD'?undefined:content);
 }catch{res.writeHead(404).end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Flatlay local module: http://127.0.0.1:${port} (local demo; provider calls unavailable)`));
