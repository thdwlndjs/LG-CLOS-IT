import type {DemoApp} from '../core/app';
import type {DemoState,StorageLike} from '../core/types';
import {DemoRepository,isValidState,stable} from '../core/repository';
import {buildLocalLifePack,LOCAL_LIFE_NAMESPACE} from './localPack';
import {REVIEWED_VISUAL_BINDINGS,PENDING_VISUAL_BINDINGS} from './reviewedVisualBindings';
import {VISUAL_REPAIR_VERSION,VISUAL_BINDINGS_FINGERPRINT,type GarmentDisplayBinding} from './visualPresentation';

export const VISUAL_REPAIR_BACKUP_KEY='smartcloset.local-life.scprep-20261009-v1.v1.backup.visual-care-20261010-v1';
export interface VisualRepairReport {status:'applied'|'already-applied'|'unavailable'|'source-conflict';changedIds:string[];preservedIds:string[];conflicts:{id:string;reason:string}[];pending:number;backupSaved:boolean;}
export function planVisualRepair(state:DemoState){
 const next=structuredClone(state),changedIds:string[]=[],preservedIds:string[]=[],conflicts:{id:string;reason:string}[]=[];
 for(const row of REVIEWED_VISUAL_BINDINGS){
  const matches=next.garments.filter(g=>g.id===row.currentCanonicalGarmentId),g=matches[0];
  if(matches.length!==1||g.ownerId!==row.currentLocalProfileId){conflicts.push({id:row.currentCanonicalGarmentId,reason:'missing_or_wrong_profile'});continue;}
  if(g.displayBinding!==undefined||g.asset!==null){preservedIds.push(g.id);continue;}
  if(g.category!==row.expectedCategory||g.color!==row.expectedColor||g.name!==row.expectedName){conflicts.push({id:g.id,reason:'edited_identity_requires_review'});continue;}
  const binding:GarmentDisplayBinding={repairVersion:VISUAL_REPAIR_VERSION,manifestFingerprint:VISUAL_BINDINGS_FINGERPRINT,canonicalGarmentId:g.id,profileId:g.ownerId,legacyCatalogRef:row.legacyCatalogRef};
  g.displayBinding=binding;changedIds.push(g.id);
 }
 next.localRepairs={...next.localRepairs,[VISUAL_REPAIR_VERSION]:{version:VISUAL_REPAIR_VERSION,sourceFingerprint:VISUAL_BINDINGS_FINGERPRINT,appliedAt:new Date().toISOString(),changedIds,conflicts}};
 return{next,changedIds,preservedIds,conflicts};
}
/** Use the repository's existing reload normalization for blob URLs and transient operations. */
function normalizedPersistedState(state:DemoState):DemoState {
 const readOnly:StorageLike={getItem:()=>JSON.stringify(state),setItem:()=>{throw Error('read-only comparison');},removeItem:()=>{throw Error('read-only comparison');}};
 return new DemoRepository(readOnly,()=>state).getState();
}
/** Runs before subscribers mount. One validated repository write adds only display references. */
export function installReviewedVisualBindings(app:DemoApp,storage:StorageLike|undefined,currentKey:string):VisualRepairReport {
 const empty={changedIds:[],preservedIds:[],conflicts:[],pending:PENDING_VISUAL_BINDINGS.length,backupSaved:false};
 if(app.connection.kind!=='local'||app.persistence.status!=='ready'||!storage)return{...empty,status:'unavailable'};
 const state=app.getState(),receipt=state.localRepairs?.[VISUAL_REPAIR_VERSION];
 if(receipt)return{...empty,status:receipt.sourceFingerprint===VISUAL_BINDINGS_FINGERPRINT?'already-applied':'source-conflict'};
 const pack=buildLocalLifePack().report,installed=state.localDatasets?.[LOCAL_LIFE_NAMESPACE];
 if(!installed||installed.sourceFingerprint!==pack.sourceFingerprint||installed.version!==pack.version)return{...empty,status:'source-conflict'};
 const plan=planVisualRepair(state);
 if(!isValidState(plan.next))return{...empty,status:'unavailable'};
 try{
  const raw=storage.getItem(currentKey),stored:unknown=raw===null?null:JSON.parse(raw);
  if(raw===null||!isValidState(stored))return{...empty,status:'unavailable'};
  // Another open window may have saved after this app loaded. Preserve that writer's data.
  if(stable(normalizedPersistedState(stored))!==stable(normalizedPersistedState(state)))return{...empty,status:'source-conflict'};
  if(storage.getItem(VISUAL_REPAIR_BACKUP_KEY)===null)storage.setItem(VISUAL_REPAIR_BACKUP_KEY,raw);
  // Optimistic recheck, not an atomic CAS: localStorage cannot exclude another process between check and write.
  if(storage.getItem(currentKey)!==raw)return{...empty,status:'source-conflict'};
  // A failed/quota write leaves both the live repository and the original snapshot unchanged.
  app.repository.commit(next=>Object.assign(next,plan.next),true);
  return{status:'applied',changedIds:plan.changedIds,preservedIds:plan.preservedIds,conflicts:plan.conflicts,pending:PENDING_VISUAL_BINDINGS.length,backupSaved:true};
 }catch{return{...empty,status:'unavailable'};}
}
