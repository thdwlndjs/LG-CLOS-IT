import {existsSync} from 'node:fs';
import {readConfig,publicConfig} from './config';
import {createApiServer} from './http';
// Node loads local secrets directly. No values/prefixes/lengths are logged or exposed.
if(existsSync('.env'))process.loadEnvFile('.env');
try{const config=readConfig(process.env);const server=createApiServer(config);server.listen(config.port,'127.0.0.1',()=>console.log(JSON.stringify({server:'http://127.0.0.1:4312',...publicConfig(config)})));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));}catch{console.error('configuration_required: 서버 설정을 확인해 주세요.');process.exitCode=1;}
