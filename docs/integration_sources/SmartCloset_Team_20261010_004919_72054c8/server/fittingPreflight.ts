import {AppError,integer,record,text,uuid} from './errors';
import {stable} from '../src/core/repository';
import type {DatabaseRepository} from './repository';
import type {ServerConfig} from './config';
import type {OutfitDraft} from '../src/core/types';
import type {FittingSnapshot} from '../src/mirrorScene';
import type {verifyVideo} from './media';

export interface FittingPreflightInput {
  draft:OutfitDraft;snapshot:FittingSnapshot;fittingMode:'batch'|'realtime';
  personAssetId:string;personAssetVersion:number;referenceAssetId:string;referenceAssetVersion:number;
}
const active=new Set(['reserved','submitted','running','unknown_submission']);
const rate=.04;
/** Never call repo.state (profile bootstrap), putDraft, RPC, reservation, upload or a provider here. */
export async function readFittingPreflight(config:ServerConfig,repo:DatabaseRepository,input:FittingPreflightInput,verify:typeof verifyVideo) {
  const owner=repo.user.id,now=Date.now(),snapshot=record(input.snapshot),person=record(snapshot.person),outfit=record(snapshot.outfit);
  const blocked=(reasonCode:string,message:string)=>({status:'blocked' as const,reasonCode,message,noExecution:true,
    mode:input.fittingMode==='batch'?'live-batch':'live-realtime',checkedAt:now});
  if(input.draft.ownerId!==owner||snapshot.ownerId!==owner)throw new AppError('unauthorized_target',403);
  uuid(input.draft.draftId);integer(input.draft.revision);integer(snapshot.requestVersion);
  // The central portrait is a local immutable identity, not a transmitted provider asset.
  text(person.assetId,160);integer(person.assetVersion);
  const videoId=uuid(input.personAssetId),referenceId=uuid(input.referenceAssetId);
  integer(input.personAssetVersion);integer(input.referenceAssetVersion);
  if(!['batch','realtime'].includes(input.fittingMode)||!Array.isArray(outfit.items)||!(input.draft.items.top||input.draft.externalItems?.top)||!(input.draft.items.bottom||input.draft.externalItems?.bottom)
    ||outfit.draftId!==input.draft.draftId||outfit.revision!==input.draft.revision)throw new AppError('invalid_input');
  const items=outfit.items.map(record),entries=Object.entries(input.draft.items);
  if(items.length!==entries.length||new Set(items.map(row=>row.slot)).size!==items.length
    ||entries.some(([slot,id])=>!items.some(row=>row.slot===slot&&row.garmentId===id)))throw new AppError('invalid_input');
  const versions:Record<string,number>={};
  const assets:Record<string,unknown>[]=[];
  for(const [slot,id] of entries){
    const garment=await repo.garment(uuid(id));
    const item=items.find(row=>row.slot===slot)!;
    if(garment.owner_id!==owner||garment.category!==slot)throw new AppError('unauthorized_target',403);
    if(!garment.asset_id||item.assetId!==garment.asset_id||item.assetVersion!==garment.asset_version)throw new AppError('stale_revision',409);
    const asset=await repo.asset(uuid(item.assetId),integer(item.assetVersion));assets.push(asset);
    versions[String(asset.id)]=Number(asset.version);
  }
  const externalEntries=Object.entries(input.draft.externalItems??{}),externalRows=outfit.externalItems===undefined?[]:Array.isArray(outfit.externalItems)?outfit.externalItems.map(record):null;
  if(!externalRows||externalRows.length!==externalEntries.length||new Set(externalRows.map(row=>row.slot)).size!==externalRows.length)throw new AppError('invalid_input');
  for(const [slot,selection]of externalEntries){
    const row=externalRows.find(item=>item.slot===slot);
    if(input.draft.items[slot as keyof typeof input.draft.items]||!row||row.externalItemId!==selection.externalItemId||row.assetId!==selection.assetId||row.assetVersion!==selection.assetVersion)throw new AppError('invalid_input');
    const external=await repo.db.one(repo.user,'sc_external_items',uuid(selection.externalItemId));
    if(external.owner_id!==owner||external.asset_id!==selection.assetId||external.source_label!==selection.sourceLabel||(external.source_url??null)!==selection.sourceUrl)throw new AppError('unauthorized_target',403);
    const asset=await repo.asset(uuid(selection.assetId),integer(selection.assetVersion));assets.push(asset);versions[String(asset.id)]=Number(asset.version);
  }
  const video=await repo.asset(videoId,input.personAssetVersion),reference=await repo.asset(referenceId,input.referenceAssetVersion);
  if(video.kind!=='person_video'||reference.kind!=='outfit_reference'||!['image/png','image/jpeg','image/webp'].includes(String(reference.mime_type)))throw new AppError('asset_required');
  assets.push(video,reference);versions[videoId]=Number(video.version);versions[referenceId]=Number(reference.version);
  const drafts=await repo.db.rows(repo.user,'sc_drafts','id=eq.'+input.draft.draftId+'&owner_id=eq.'+owner+'&select=*&limit=2');
  if(drafts.length>1)throw new AppError('conflict',409);
  if(drafts[0]){
    const previous=record(record(drafts[0].state_json)._client??{});
    if(drafts[0].status==='discarded'||Number(previous.revision)>input.draft.revision)throw new AppError('stale_revision',409);
    if(Number(previous.revision)===input.draft.revision
      &&(previous.ownerId!==owner||stable(previous.items)!==stable(input.draft.items)||stable(previous.externalItems??{})!==stable(input.draft.externalItems??{})||previous.topLocked!==input.draft.topLocked||previous.name!==input.draft.name))throw new AppError('conflict',409);
  }
  const jobs=await repo.db.rows(repo.user,'sc_ai_jobs','owner_id=eq.'+owner+'&select=*&limit=1000');
  if(jobs.length>=1000)return blocked('budget_state_incomplete','진행 작업 조회가 완전하지 않아 실행 조건을 확정할 수 없습니다.');
  const matching=jobs.filter(job=>{
    if(job.owner_id!==owner||job.mode!=='live'||job.provider!=='decart'||job.model!=='lucy-vton-3.6'||job.stage!=='batch'||!active.has(String(job.status)))return false;
    const original=record(job.input_snapshot_json??{});
    // Compare the complete persisted request underlying execute's signature, not selected labels.
    const expected={action:'startTryOn',fittingMode:'batch',draft:input.draft,personAssetId:videoId,
      referenceAssetId:referenceId,asset_versions:versions};
    return input.fittingMode==='batch'&&stable(original)===stable(expected);
  });
  if(matching.length>1)throw new AppError('conflict',409);
  if(matching[0]){
    const job=matching[0];
    return {status:'existing_operation' as const,mode:'live-batch' as const,noExecution:true,checkedAt:now,
      message:'이미 접수된 동일 입력의 원 작업을 연결합니다. 새 생성·예산 예약은 하지 않습니다.',
      snapshot:input.snapshot,personIdentityEvidence:'client-confirmed-same-person',personAssetId:videoId,personAssetVersion:input.personAssetVersion,
      referenceAssetId:referenceId,referenceAssetVersion:input.referenceAssetVersion,
      existingOperation:{operationId:uuid(job.operation_id),processingStatus:String(job.status),providerReady:typeof job.provider_job_id==='string'&&job.provider_job_id.length>0}};
  }
  if(jobs.some(row=>row.owner_id===owner&&row.mode==='live'&&active.has(String(row.status))))
    return blocked('active_execution','다른 입력의 실행이 진행 중이거나 접수 확인 중입니다.');

  if(!config.liveEnabled)return blocked('live_disabled','서버의 실제 실행이 꺼져 있습니다.');
  if(!config.serverKey||!config.decartKey)return blocked('configuration_required','서버의 피팅 연결 설정이 필요합니다.');
  if(input.fittingMode==='realtime')return blocked('strict_bound_unverified','실시간 토큰의 재사용·동시 세션에 대한 총비용 상한을 아직 검증하지 못해 연결할 수 없습니다. 배치 경로는 별도로 검증할 수 있습니다.');
  if(assets.some(asset=>!Array.isArray(asset.allowed_providers)||!asset.allowed_providers.includes('decart')))
    return blocked('asset_provider_consent_required','현재 입력 자산의 Decart 전송 허용이 필요합니다.');
  const approvals=await repo.db.rows(repo.user,'sc_execution_approvals','owner_id=eq.'+owner+'&action=eq.startTryOn&provider=eq.decart&select=*&limit=1000');
  if(approvals.length>=1000)return blocked('budget_state_incomplete','승인 조회가 완전하지 않아 실행 조건을 확정할 수 없습니다.');
  // Match the same existing approval selection used by execute; never create or broaden it.
  const approval=approvals.find(row=>row.owner_id===owner&&!row.revoked_at&&row.currency==='USD'
    &&row.action==='startTryOn'&&row.provider==='decart'&&row.model==='lucy-vton-3.6'
    &&Date.parse(String(row.valid_from))<=now&&Date.parse(String(row.valid_until))>now
    &&Object.entries(versions).every(([id,version])=>record(row.allowed_asset_versions)[id]===version));
  if(!approval)return blocked('approval_required','현재 전체 코디 자산 버전과 일치하는 유효한 기존 실행 승인이 없습니다.');
  uuid(approval.id);
  const ledger=await repo.db.rows(repo.user,'sc_budget_ledger','owner_id=eq.'+owner+'&approval_id=eq.'+approval.id+'&select=*&limit=1000');

  if(ledger.length>=1000||jobs.length>=1000)return blocked('budget_state_incomplete','예산·진행 작업 조회가 완전하지 않아 실행 조건을 확정할 수 없습니다.');
  let spent=0;
  for(const row of ledger){
    if(row.owner_id!==owner||row.approval_id!==approval.id)throw new AppError('unauthorized_target',403);
    const amount=row.settlement_status==='settled'?Number(row.actual_usd):
      ['reserved','unsettled'].includes(String(row.settlement_status))?Number(row.reserved_usd):row.settlement_status==='released'?0:NaN;
    if(!Number.isFinite(amount)||amount<0||row.settlement_status==='settled'&&row.actual_usd===null)
      return blocked('budget_state_incomplete','정산되지 않은 예산 상태를 확인할 수 없습니다.');
    spent+=amount;
  }
  const perRequest=Number(approval.per_request_usd),total=Number(approval.total_usd),maxSeconds=Number(approval.max_generated_seconds);
  const maxAttempts=Number(approval.max_attempts),maxConcurrency=Number(approval.max_concurrency);
  if(!Number.isFinite(perRequest)||perRequest<=0||!Number.isFinite(total)||total<=0||!Number.isSafeInteger(maxSeconds)||maxSeconds<=0
    ||!Number.isSafeInteger(maxAttempts)||maxAttempts<=0||!Number.isSafeInteger(maxConcurrency)||maxConcurrency<=0)
    return blocked('budget_state_incomplete','승인의 비용·시간·실행 횟수 한도를 확인할 수 없습니다.');
  if(jobs.some(row=>row.owner_id===owner&&row.mode==='live'&&active.has(String(row.status))))
    return blocked('active_execution','현재 계정의 다른 실행이 진행 중이거나 접수 확인 중입니다.');
  if(jobs.filter(row=>row.approval_id===approval.id).length>=maxAttempts)return blocked('budget_exceeded','기존 승인의 실행 횟수 한도에 도달했습니다.');
  const remainingUsd=Math.max(0,total-spent),remainingSeconds=Math.min(maxSeconds,Math.floor((Math.min(perRequest,remainingUsd)+1e-9)/rate));
  const bytes=await repo.bytes(videoId),verified=await verify(bytes.bytes,String(bytes.asset.mime_type));
  if(verified.inspected!==true||!Number.isFinite(verified.durationSeconds)||verified.durationSeconds<=0)throw new AppError('invalid_input');
  const seconds=Math.ceil(verified.durationSeconds),estimatedUsd=seconds*rate;
  if(seconds>remainingSeconds)return blocked('budget_exceeded','현재 영상 길이가 기존 승인의 남은 금액 또는 생성 시간 한도를 넘습니다.');
  return {status:'ready' as const,mode:'live-batch' as const,noExecution:true,checkedAt:now,
    message:'기존 승인과 남은 배치 한도를 확인했습니다. 아직 실행·예약하지 않았으며 실행 시 다시 검증합니다.',
    snapshot:input.snapshot,personIdentityEvidence:'client-confirmed-same-person',personAssetId:videoId,personAssetVersion:input.personAssetVersion,
    referenceAssetId:referenceId,referenceAssetVersion:input.referenceAssetVersion,
    approval:{ownerId:owner,approvalId:String(approval.id),validUntilMs:Date.parse(String(approval.valid_until)),
      perRequestUsd:perRequest,totalUsd:total,maxGeneratedSeconds:remainingSeconds,allowedAssetVersions:versions},
    budget:{remainingUsd,remainingSeconds,estimatedUsd,videoSeconds:seconds}};
}
