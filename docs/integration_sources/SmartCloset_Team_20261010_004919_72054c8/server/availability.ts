import { createHash } from 'node:crypto';
import { AppError, only, record, text, uuid } from './errors';
import { reviewGarmentIdentity, type AvailabilityConfirmation } from '../src/outfitReview';
import type { Garment } from '../src/core/types';

export function availabilityInput(raw:unknown):AvailabilityConfirmation[]{
  if(!Array.isArray(raw)||raw.length>100)throw new AppError('invalid_input');
  const seen=new Set<string>();
  return raw.map(value=>{
    const item=record(value);only(item,['garmentId','identity','status']);
    const garmentId=uuid(item.garmentId),identity=text(item.identity,1000);
    if(seen.has(garmentId)||!['available','laundry','repair'].includes(String(item.status)))throw new AppError('invalid_input');
    seen.add(garmentId);return{garmentId,identity,status:item.status as AvailabilityConfirmation['status']};
  });
}

/** Verify an explicit request against the current JWT-owned garment revision and asset identity. */
export function verifiedAvailability(ownerId:string,garments:Garment[],raw:unknown,rejectUnowned=false){
  const confirmations=raw===undefined?[]:availabilityInput(raw);
  const verified=new Map<string,{status:AvailabilityConfirmation['status'];evidenceId:string}>();
  for(const item of confirmations){
    const matches=garments.filter(garment=>garment.id===item.garmentId&&garment.ownerId===ownerId);
    if(matches.length!==1){if(rejectUnowned)throw new AppError('unauthorized_target',403);continue;}
    const garment=matches[0];
    if(!Number.isSafeInteger(garment.revision)||garment.revision<1||reviewGarmentIdentity(garment)!==item.identity)continue;
    const evidenceId='request-availability:'+createHash('sha256').update(JSON.stringify([ownerId,item.garmentId,item.identity,item.status])).digest('hex');
    verified.set(item.garmentId,{status:item.status,evidenceId});
  }
  return verified;
}
