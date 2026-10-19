import {hydrateLifeState} from './lifeState';
import {AppError,integer,record,text,uuid} from './errors';
import {SupabaseGateway,type UserContext} from './supabase';
import {assetFrom,externalItemFrom,emptyRemoteState,eventFrom,garmentFrom,outfitFrom,type eventInput} from './domain';
import {stable} from '../src/core/repository';
import {isWearSnapshotDraft,wearSnapshotIntent} from '../src/core/wearScenario';
import {isSelectionSnapshotDraft,selectionSnapshotIntent} from '../src/core/selectionScenario';
import type {DemoEvent,Garment,Outfit,OutfitDraft,Receipt,RegistrationDraft,SaveResult} from '../src/core/types';
import {inspectMedia} from './media';
export class DatabaseRepository {
 constructor(readonly db:SupabaseGateway,readonly user:UserContext){}
 async bootstrap(){return this.db.rpc(this.user,'sc_ensure_profile',{p_display_name:'내 옷장'});}
 async state(){
  await this.bootstrap();const tables=['sc_profiles','sc_garments','sc_assets','sc_outfits','sc_activity_events','sc_drafts','sc_operation_receipts','sc_operations','sc_external_items','sc_event_garments','sc_evidence_items'];
  const [profiles,garments,assets,outfits,events,drafts,receipts,operations,externalItems,eventGarments,evidenceRows]=await Promise.all(tables.map(t=>this.db.rows(this.user,t,`${t==='sc_profiles'?'id':'owner_id'}=eq.${this.user.id}&select=*&limit=1000`)));
  const state=emptyRemoteState(this.user.id,String(profiles[0]?.display_name??'내 옷장'));
  state.externalItems=externalItems.map(item=>externalItemFrom(item,assets));state.garments=garments.map(g=>garmentFrom(g,assets));state.outfits=outfits.map(outfitFrom);state.events=events.map(row=>eventFrom(row,eventGarments.filter(link=>link.owner_id===this.user.id&&link.event_id===row.id).map(link=>String(link.garment_id))));
  hydrateLifeState(state,this.user.id,profiles,evidenceRows,assets);
  // Legacy internal records are identified by committed action receipts, never title heuristics.
  for(const outfit of state.outfits){if(outfit.purpose)continue;const receipt=receipts.find(r=>r.outfit_id===outfit.id&&r.action==='saveOutfit');const operation=receipt&&operations.find(o=>o.id===receipt.operation_id);if(operation&&operation.intent_key===selectionSnapshotIntent(String(operation.draft_id)))outfit.purpose='selection';else if(operation&&operation.intent_key===wearSnapshotIntent(String(operation.draft_id)))outfit.purpose='wear';}
  for(const d of drafts.sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at)))){
   const snap=record(d.state_json),client=snap._client;if(!client||d.status==='discarded')continue;const value=record(client);
   if(d.kind==='registration'){const v=value as unknown as RegistrationDraft;if(v.asset){const a=assets.find(a=>a.id===v.asset?.id);v.asset=a?assetFrom(a):null;}state.registrationDrafts[this.user.id]=v;}
   // Internal wear snapshots are immutable records, never the user's editable draft (even after response loss).
   if(d.kind==='outfit'){
    const snapshotAssets=Object.fromEntries((Array.isArray(snap.items)?snap.items:[]).map(record).filter(row=>row.garment_id).map(row=>[String(row.garment_id),Number(row.asset_version??0)]));
    const context=record(value.recordContext??{});
    const selectionOperation=operations.find(operation=>operation.action==='saveOutfit'&&operation.draft_id===d.id&&(operation.intent_key===selectionSnapshotIntent(String(d.id))||context.kind==='selection'&&operation.intent_key===selectionSnapshotIntent(String(d.id),String(context.intentId))));
    // A committed internal response with asset-version drift is still not an editable user draft.
    const committedSelection=selectionOperation&&receipts.some(receipt=>receipt.operation_id===selectionOperation.id);
    if(await isWearSnapshotDraft(value as unknown as OutfitDraft)||await isSelectionSnapshotDraft(value as unknown as OutfitDraft,snapshotAssets)||committedSelection)continue;
   }
   if(d.kind==='outfit'){const prior=state.outfitDrafts[this.user.id];if(prior){state.previousOutfitDrafts??={};(state.previousOutfitDrafts[this.user.id]??=[]).push(prior);}state.outfitDrafts[this.user.id]=value as unknown as OutfitDraft;}
  }
  for(const row of receipts){const result=record(row.result_json);const action=String(row.action);const entity=action==='saveGarment'?garmentFrom(result,assets):action==='saveOutfit'?outfitFrom(result):eventFrom(result);const operation=operations.find(o=>o.id===row.operation_id),clientRevision=record(record(operation?.snapshot_json??{})._client??{}).revision;state.receipts.push(this.receipt({...row,draft_revision:clientRevision??row.draft_revision},entity));const d=drafts.find(d=>d.id===row.draft_id&&d.revision===row.draft_revision&&d.status==='saved');if(d){const registration=state.registrationDrafts[this.user.id],outfit=state.outfitDrafts[this.user.id];if(action==='saveGarment'&&registration?.draftId===d.id)registration.savedGarmentId=entity.id;if(action==='saveOutfit'&&outfit?.draftId===d.id)outfit.savedOutfitId=entity.id;}}
  state.ui[this.user.id].searchResultIds=state.garments.map(g=>g.id);return state;
 }
 private receipt(r:Record<string,unknown>,entity:Garment|Outfit|DemoEvent):Receipt{const action=String(r.action??'');const op=({recordActualCare:'care',recordMovementConfirmed:'movement',planOutfit:'plan',recordWear:'wear'} as Record<string,string>)[action]??action;return{id:String(r.id??r.receipt_id),ownerId:this.user.id,operation:op,entityId:entity.id,draftId:String(r.draft_id??r.operation_id),revision:Number(r.draft_revision??1),fingerprint:stable(r.result_json??r.result),createdAt:String(r.committed_at),result:entity};}
 async asset(id:string,version?:number){const a=await this.db.one(this.user,'sc_assets',id);if(a.owner_id!==this.user.id||a.status!=='finalized'||version!==undefined&&a.version!==version)throw new AppError('unauthorized_target',403);return a;}
 async garment(id:string){const row=await this.db.one(this.user,'sc_garments',id);return row;}
 async outfit(id:string){return this.db.one(this.user,'sc_outfits',id);}
 async snapshot(draft:RegistrationDraft|OutfitDraft){
  if('category'in draft){if(draft.asset)await this.asset(draft.asset.id,draft.asset.version);return{name:draft.name,category:draft.category,asset_id:draft.asset?.id??null,asset_version:draft.asset?.version??null,attributes_json:{color:draft.color,features:draft.features,material:draft.material,size:draft.size,careNotes:draft.careNotes,manual_fields:draft.manualFields},location_json:draft.location?{location:draft.location,source:'user_confirmed'}:{},_client:draft};}
  const items=[];for(const [slot,id] of Object.entries(draft.items)){const g=await this.garment(id);if(g.owner_id!==this.user.id||g.category!==slot)throw new AppError('unauthorized_target',403);if(draft.assetIds&&Object.hasOwn(draft.assetIds,id)&&draft.assetIds[id] !== (g.asset_id??null)||draft.assetVersions&&Object.hasOwn(draft.assetVersions,id)&&draft.assetVersions[id] !== Number(g.asset_version??0))throw new AppError('stale_revision',409);items.push({slot,garment_id:g.id,asset_id:g.asset_id,asset_version:g.asset_version});}
  if(draft.sourceOutfitId){const original=await this.outfit(draft.sourceOutfitId);if(original.owner_id!==this.user.id)throw new AppError('unauthorized_target',403);}
  if(draft.recordContext){const versions=Object.fromEntries(items.map(item=>[String(item.garment_id),Number(item.asset_version??0)]));if(!(draft.recordContext.kind==='selection'?await isSelectionSnapshotDraft(draft,versions):await isWearSnapshotDraft(draft)))throw new AppError('invalid_input');}else if(draft.purpose==='selection'||draft.purpose==='wear')throw new AppError('invalid_input');
  for(const [slot,selection]of Object.entries(draft.externalItems??{})){
    if(draft.items[slot as keyof typeof draft.items])throw new AppError('invalid_input');
    const item=await this.db.one(this.user,'sc_external_items',uuid(selection.externalItemId));
    if(item.owner_id!==this.user.id||(item.asset_id??null)!==selection.assetId||item.source_label!==selection.sourceLabel||(item.source_url??null)!==selection.sourceUrl)throw new AppError('unauthorized_target',403);
    if(selection.assetId)await this.asset(selection.assetId,selection.assetVersion??undefined);
    items.push({slot,external_item_id:item.id,asset_id:selection.assetId,asset_version:selection.assetVersion});
  }
  return{name:draft.name,items,topLocked:draft.topLocked,_client:draft};
 }
 async putDraft(draft:RegistrationDraft|OutfitDraft){const snapshot=await this.snapshot(draft);const existing=await this.db.rows(this.user,'sc_drafts',`id=eq.${uuid(draft.draftId)}&select=*`);const old=existing[0];
  if(old){const saved=record(old.state_json),client=record(saved._client??{});if(Number(client.revision)>draft.revision)throw new AppError('stale_revision',409);if(stable(saved)===stable(snapshot))return old;if(Number(client.revision)===draft.revision)throw new AppError('conflict',409);}
  return record(await this.db.rpc(this.user,'sc_put_draft',{p_draft_id:draft.draftId,p_kind:'category'in draft?'registration':'outfit',p_expected_revision:old?Number(old.revision):0,p_state_json:snapshot,p_manual_fields_json:'manualFields'in draft?draft.manualFields:{},p_input_asset_id:'asset'in draft?draft.asset?.id??null:null,p_input_asset_version:'asset'in draft?draft.asset?.version??null:null}));
 }
 async discardDraft(id:string,clientRevision:number){const existing=await this.db.one(this.user,'sc_drafts',id);if(existing.owner_id!==this.user.id)throw new AppError('unauthorized_target',403);if(Number(record(record(existing.state_json)._client??{}).revision)!==clientRevision)throw new AppError('stale_revision',409);return this.db.rpc(this.user,'sc_discard_draft',{p_draft_id:id,p_expected_revision:Number(existing.revision)});}
 async save(action:'saveGarment'|'saveOutfit',draft:RegistrationDraft|OutfitDraft,intentKey:string):Promise<SaveResult<Garment|Outfit>>{
  if(!draft.name.trim())throw new AppError('invalid_input');if(action==='saveOutfit'&&(!('items'in draft)||!(draft.items.top||draft.externalItems?.top)||!(draft.items.bottom||draft.externalItems?.bottom)))throw new AppError('invalid_input');
  const intents=await this.db.rows(this.user,'sc_operation_intents',`owner_id=eq.${this.user.id}&action=eq.${action}&intent_key=eq.${encodeURIComponent(text(intentKey))}&select=*`);
  const existing=intents[0]?await this.db.one(this.user,'sc_operations',String(intents[0].operation_id)):(await this.db.rows(this.user,'sc_operations',`owner_id=eq.${this.user.id}&action=eq.${action}&draft_id=eq.${uuid(draft.draftId)}&snapshot_json->_client->>revision=eq.${integer(draft.revision)}&select=*&limit=1`))[0];
  // Check the durable receipt before current draft freshness. Old committed saves survive later edits.
  const committed=action==='saveOutfit'&&existing?(await this.db.rows(this.user,'sc_operation_receipts',`owner_id=eq.${this.user.id}&action=eq.${action}&operation_id=eq.${existing.id}&select=*&limit=1`))[0]:undefined;
  let stored:Record<string,unknown>;
  if(committed){
    const original=record(existing.snapshot_json),client=record(original._client??{});
    if(existing.owner_id!==this.user.id||draft.ownerId!==this.user.id
      ||stable({...client,savedOutfitId:undefined})!==stable({...draft,savedOutfitId:undefined}))throw new AppError('conflict',409);
    // Feed the unchanged captured snapshot to the existing atomic hash/receipt check.
    stored={id:draft.draftId,revision:existing.draft_revision,state_json:original};
  }else stored=existing?{id:draft.draftId,revision:existing.draft_revision,state_json:await this.snapshot(draft)}:await this.putDraft(draft);
  const r=record(await this.db.rpc(this.user,'sc_commit_action',{p_owner_id:this.user.id,p_action:action,p_intent_key:text(intentKey),p_draft_id:draft.draftId,p_draft_revision:integer(stored.revision),p_snapshot:stored.state_json}));
  const assets='asset'in draft&&draft.asset?[await this.asset(draft.asset.id)]:[];const result=record(r.result);const entity=action==='saveGarment'?garmentFrom(result,assets):outfitFrom(result);
  return{entity,receipt:this.receipt({...r,action,draft_id:draft.draftId,draft_revision:draft.revision},entity),replayed:r.replayed===true};
 }
 async event(action:string,input:ReturnType<typeof eventInput>):Promise<SaveResult<DemoEvent>>{
  const outfitAction=action==='planOutfit'||action==='recordWear';const target=outfitAction?await this.outfit(input.targetId):await this.garment(input.targetId);if(target.owner_id!==this.user.id)throw new AppError('unauthorized_target',403);
  if(action==='recordWear'){
    const intents=await this.db.rows(this.user,'sc_operation_intents',`owner_id=eq.${this.user.id}&action=eq.recordWear&intent_key=eq.${encodeURIComponent(input.intentKey)}&select=*&limit=1`);
    const committed=intents[0]?(await this.db.rows(this.user,'sc_operation_receipts',`owner_id=eq.${this.user.id}&action=eq.recordWear&operation_id=eq.${intents[0].operation_id}&select=*&limit=1`))[0]:undefined;
    if(!committed){
      const outfit=outfitFrom(target);if(Object.keys(outfit.externalItems??{}).length)throw new AppError('invalid_input');
      for(const [slot,id]of Object.entries(outfit.items)){
        const garment=await this.garment(id);
        if(garment.owner_id!==this.user.id||garment.category!==slot)throw new AppError('unauthorized_target',403);
        if(outfit.assetIds?.[id] !== (garment.asset_id??null)||outfit.assetVersions[id]!==Number(garment.asset_version??0))throw new AppError('stale_revision',409);
        if(garment.asset_id)await this.asset(String(garment.asset_id),Number(garment.asset_version));
      }
    }
  }
  const garmentIds=outfitAction?outfitFrom(target).items:{target:input.targetId};const snapshot={client_event_id:input.clientEventId,occurred_at:input.date+'T12:00:00+09:00',input_source:input.inputSource,garment_ids:Object.values(garmentIds),outfit_id:outfitAction?input.targetId:null,details_json:{value:input.value,...(!outfitAction?{garmentId:input.targetId}:{})},...(action==='recordMovementConfirmed'?{location_json:{location:input.value,source:input.inputSource}}:{})};
  const r=record(await this.db.rpc(this.user,'sc_commit_action',{p_owner_id:this.user.id,p_action:action,p_intent_key:input.intentKey,p_draft_id:null,p_draft_revision:null,p_snapshot:snapshot}));const entity=eventFrom(record(r.result));return{entity,receipt:this.receipt({...r,action},entity),replayed:r.replayed===true};
 }
 async upload(id:string,bytes:Buffer,mime:string){const pending=await this.db.one(this.user,'sc_assets',id);if(pending.owner_id!==this.user.id||pending.status!=='pending')throw new AppError('unauthorized_target',403);const m=inspectMedia(bytes,mime);if(m.sha256!==pending.sha256||m.bytes!==Number(pending.byte_size)||m.mime!==pending.mime_type)throw new AppError('invalid_input');
  await this.db.request(`/storage/v1/object/${pending.bucket_id}/${pending.storage_key}`,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:new Uint8Array(bytes)},this.user.token);return{uploaded:true,asset_id:id,status:'pending'};
 }
 async bytes(id:string){const a=await this.db.one(this.user,'sc_assets',id);const response=await this.db.request(`/storage/v1/object/authenticated/${a.bucket_id}/${a.storage_key}`,{},this.user.token);if(!(response instanceof Response))throw new AppError('result_unavailable',404);const length=Number(response.headers.get('content-length')??a.byte_size);if(length>100*1024*1024)throw new AppError('invalid_input');const bytes=Buffer.from(await response.arrayBuffer());const media=inspectMedia(bytes,String(a.mime_type));if(media.sha256!==a.sha256||media.bytes!==Number(a.byte_size))throw new AppError('result_unavailable',409);return{asset:a,bytes,media};}
 async finalize(id:string){const a=await this.db.one(this.user,'sc_assets',id);if(a.owner_id!==this.user.id)throw new AppError('unauthorized_target',403);const {media}=await this.bytes(id);return this.db.control('sc_finalize_asset',{p_owner_id:this.user.id,p_asset_id:id,p_verified_sha256:media.sha256,p_verified_byte_size:media.bytes,p_verified_mime_type:media.mime});}
}
