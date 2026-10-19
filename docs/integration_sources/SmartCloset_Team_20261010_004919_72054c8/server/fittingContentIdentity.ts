import type {AiRequest} from './ai';
import type {Garment} from '../src/core/types';

export const FITTING_BATCH_CONFIGURATION=Object.freeze({
  model:'lucy-vton-3.6',resolution:'720p',seed:0,enhancePrompt:true,
  prompt:'Apply the complete outfit in the reference image, preserving visible garment details, input person and scene.',
});
/** Only verified content and output-affecting configuration; draft UI metadata is not generation input. */
export function fittingContentIdentity(request:AiRequest,ownerId:string,versions:Record<string,number>,garments:readonly Garment[]) {
  const draft=request.draft&&'items'in request.draft?request.draft:null;
  const privateAsset=(id:string|undefined)=>id?{id,version:versions[id],source:'storage'}:null;
  const owned=Object.entries(draft?.items??{}).map(([slot,id])=>{
    const garment=garments.find(row=>row.id===id&&row.ownerId===ownerId);
    return {slot,garmentId:id,source:'owned',asset:garment?.asset?{id:garment.asset.id,version:versions[garment.asset.id],source:garment.asset.source}:null};
  }).sort((a,b)=>a.slot.localeCompare(b.slot));
  const external=Object.entries(draft?.externalItems??{}).map(([slot,item])=>({slot,externalItemId:item.externalItemId,
    source:'external',sourceLabel:item.sourceLabel,sourceUrl:item.sourceUrl,
    asset:item.assetId?{id:item.assetId,version:versions[item.assetId],source:'storage'}:null})).sort((a,b)=>a.slot.localeCompare(b.slot));
  return {schema:'fitting-content-v2',ownerId,action:'startTryOn',provider:'decart',
    origin:request.fittingMode==='realtime'?'provider-realtime':'provider-batch',
    fittingMode:request.fittingMode??'batch',configuration:FITTING_BATCH_CONFIGURATION,
    person:privateAsset(request.personAssetId),reference:privateAsset(request.referenceAssetId),owned,external,
    assetVersions:versions};
}
