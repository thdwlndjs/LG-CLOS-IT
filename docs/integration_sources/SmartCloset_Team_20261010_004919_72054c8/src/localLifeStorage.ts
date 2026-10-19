import {DemoApp} from './core/app';
import type {StorageLike} from './core/types';
import {STORAGE_KEY} from './core/seed';
import {buildLocalLifePack,type LocalLifePack} from './lifeData/localPack';

/** A separate local demonstration area. The legacy key is never read, copied, removed or written. */
export const LOCAL_LIFE_STORAGE_KEY='smartcloset.local-life.scprep-20261009-v1.v1';
export type LocalLifeInstallStatus='installed'|'restored'|'source-changed'|'conflict'|'memory-only';
export function createLocalLifeApp(storage?:StorageLike,pack:LocalLifePack=buildLocalLifePack()){
 const {report}=pack;let hadStoredState=false,repairedVersions=false;
 const scoped:StorageLike|undefined=storage?{
  getItem(key){if(key!==STORAGE_KEY)throw Error('unexpected local repository key');const raw=storage.getItem(LOCAL_LIFE_STORAGE_KEY);hadStoredState=raw!==null;
   if(raw===null)return raw;
   // Early local installs had no version entries for missing photographs. Repair only that
   // representation, preserving every ID/edit/event; DemoRepository still validates the result.
   try{const state=JSON.parse(raw),receipt=state.localDatasets?.[report.namespace];
    if(receipt?.version===report.version&&receipt.sourceFingerprint===report.sourceFingerprint&&Array.isArray(state.garments)&&Array.isArray(state.outfits)){
     for(const outfit of state.outfits){if(!outfit?.id?.startsWith(`local:${report.namespace}:outfit:`)||!outfit?.ownerId?.startsWith(`local:${report.namespace}:profile:`)||!outfit.items||!outfit.assetVersions)continue;
      for(const id of Object.values(outfit.items)){if(typeof id!=='string'||!id.startsWith(`local:${report.namespace}:garment:`)||Object.hasOwn(outfit.assetVersions,id)||outfit.assetIds?.[id]!==null)continue;
       if(state.garments.some((g:{id:string;ownerId:string;asset:unknown})=>g.id===id&&g.ownerId===outfit.ownerId&&g.asset===null)){outfit.assetVersions[id]=0;repairedVersions=true;}
      }
     }
     if(repairedVersions)return JSON.stringify(state);
    }
   }catch{/* Preserve invalid bytes for the repository's corruption guard. */}
   return raw;},
  setItem(key,value){if(key!==STORAGE_KEY)throw Error('unexpected local repository key');storage.setItem(LOCAL_LIFE_STORAGE_KEY,value);},
  removeItem(){throw Error('local life area cannot be removed through the adapter');},
 }:undefined;
 const app=new DemoApp(scoped,()=>structuredClone(pack.state));
 let status:LocalLifeInstallStatus='memory-only';
 if(app.persistence.status==='ready'){
  if(hadStoredState){
   const receipt=app.getState().localDatasets?.[report.namespace];
   // Reading a newer/changed pack is never permission to overwrite edits or append it again.
   status=!receipt?'conflict':receipt.version===report.version&&receipt.sourceFingerprint===report.sourceFingerprint?'restored':'source-changed';
   if(repairedVersions&&status==='restored'){try{app.repository.commit(()=>{},true);}catch{status='memory-only';}}
  }else{
   try{app.repository.commit(next=>{next.localDatasets={...next.localDatasets,[report.namespace]:{version:report.version,sourceFingerprint:report.sourceFingerprint,installedAt:new Date().toISOString()}};},true);status='installed';}
   catch{status='memory-only';}
  }
 }
 return {app,installation:{...report,status,storageKey:LOCAL_LIFE_STORAGE_KEY}};
}
export function browserLocalLifeStorage():StorageLike|undefined {
 try{return typeof window==='undefined'?undefined:window.localStorage;}catch{return undefined;}
}
