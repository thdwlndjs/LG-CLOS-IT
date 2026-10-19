import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute} from 'node:path';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const manifest=JSON.parse(await readFile(resolve(root,'HANDOFF/FILE_MANIFEST.json'),'utf8'));
let errors=0;
for(const row of manifest.files){
 const file=resolve(root,row.path),rel=relative(root,file);
 if(rel.startsWith('..')||isAbsolute(rel)){console.error('UNSAFE PATH',row.path);errors++;continue;}
 try{const bytes=await readFile(file);if(bytes.length!==row.bytes||createHash('sha256').update(bytes).digest('hex')!==row.sha256){console.error('CHANGED',row.path);errors++;}}catch{console.error('MISSING',row.path);errors++;}
}
console.log(JSON.stringify({files:manifest.files.length,errors,status:errors?'FAIL':'PASS'}));process.exitCode=errors?1:0;
