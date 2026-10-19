import type {DemoState} from '../src/core/types';
import {parseLifeProfileData} from '../src/lifeSnapshot';
import {parseCareEvidence,type CareEvidenceItem} from '../src/careEvidence';
type Row=Record<string,unknown>;
/** Read existing settings/evidence only. Never infer bindings from names, products or photos. */
export function hydrateLifeState(state:DemoState,ownerId:string,profiles:Row[],evidenceRows:Row[],assets:Row[]){
 const profile=profiles.find(row=>row.id===ownerId),settings=profile?.settings;
 const data=parseLifeProfileData(settings&&typeof settings==='object'?(settings as Row).lifeData:undefined,ownerId);
 if(data)state.lifeData={[ownerId]:data};else delete state.lifeData;
 const evidence:CareEvidenceItem[]=[];
 for(const garment of state.garments.filter(g=>g.ownerId===ownerId)){
  const scoped=evidenceRows.filter(row=>row.owner_id===ownerId&&row.garment_id===garment.id&&['label','official_guidance','user_observation'].includes(String(row.evidence_kind))).slice(0,30);
  const mapped=scoped.map(row=>{
   const asset=row.evidence_kind==='label'?assets.find(a=>a.id===row.asset_id&&a.owner_id===ownerId&&a.kind==='label'&&a.status==='finalized'&&['image/png','image/jpeg','image/webp'].includes(String(a.mime_type))):undefined;
   return {id:row.id,ownerId,garmentId:garment.id,kind:row.evidence_kind,originalText:row.original_text,sourceRef:row.source_ref??null,observedAt:row.observed_at,
    asset:asset?{id:asset.id,version:Number(asset.version),url:'/api/assets/'+asset.id+'/content',mimeType:asset.mime_type}:null};
  });
  // A malformed source is not silently replaced with another garment's care instructions.
  try{evidence.push(...parseCareEvidence({ownerId,garmentId:garment.id,evidence:mapped},ownerId,garment.id).evidence);}catch{/* Keep this garment unlinked until the source is corrected. */}
 }
 state.careEvidence=evidence;
 return state;
}
