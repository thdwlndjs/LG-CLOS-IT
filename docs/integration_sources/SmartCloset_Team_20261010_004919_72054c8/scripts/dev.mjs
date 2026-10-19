import {spawn} from 'node:child_process';
const children=[spawn(process.execPath,['--import','tsx','server/main.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4311','--strictPort'],{stdio:'inherit'})];
let stopping=false;function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);for(const child of children)child.on('exit',code=>{if(!stopping){stop();process.exitCode=code??1;}});
