import {AppError,uuid} from './errors';
import type {DatabaseRepository} from './repository';
import {parseCareEvidence,type CareEvidenceItem,type CareEvidenceResponse} from '../src/careEvidence';

/** Authenticated reads only: no bootstrap, RPC, provider, upload or implicit evidence repair. */
export async function readCareEvidence(repo:DatabaseRepository,garmentId:string):Promise<CareEvidenceResponse> {
 const id=uuid(garmentId),ownerId=repo.user.id,garment=await repo.garment(id);
 if(garment.owner_id!==ownerId)throw new AppError('unauthorized_target',403);
 const rows=await repo.db.rows(repo.user,'sc_evidence_items',
  'owner_id=eq.'+ownerId+'&garment_id=eq.'+id+'&select=id,owner_id,garment_id,asset_id,evidence_kind,original_text,source_ref,observed_at&order=observed_at.desc,id.desc&limit=30');
 const owned=rows.filter(row=>row.owner_id===ownerId&&row.garment_id===id&&['label','official_guidance','user_observation'].includes(String(row.evidence_kind))).slice(0,30);
 const assetIds=[...new Set(owned.filter(row=>row.evidence_kind==='label'&&typeof row.asset_id==='string').map(row=>uuid(row.asset_id)))];
 const assets=assetIds.length?await repo.db.rows(repo.user,'sc_assets',
  'owner_id=eq.'+ownerId+'&id=in.('+assetIds.join(',')+')&kind=eq.label&status=eq.finalized&select=id,owner_id,version,kind,status,mime_type&limit=30'):[];
 const evidence=owned.map(row=>{
  const linked=row.evidence_kind==='label'?assets.find(asset=>asset.id===row.asset_id&&asset.owner_id===ownerId&&asset.kind==='label'&&asset.status==='finalized'&&['image/png','image/jpeg','image/webp'].includes(String(asset.mime_type))):undefined;
  return{id:String(row.id),ownerId,garmentId:id,kind:row.evidence_kind,originalText:row.original_text,sourceRef:row.source_ref??null,observedAt:row.observed_at,
   asset:linked?{id:String(linked.id),version:Number(linked.version),url:'/api/assets/'+linked.id+'/content',mimeType:linked.mime_type}:null} as CareEvidenceItem;
 });
 return parseCareEvidence({ownerId,garmentId:id,evidence},ownerId,id);
}
