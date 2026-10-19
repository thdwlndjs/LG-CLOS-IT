import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {ImportTarget,LifeDataPack, RuntimeBindings} from './types';
export async function readLifeDataPack(directory:string):Promise<LifeDataPack>{
 const read=async(name:string)=>JSON.parse(await readFile(resolve(directory,name),'utf8')) as unknown;
 const names=['profiles','garments','products','external_items','outfits','activity_events','evidence_bindings','preferences','contexts','asset_intake'];
 const values=await Promise.all(names.map(name=>read(`data/${name}.json`)));
 return {manifest:await read('manifest.json'),...Object.fromEntries(names.map((name,index)=>[name,values[index]])),sources:await read('sources/product_sources.json')} as LifeDataPack;
}
/** Accept a reviewed runtime contract, or translate the pack's deliberately unresolved template. */
export function readRuntimeBindings(raw:unknown,namespace:string):RuntimeBindings{
 const value=raw as Record<string,unknown>;
 if(value&&value.namespace===namespace&&!Array.isArray(value.profiles))return value as unknown as RuntimeBindings;
 if(value?.dataset_namespace!==namespace)throw new Error('binding_namespace_mismatch');
 return {namespace,profiles:{},garments:{},externalItems:{},evidence:{}};
}

/** Target metadata is intentionally small; reject credentials/URLs and never echo arbitrary JSON. */
export function readImportTarget(raw:unknown):ImportTarget{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_target');const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(key=>!['environment','projectId','schemaVersions','allowAssetlessFixture'].includes(key))||!['unknown','remote','isolated'].includes(String(value.environment))||value.projectId!==null&&(typeof value.projectId!=='string'||!/^[-a-zA-Z0-9:]{1,100}$/.test(value.projectId))||!Array.isArray(value.schemaVersions)||!value.schemaVersions.every(x=>typeof x==='string'&&/^\d{14}$/.test(x))||value.allowAssetlessFixture!==undefined&&typeof value.allowAssetlessFixture!=='boolean')throw Error('invalid_target');
 return {environment:value.environment as ImportTarget['environment'],projectId:value.projectId as string|null,schemaVersions:[...value.schemaVersions as string[]],...(value.allowAssetlessFixture!==undefined?{allowAssetlessFixture:value.allowAssetlessFixture as boolean}:{})};
}
