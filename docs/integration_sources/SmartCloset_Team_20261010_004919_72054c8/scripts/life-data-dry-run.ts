// Read-only: no environment loading, network, database client, key inspection or apply branch.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readLifeDataPack,readRuntimeBindings,readImportTarget} from '../src/lifeData/readPack';
import {planLifeDataImport} from '../src/lifeData/importPlan';
import type {DatabaseSnapshot,ImportTarget} from '../src/lifeData/types';
const args=process.argv.slice(2),allowed=new Set(['--pack','--bindings','--snapshot','--target','--output']);
if(args.some(x=>x==='--apply'||x.startsWith('--apply=')))throw new Error('apply_disabled: read-only planner; remote writes require target, real profiles and reviewed scope first');
const options=new Map<string,string>();for(let index=0;index<args.length;index+=2){const key=args[index],value=args[index+1];if(!allowed.has(key)||!value||value.startsWith('--')||options.has(key))throw new Error('invalid_arguments');options.set(key,value);}
const pack=await readLifeDataPack(resolve(options.get('--pack')??'reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1'));
const load=async(path:string)=>JSON.parse(await readFile(resolve(path),'utf8'));
const bindings=options.has('--bindings')?readRuntimeBindings(await load(options.get('--bindings')!),pack.manifest.namespace):{namespace:pack.manifest.namespace,profiles:{},garments:{},externalItems:{}};
const target:ImportTarget=options.has('--target')?readImportTarget(await load(options.get('--target')!)):{environment:'unknown',projectId:null,schemaVersions:[]};
const existing:DatabaseSnapshot=options.has('--snapshot')?await load(options.get('--snapshot')!):{};
if(!['unknown','remote','isolated'].includes(target.environment)||!Array.isArray(target.schemaVersions))throw new Error('invalid_target');
const plan=planLifeDataImport({pack,bindings,target,existing});
if(options.has('--output'))await writeFile(resolve(options.get('--output')!),JSON.stringify(plan,null,2)+'\n','utf8');
console.log(JSON.stringify({mode:plan.mode,namespace:plan.namespace,target:plan.target,valid:plan.valid,counts:plan.counts,issues:plan.issues,applyBlockers:plan.applyBlockers,...(options.has('--output')?{report:resolve(options.get('--output')!)}:{})},null,2));
if(!plan.valid)process.exitCode=1;
