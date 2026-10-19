import {careEvidenceGrounding,CARE_GROUNDING_REVISION} from '../src/careEvidence';
import {buildLifeSnapshot,lifeAvailabilityBlock} from '../src/lifeSnapshot';
import {fittingContentIdentity,FITTING_BATCH_CONFIGURATION} from './fittingContentIdentity';
import {readFittingPreflight,type FittingPreflightInput} from './fittingPreflight';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, record, text, uuid } from './errors';
import { DatabaseRepository } from './repository';
import { stable } from '../src/core/repository';
import { PreparedMockRunner } from '../src/core/mock';
import { ResponsesAdapter, DecisionsAdapter, AgentsAdapter, DecartAdapter, ProviderError, parseStyleObservation, parseProposal, type AgentProposal, type AgentInput, type AgentJournal, type ProviderFetch, type ReadHandlers, type ProviderUsage, type SavedToolCall } from './providers';
import type { ServerConfig, AiMode } from './config';
import type { OutfitDraft, RegistrationDraft, Slot } from '../src/core/types';
import { inspectMedia, verifyVideo } from './media';
import { verifiedAvailability } from './availability';
import type { AvailabilityConfirmation } from '../src/outfitReview';

export interface AiRequest { action: 'analyzeRegistration'|'analyzeStyleReference'|'evaluatePhoto'|'generateOutfits'|'adaptStyleToWardrobe'|'requestCareGuide'|'startTryOn'; intentKey: string; draft?: RegistrationDraft|OutfitDraft; conditions?: Record<string, unknown>; garmentId?: string; referenceAssetId?: string; personAssetId?: string; fittingMode?: 'batch'|'realtime'; availabilityConfirmations?: AvailabilityConfirmation[]; editableSlot?:Slot }
export const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
export const EXECUTION_BOUNDS = Object.freeze({
  reviewedOn: '2026-10-08',
  analyzeRegistration: { maxInputTokens: 922_000, maxOutputTokens: 1800, inputUsdPerMillion: 5.5, outputUsdPerMillion: 16.5, reservedUsd: 5.1007 },
  analyzeStyleReference: { maxInputTokens: 922_000, maxOutputTokens: 1800, inputUsdPerMillion: 5.5, outputUsdPerMillion: 16.5, reservedUsd: 5.1007 },
  evaluatePhoto: { maxInputTokens: 922_000, maxOutputTokens: 0, inputUsdPerMillion: 0.22, outputUsdPerMillion: 0, reservedUsd: 0.20284 },
});
const models = { analyzeRegistration: 'gpt-6.1-sol', analyzeStyleReference: 'gpt-6.1-sol', evaluatePhoto: 'gpt-6-luna', generateOutfits: 'gpt-6-astra', adaptStyleToWardrobe: 'gpt-6-astra', requestCareGuide: 'gpt-6-astra', startTryOn: 'lucy-vton-3.6' };
const agentActions = new Set(['generateOutfits','adaptStyleToWardrobe','requestCareGuide']);
const wireAction = (action: AiRequest['action']) => action === 'evaluatePhoto' ? 'classifyRegistration' : action;
const finalStatuses = new Set(['succeeded','failed','cancelled']);
const fittingResultMetadata=(job:Record<string,unknown>)=>{const saved=record(job.result_json??{});return{fitting_content:saved.fitting_content,fitting_content_key:saved.fitting_content_key};};
const providerError = (e: unknown) => {
  if (e instanceof AppError) return e;
  if (e instanceof ProviderError) {
    if (e.code === 'unknown_submission') return new AppError('unknown_submission', 502);
    if (e.code === 'provider_refusal') return new AppError('provider_refusal', 422);
    if (e.code === 'configuration_required' || e.code === 'provider_authentication' || e.code === 'provider_forbidden') return new AppError('configuration_required', 503);
    if (e.code === 'provider_rate_limit') return new AppError('rate_limited', 429);
  }
  return new AppError('provider_failed', 502);
};

export class AiService {
  private fixtureTransport = false;
  private static readonly activeRecoveries = new Map<string, Promise<unknown>>();
  private mediaVerifier = verifyVideo;
  constructor(readonly config: ServerConfig, readonly repo: DatabaseRepository, private readonly transport: ProviderFetch = fetch) {}
  /** Test harness only. No environment variable or HTTP input can enable this path. */
  static forContractTests(config: ServerConfig, repo: DatabaseRepository, transport: ProviderFetch, mediaVerifier = verifyVideo) {
    if (transport === fetch) throw new AppError('invalid_input');
    const service = new AiService(config, repo, transport); service.fixtureTransport = true; service.mediaVerifier = mediaVerifier; return service;
  }
  /** Read-only readiness check; execute still owns the atomic reservation and final authorization. */
  preflightFitting(input:FittingPreflightInput){return readFittingPreflight(this.config,this.repo,input,this.mediaVerifier);}
  private async scope(request: AiRequest) {
    if (!Object.hasOwn(models, request.action)) throw new AppError('invalid_input');
    if(request.editableSlot&&(!['generateOutfits','adaptStyleToWardrobe'].includes(request.action)||!['top','bottom','outer','bag','shoes','hat','accessory'].includes(request.editableSlot)||!request.draft||!('items'in request.draft)))throw new AppError('invalid_input');
    const state = await this.repo.state(), versions: Record<string, number> = {};
    if(request.availabilityConfirmations!==undefined){
      if(!['generateOutfits','adaptStyleToWardrobe'].includes(request.action))throw new AppError('invalid_input');
      verifiedAvailability(this.repo.user.id,state.garments,request.availabilityConfirmations,true);
    }
    if (request.draft) {
      if (request.draft.ownerId !== this.repo.user.id) throw new AppError('unauthorized_target', 403);
      await this.repo.putDraft(request.draft);
      if ('asset' in request.draft && request.draft.asset) { const a = request.draft.asset; await this.repo.asset(a.id, a.version); versions[a.id] = a.version; }
      if ('items' in request.draft) for (const id of Object.values(request.draft.items)) {
        const garment = state.garments.find(g => g.id === id && g.ownerId === this.repo.user.id); if (!garment) throw new AppError('unauthorized_target', 403);
        if (garment.asset) { await this.repo.asset(garment.asset.id, garment.asset.version); versions[garment.asset.id] = garment.asset.version; }
      }
    }
    if(request.draft&&'items'in request.draft)for(const item of Object.values(request.draft.externalItems??{})){if(!item.assetId||!item.assetVersion)throw new AppError('asset_required');await this.repo.asset(item.assetId,item.assetVersion);versions[item.assetId]=item.assetVersion;}
    if (request.garmentId) { const g = await this.repo.garment(uuid(request.garmentId)); if (g.owner_id !== this.repo.user.id) throw new AppError('unauthorized_target', 403); if (g.asset_id) { await this.repo.asset(String(g.asset_id), Number(g.asset_version)); versions[String(g.asset_id)] = Number(g.asset_version); } }
    for (const id of [request.referenceAssetId, request.personAssetId].filter(Boolean) as string[]) { const a = await this.repo.asset(uuid(id)); versions[id] = Number(a.version); }
    return { state, versions };
  }
  private async agentScope(request: AiRequest, suppliedState?: Awaited<ReturnType<DatabaseRepository['state']>>): Promise<AgentInput> {
    if(request.draft&&'externalItems'in request.draft&&Object.keys(request.draft.externalItems??{}).length)throw new AppError('invalid_input');
    const state = suppliedState ?? await this.repo.state();
    const life = buildLifeSnapshot(state, this.repo.user.id, {conditions:request.conditions});
    const allowed = state.garments.filter(g => g.ownerId === this.repo.user.id && (request.action !== 'requestCareGuide' || g.id === request.garmentId));
    const availability = verifiedAvailability(this.repo.user.id,allowed,request.availabilityConfirmations);
    const evidence = life.evidence.filter(e => allowed.some(g => g.id === e.garmentId)&&careEvidenceGrounding(e)!==null);
    const contextEvidence = request.action === 'requestCareGuide' ? [] : [...life.preferences.map(p=>p.id), ...(life.weather && life.context ? [life.context.id] : [])];
    return { task: request.action === 'requestCareGuide' ? 'care' : request.action === 'adaptStyleToWardrobe' ? 'adapt_style' : 'outfit',
      context: { care_grounding_revision:CARE_GROUNDING_REVISION,life_snapshot_revision:digest(life.revisionKey), life_snapshot:{ownerId:life.ownerId,namespace:life.namespace,provenance:life.provenance,context:life.context,weather:life.weather,preferences:request.action==='requestCareGuide'?[]:life.preferences}, editable_slot:request.editableSlot??null,preserved_items:request.editableSlot&&request.draft&&'items'in request.draft?Object.fromEntries(Object.entries(request.draft.items).filter(([slot])=>slot!==request.editableSlot)):null,conditions: life.conditions ?? { status: 'unavailable' }, target_garment_id: request.garmentId ?? null, reference_asset_id: request.referenceAssetId ?? null, draft_revision: request.draft?.revision ?? null, locked_slots: request.draft&&'lockedSlots'in request.draft?request.draft.lockedSlots??{}:{}, selected_items: request.draft && 'items' in request.draft ? request.draft.items : {} },
      allowedGarmentIds: allowed.map(g => g.id), allowedEvidenceIds: [...evidence.map(e => e.id), ...contextEvidence, ...Array.from(availability.values(), item => item.evidenceId)],
      // Request confirmations are revalidated; ownership, care notes and location are never evidence of availability.
      garmentScope: allowed.map(g => {const confirmation=availability.get(g.id),history=life.garments.find(item=>item.id===g.id)?.history,lifeBlock=history?lifeAvailabilityBlock(history):null;return{garmentId:g.id,category:g.category==='dress'?'unknown' as const:g.category,availability:lifeBlock==='user_marked_laundry_pending'?'laundry' as const:lifeBlock?'unknown' as const:confirmation?.status??'unknown',...(lifeBlock?{lifeBlock}:{}),...(confirmation?{availabilitySource:'user_confirmation' as const,availabilityEvidenceId:confirmation.evidenceId}:{})};}),
      ...(request.draft && 'topLocked' in request.draft && request.draft.topLocked ? { lockedTopId: request.draft.items.top } : {}),
    };
  }
  async execute(request: AiRequest, mode: AiMode = this.config.aiMode) {
    if (request.action === 'startTryOn' && !request.fittingMode) request = { ...request, fittingMode: 'batch' };
    if (!['mock','saved_result','live'].includes(mode)) throw new AppError('invalid_input');
    const { state, versions } = await this.scope(request);
    const agentScope = agentActions.has(request.action) ? await this.agentScope(request, state) : undefined;
    const snapshot = { ...request, intentKey: undefined, asset_versions: versions, ...(agentScope?{life_snapshot_revision:agentScope.context.life_snapshot_revision}:{}) };
    // Reservation identity remains unchanged: the DB receipt hash includes this complete request.
    const signature = digest({ mode: 'live', model: models[request.action], schema: 'provider-v1', snapshot });
    const content = request.action==='startTryOn'?fittingContentIdentity(request,this.repo.user.id,versions,state.garments):null;
    const contentMetadata=content?{fitting_content:content,fitting_content_key:digest(content)}:{};
    if (mode === 'mock') {
      const runner = new PreparedMockRunner(); let result: unknown = null;
      if (request.action === 'analyzeRegistration' && request.draft && 'category' in request.draft) result = await runner.analyze(request.draft);
      if (request.action === 'generateOutfits' && request.draft && 'items' in request.draft) result = await runner.recommend({ draft: request.draft, conditions: request.conditions as never, garments: state.garments,...(request.editableSlot?{editableSlot:request.editableSlot}:{}) });
      if(request.action==='generateOutfits'&&request.availabilityConfirmations!==undefined&&result){const availability=verifiedAvailability(this.repo.user.id,state.garments,request.availabilityConfirmations);if(Object.values(result as Record<string,string>).some(id=>availability.get(id)?.status!=='available'))result=null;}
      if (request.action === 'requestCareGuide') { const garment = state.garments.find(g => g.id === request.garmentId); if (garment) result = await runner.careGuide(garment); }
      return { operation_id: `mock-${randomUUID()}`, processing_status: result ? 'succeeded' : 'unavailable', apply_status: result ? 'not_applied' : 'unavailable', job_id: null, mode, result, usage: null, message: result ? '입력에 연결된 준비 예시입니다.' : '일치하는 준비 결과가 없습니다. 실제 호출하지 않았습니다.' };
    }
    if (mode === 'saved_result') {
      const jobs = await this.repo.db.rows(this.repo.user, 'sc_ai_jobs', `owner_id=eq.${this.repo.user.id}&job_signature=eq.${signature}&mode=eq.live&status=eq.succeeded&select=*&limit=1`);
      const matchesContent=(row:Record<string,unknown>)=>{
        const saved=record(row.result_json??{});
        return row.owner_id===this.repo.user.id&&row.mode==='live'&&row.status==='succeeded'&&row.result_ref
          &&saved.fitting_content_key===digest(content)&&stable(saved.fitting_content)===stable(content);
      };
      // An exact request must still respect content/config changes whenever the job has a verified map.
      const exact=jobs.find(row=>!content||!record(row.result_json??{}).fitting_content||matchesContent(row));
      // Content reuse is separate from the DB's intent/reservation key. Legacy jobs without this
      // verified map remain eligible only through the exact original request query above.
      const reusable=!exact&&content?await this.repo.db.rows(this.repo.user,'sc_ai_jobs',`owner_id=eq.${this.repo.user.id}&provider=eq.decart&model=eq.${models.startTryOn}&stage=eq.${request.fittingMode}&mode=eq.live&status=eq.succeeded&select=*&limit=1000`):[];
      const job = exact??reusable.find(matchesContent);
      if (!job?.result_json) throw new AppError('result_unavailable', 404);
      const saved = record(job.result_json), reviewed = await this.reviewAgentResult(job, saved.value ?? saved, request);
      return { operation_id: String(job.operation_id), processing_status: 'succeeded', apply_status: 'not_applied', job_id: String(job.id), mode, ...reviewed, usage: saved.usage ?? null, result_asset_id: job.result_ref ?? null, message: reviewed.result_review ? '저장된 제안을 현재 옷장 기준으로 다시 검토했습니다. 저장 원본은 변경하지 않았습니다.' : '같은 입력·자산 버전의 저장된 실제 결과입니다.' };
    }
    if (!this.config.liveEnabled) throw new AppError('approval_required', 403);
    const provider = request.action === 'startTryOn' ? 'decart' : 'openai';
    if (!(provider === 'openai' ? this.config.openaiKey : this.config.decartKey) || !this.config.serverKey) throw new AppError('configuration_required', 503);
    // Managed turns and reusable realtime tokens have no verified strict total spend bound.
    if (!this.fixtureTransport && (agentActions.has(request.action) || request.action === 'startTryOn' && request.fittingMode === 'realtime')) throw new AppError('approval_required', 403);
    const now = Date.now();
    const approvals = await this.repo.db.rows(this.repo.user, 'sc_execution_approvals', `owner_id=eq.${this.repo.user.id}&action=eq.${wireAction(request.action)}&provider=eq.${provider}&select=*`);
    const approval = approvals.find(a => !a.revoked_at && a.currency === 'USD' && a.action === wireAction(request.action) && a.provider === provider && String(a.model) === models[request.action] && Date.parse(String(a.valid_from)) <= now && Date.parse(String(a.valid_until)) > now && Object.entries(versions).every(([id,v]) => record(a.allowed_asset_versions)[id] === v));
    if (!approval) throw new AppError('approval_required', 403);
    for (const id of Object.keys(versions)) { const a = await this.repo.asset(id); if (!Array.isArray(a.allowed_providers) || !a.allowed_providers.includes(provider)) throw new AppError('approval_required', 403); }
    let image: string | undefined, analysisKind: 'garment'|'label' = 'garment', video: Awaited<ReturnType<DatabaseRepository['bytes']>> | undefined, reference: Awaited<ReturnType<DatabaseRepository['bytes']>> | undefined;
    let validatedVideo: { durationSeconds: number; codec: 'h264'|'vp8'|'vp9'; inspected: true } | undefined;
    let estimated = 0, reservedUnits = 0, seconds = 0, maxOutput = 0;
    if (agentActions.has(request.action)) {
      // Explicitly injected fixture transport only; this is never a production estimate.
      estimated = 0.01; reservedUnits = 0;
    } else if (provider === 'openai') {
      const imageAssetId = request.action === 'analyzeStyleReference' || request.action === 'analyzeRegistration' && !request.draft ? request.referenceAssetId : request.draft && 'asset' in request.draft ? request.draft.asset?.id : null;
      if (!imageAssetId) throw new AppError('asset_required');
      const data = await this.repo.bytes(imageAssetId);
      if (request.action === 'analyzeStyleReference' && !['style_reference','outfit_reference'].includes(String(data.asset.kind))) throw new AppError('asset_required');
      if (request.action === 'analyzeRegistration' && !request.draft && data.asset.kind !== 'label') throw new AppError('asset_required');
      analysisKind = data.asset.kind === 'label' ? 'label' : 'garment';
      if (!['image/png','image/jpeg','image/webp'].includes(data.media.mime) || data.media.width > 1024 || data.media.height > 1024 || data.media.width < 1 || data.media.height < 1) throw new AppError('invalid_input');
      image = `data:${data.media.mime};base64,${data.bytes.toString('base64')}`;
      const bounds = request.action === 'analyzeStyleReference' ? EXECUTION_BOUNDS.analyzeStyleReference : request.action === 'analyzeRegistration' ? EXECUTION_BOUNDS.analyzeRegistration : EXECUTION_BOUNDS.evaluatePhoto;
      maxOutput = bounds.maxOutputTokens; estimated = bounds.reservedUsd; reservedUnits = bounds.maxInputTokens + maxOutput;
      if (Number(approval.max_output_tokens) < maxOutput) throw new AppError('budget_exceeded', 409);
    } else {
      if (!request.personAssetId || !request.referenceAssetId) throw new AppError('asset_required');
      video = await this.repo.bytes(request.personAssetId); reference = await this.repo.bytes(request.referenceAssetId);
      if (video.asset.kind !== 'person_video' || reference.asset.kind !== 'outfit_reference' || !reference.media.mime.startsWith('image/')) throw new AppError('asset_required');
      validatedVideo = await this.mediaVerifier(video.bytes, String(video.asset.mime_type));
      if (validatedVideo.inspected !== true || !Number.isFinite(validatedVideo.durationSeconds) || validatedVideo.durationSeconds <= 0) throw new AppError('invalid_input');
      seconds = request.fittingMode === 'realtime' ? Number(approval.max_generated_seconds) : Math.ceil(validatedVideo.durationSeconds);
      if (!Number.isInteger(seconds) || seconds <= 0 || seconds > Number(approval.max_generated_seconds) || request.fittingMode === 'realtime' && seconds < 10) throw new AppError('budget_exceeded', 409);
      estimated = seconds * (request.fittingMode === 'realtime' ? 0.02 : 0.04); reservedUnits = seconds;
    }
    if (!(estimated > 0) || !Number.isFinite(estimated) || estimated > Number(approval.per_request_usd)) throw new AppError('budget_exceeded', 409);
    const stored = request.draft ? await this.repo.putDraft(request.draft) : null;
    const reserved = record(await this.repo.db.control('sc_reserve_job', { p_request: { owner_id: this.repo.user.id, actor_id: this.repo.user.id, action: wireAction(request.action), intent_key: text(request.intentKey), input_snapshot: snapshot, approval_id: approval.id, provider, model: models[request.action], adapter: request.action, stage: request.fittingMode ?? request.action, job_signature: signature, estimated_usd: estimated, reserved_units: reservedUnits, unit_kind: provider === 'openai' ? 'token' : 'generated_second', asset_versions: versions, max_output_tokens: maxOutput, max_generated_seconds: seconds, draft_id: stored?.id ?? null, draft_revision: stored?.revision ?? null,
      config_json: { fittingMode: request.fittingMode ?? null, agentScope: agentScope ?? null, boundsVersion: EXECUTION_BOUNDS.reviewedOn }, absolute_end_at: provider === 'decart' && request.fittingMode === 'realtime' ? new Date(now + seconds * 1000).toISOString() : null } }));
    const jobId = String(reserved.job_id); if (reserved.reused) return this.operation(String(reserved.operation_id));
    const options = { fetch: this.transport, apiKey: provider === 'openai' ? this.config.openaiKey : this.config.decartKey, onAccepted: async (a: { id: string; kind: string }) => { await this.update(jobId, { status: 'submitted', [a.kind === 'response' ? 'response_id' : a.kind === 'session' ? 'session_id' : 'provider_job_id']: a.id }); } };
    let terminalWritten = false;
    try {
      // Mark dispatch before HTTP. Accepted IDs no longer move running back to submitted.
      await this.update(jobId, { status: 'submitted', ...(content?{result_json:contentMetadata}:{}) }); let result: unknown; let usage: ProviderUsage | null = null;
      if (agentScope) {
        const session = await new AgentsAdapter(options).start(agentScope);
        await this.update(jobId, { status: session.status === 'failed' ? 'failed' : 'running' });
        await this.unsettled(jobId);
        return { operation_id: String(reserved.operation_id), processing_status: session.status === 'failed' ? 'failed' : 'running', apply_status: 'not_applied', job_id: jobId, mode, result: null, provider_session_id: session.id };
      }
      if (request.action === 'analyzeStyleReference') {
        const r = await new ResponsesAdapter(options).analyzeStyleReference({assetId:request.referenceAssetId!,assetVersion:versions[request.referenceAssetId!],imageDataUrl:image!}); result=r.value;usage=r.usage;
      } else if (request.action === 'analyzeRegistration') {
        const draft = request.draft as RegistrationDraft | undefined, assetId = draft?.asset?.id ?? request.referenceAssetId!;
        const r = await new ResponsesAdapter(options).analyze({ assetId, assetVersion: versions[assetId], draftRevision: draft?.revision ?? 1, imageDataUrl: image!, kind: analysisKind, manualFields: Object.keys(draft?.manualFields ?? {}) }); result = r.value; usage = r.usage;
      } else if (request.action === 'evaluatePhoto') {
        const r = await new DecisionsAdapter(options).evaluatePhoto(image!); result = r.value; usage = r.usage; if (r.providerId) await this.update(jobId, { response_id: r.providerId });
      } else if (request.action === 'startTryOn') {
        if (request.fittingMode === 'realtime') { await this.update(jobId, { status: 'running' }); return { operation_id: String(reserved.operation_id), processing_status: 'running', apply_status: 'not_applied', job_id: jobId, mode, result: { absolute_end_at: reserved.absolute_end_at, token_endpoint: `/api/try-on/${reserved.operation_id}/token` } }; }
        const r = await new DecartAdapter(options).submit({ video: { blob: new Blob([new Uint8Array(video!.bytes)], { type: String(video!.asset.mime_type) }), filename: 'person.mp4', durationSeconds: validatedVideo!.durationSeconds, codec: validatedVideo!.codec, inspected: true }, referenceImage: new Blob([new Uint8Array(reference!.bytes)], { type: String(reference!.asset.mime_type) }), prompt: FITTING_BATCH_CONFIGURATION.prompt, seed: FITTING_BATCH_CONFIGURATION.seed, enhancePrompt: FITTING_BATCH_CONFIGURATION.enhancePrompt, maxDurationSeconds: Number(approval.max_generated_seconds) });
        const status = r.status === 'failed' ? 'failed' : 'running'; result = { ...contentMetadata, provider_status: r.status, file_status: 'not_acquired' };
        await this.update(jobId, { status, result_json: result }); await this.unsettled(jobId);
        return { operation_id: String(reserved.operation_id), processing_status: status, apply_status: 'not_applied', job_id: jobId, mode, result };
      }
      await this.update(jobId, { status: 'succeeded', result_json: { value: result, usage }, application_status: 'not_applied' }); terminalWritten = true; await this.unsettled(jobId);
      return { operation_id: String(reserved.operation_id), processing_status: 'succeeded', apply_status: 'not_applied', job_id: jobId, mode, result, usage };
    } catch (e) {
      if (!terminalWritten) {
        const code = e instanceof ProviderError ? e.code : e instanceof AppError && e.code === 'database_unavailable' ? 'unknown_submission' : 'provider_failed';
        // A lost DB acknowledgment may already have committed a terminal result. Never overwrite it.
        await this.update(jobId, { status: code === 'unknown_submission' ? 'unknown_submission' : 'failed', error_code: code }).catch(() => undefined);
        await this.unsettled(jobId).catch(() => undefined);
      }
      throw providerError(e);
    }
  }
  private update(jobId: string, patch: Record<string, unknown>) { return this.repo.db.control('sc_update_job', { p_owner_id: this.repo.user.id, p_job_id: jobId, p_patch: patch }); }
  private unsettled(jobId: string) { return this.repo.db.control('sc_settle_job', { p_owner_id: this.repo.user.id, p_job_id: jobId, p_settlement: { status: 'unsettled' } }); }
  /** Revalidate response copies against current wardrobe data; never rewrite historical results. */
  private async reviewAgentResult(job: Record<string, unknown>, value: unknown, request?: AiRequest): Promise<{ result: unknown; apply_status?: 'not_applied' | 'unavailable'; result_review?: { scope: 'current_wardrobe'; status: AgentProposal['kind']; stored_result_unchanged: true } }> {
    if (value == null || !agentActions.has(String(job.adapter))) return { result: value };
    // Legacy care entries are archival text with no captured life revision. Preserve their
    // original read contract; new care jobs always carry a snapshot and are revalidated below.
    if(job.adapter==='requestCareGuide'&&!record(record(record(job.config_json??{}).agentScope??{}).context??{}).life_snapshot_revision)return {result:value};
    // Historical request assertions are not a new confirmation; saved-result requests may supply a fresh review.
    const currentRequest = request ?? { ...record(job.input_snapshot_json ?? {}), action: job.adapter, availabilityConfirmations: undefined } as unknown as AiRequest;
    const currentScope = await this.agentScope(currentRequest);
    let result: AgentProposal;
    try {
      const prior=record(record(job.config_json??{}).agentScope??{}), priorContext=record(prior.context??{});
      if(priorContext.life_snapshot_revision && priorContext.life_snapshot_revision!==currentScope.context.life_snapshot_revision) result={kind:'needs_information',items:[],explanation:'날씨·취향·의류 상태 또는 관리 근거가 바뀌었어요. 현재 자료로 다시 확인해 주세요.',evidence_ids:[],unknown_fields:['life_snapshot_revision']};
      else if(priorContext.life_snapshot_revision&&priorContext.care_grounding_revision!==CARE_GROUNDING_REVISION) result={kind:'needs_information',items:[],explanation:'관리 근거의 검토 범위가 바뀌었어요. 현재 확인된 자료로 다시 요청해 주세요.',evidence_ids:[],unknown_fields:['care_grounding_revision']};
      else result = parseProposal(value, currentScope);
    }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // Deleted/recategorized garments and legacy invalid results are historical evidence, not current suggestions.
      result = { kind: 'needs_information', items: [], explanation: '저장된 제안의 의류·분류·사용 가능 여부를 현재 옷장에서 다시 확인해야 합니다. 확인 전에는 적용할 수 없습니다.', evidence_ids: [], unknown_fields: ['current_wardrobe_scope'] };
    }
    return { result, apply_status: result.kind === 'proposal' ? 'not_applied' : 'unavailable', result_review: { scope: 'current_wardrobe', status: result.kind, stored_result_unchanged: true } };
  }
  async operation(id: string) {
    const op = await this.repo.db.one(this.repo.user, 'sc_operations', uuid(id)); if (op.owner_id !== this.repo.user.id) throw new AppError('unauthorized_target', 403);
    const jobs = await this.repo.db.rows(this.repo.user, 'sc_ai_jobs', `owner_id=eq.${this.repo.user.id}&operation_id=eq.${id}&select=*&limit=1`), job = jobs[0];
    if (!job) { const receipts = await this.repo.db.rows(this.repo.user, 'sc_operation_receipts', `owner_id=eq.${this.repo.user.id}&operation_id=eq.${id}&select=*&limit=1`); return { operation_id: id, processing_status: op.processing_status, apply_status: op.apply_status, mode: 'database', job_id: null, receipt_id: receipts[0]?.id ?? null, result: receipts[0]?.result_json ?? null }; }
    if (job.owner_id !== this.repo.user.id) throw new AppError('unauthorized_target', 403);
    const saved = record(job.result_json ?? {}), reviewed = await this.reviewAgentResult(job, saved.value ?? job.result_json ?? null);
    return { operation_id: id, processing_status: job.status === 'submitted' ? 'running' : job.status, apply_status: job.application_status, ...(reviewed.result_review ? { historical_apply_status: job.application_status } : {}), mode: job.mode, job_id: job.id, ...reviewed, usage: saved.usage ?? null, result_asset_id: job.result_ref ?? null, provider_id: job.provider_job_id ?? job.response_id ?? job.session_id ?? null, error_code: job.error_code ?? null };
  }
  async jobFor(id: string) {
    const op = await this.repo.db.one(this.repo.user, 'sc_operations', uuid(id)); if (op.owner_id !== this.repo.user.id) throw new AppError('unauthorized_target', 403);
    const jobs = await this.repo.db.rows(this.repo.user, 'sc_ai_jobs', `owner_id=eq.${this.repo.user.id}&operation_id=eq.${id}&select=*&limit=1`);
    if (!jobs[0] || jobs[0].owner_id !== this.repo.user.id) throw new AppError('result_unavailable', 404); return jobs[0];
  }
  private requireBatch(job: Record<string, unknown>) { if (job.provider !== 'decart' || job.stage !== 'batch' || job.mode !== 'live') throw new AppError('invalid_input'); if (!job.provider_job_id) throw new AppError(job.status === 'unknown_submission' ? 'unknown_submission' : 'result_unavailable', 409); if (!this.config.decartKey) throw new AppError('configuration_required', 503); }
  async batchStatus(id: string) {
    const job = await this.jobFor(id); this.requireBatch(job);
    if (finalStatuses.has(String(job.status))) return { ...await this.operation(id), file_status: job.result_ref ? 'acquired' : 'not_acquired' };
    const r = await new DecartAdapter({ fetch: this.transport, apiKey: this.config.decartKey }).status(String(job.provider_job_id));
    const status = r.status === 'failed' ? 'failed' : 'running', result = { ...fittingResultMetadata(job), provider_status: r.status, file_status: 'not_acquired' };
    await this.update(String(job.id), { status, result_json: result }); await this.unsettled(String(job.id));
    return { operation_id: id, job_id: job.id, processing_status: status, file_status: 'not_acquired', result };
  }
  async batchContent(id: string) {
    let job = await this.jobFor(id); this.requireBatch(job);
    if (job.result_ref) { const saved = await this.repo.bytes(String(job.result_ref)); return new Blob([new Uint8Array(saved.bytes)], { type: saved.media.mime }); }
    if (finalStatuses.has(String(job.status))) throw new AppError('result_unavailable', 409);
    if (record(job.result_json ?? {}).provider_status !== 'completed') { await this.batchStatus(id); job = await this.jobFor(id); if (record(job.result_json ?? {}).provider_status !== 'completed') throw new AppError('result_unavailable', 409); }
    const blob = await new DecartAdapter({ fetch: this.transport, apiKey: this.config.decartKey }).content(String(job.provider_job_id));
    const bytes = Buffer.from(await blob.arrayBuffer()), media = inspectMedia(bytes, blob.type);
    await this.mediaVerifier(bytes, media.mime);
    const pending = await this.repo.db.rows(this.repo.user, 'sc_assets', `owner_id=eq.${this.repo.user.id}&created_by_job_id=eq.${job.id}&kind=eq.fitting_result&sha256=eq.${media.sha256}&select=*&limit=1`);
    const hash = digest({ job_id: job.id, sha256: media.sha256, mime: media.mime });
    const assetId = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const asset = pending[0] ?? record(await this.repo.db.control('sc_prepare_generated_asset', { p_owner_id: this.repo.user.id, p_job_id: job.id, p_asset_id: assetId, p_kind: 'fitting_result', p_mime_type: media.mime, p_byte_size: media.bytes, p_sha256: media.sha256 }));
    if (asset.status !== 'finalized') {
      if (asset.owner_id !== this.repo.user.id || asset.status !== 'pending' || asset.created_by_job_id !== job.id || asset.sha256 !== media.sha256 || Number(asset.byte_size) !== bytes.length || asset.mime_type !== media.mime) throw new AppError('unauthorized_target', 403);
      // Only this validated provider-result path uses server storage credentials. User uploads remain JWT scoped.
      try { await this.repo.db.request(`/storage/v1/object/${asset.bucket_id}/${asset.storage_key}`, { method: 'POST', headers: { 'Content-Type': media.mime, 'x-upsert': 'false' }, body: new Uint8Array(bytes) }, undefined, true); }
      catch (e) { if (!(e instanceof AppError && e.code === 'conflict')) throw e; }
      await this.repo.finalize(String(asset.id));
    }
    await this.update(String(job.id), { status: 'succeeded', result_ref: asset.id, result_json: { ...fittingResultMetadata(job), provider_status: 'completed', file_status: 'acquired', asset_id: asset.id, asset_version: asset.version }, application_status: 'not_applied' }); await this.unsettled(String(job.id));
    return blob;
  }
  async token(id: string) {
    if (!this.config.liveEnabled) throw new AppError('approval_required', 403); if (!this.config.decartKey) throw new AppError('configuration_required', 503);
    if (!this.fixtureTransport) throw new AppError('approval_required', 403);
    const job = await this.jobFor(id); if (job.provider !== 'decart' || record(job.config_json).fittingMode !== 'realtime' || !['reserved','submitted','running'].includes(String(job.status))) throw new AppError('invalid_input');
    const remaining = Math.floor((Date.parse(String(job.absolute_end_at)) - Date.now()) / 1000); if (remaining < 12) throw new AppError('budget_exceeded', 409);
    const lease = record(await this.repo.db.control('sc_issue_realtime_lease', { p_owner_id: this.repo.user.id, p_job_id: job.id, p_requested_seconds: remaining }));
    const nowMs = Date.now(), absoluteEndMs = Date.parse(String(job.absolute_end_at));
    const leaseDeadlineMs = Math.min(absoluteEndMs, Date.parse(String(lease.absolute_end_at)), nowMs + Number(lease.remaining_seconds) * 1000);
    const bounded = Math.floor((leaseDeadlineMs - nowMs) / 1000) - 1, ttlSeconds = Math.min(5, bounded - 10);
    if (ttlSeconds < 1) throw new AppError('budget_exceeded', 409);
    return new DecartAdapter({ fetch: this.transport, apiKey: this.config.decartKey }).createClientToken({ origin: this.config.origin, absoluteEndMs, nowMs, ttlSeconds, maxSessionSeconds: bounded - ttlSeconds });
  }
  async prepareLook(id: string, draft: OutfitDraft, referenceAssetId: string) {
    if (!this.config.liveEnabled || !this.fixtureTransport) throw new AppError('approval_required', 403);
    if (!this.config.decartKey) throw new AppError('configuration_required', 503);
    const job = await this.jobFor(id), original = record(job.input_snapshot_json);
    if (job.provider !== 'decart' || job.mode !== 'live' || job.stage !== 'realtime' || !['submitted','running'].includes(String(job.status)) || Date.parse(String(job.absolute_end_at)) <= Date.now()) throw new AppError('conflict', 409);
    const originalDraft = record(original.draft);
    if (draft.draftId !== originalDraft.draftId || draft.revision <= Number(originalDraft.revision)) throw new AppError('stale_revision', 409);
    const approval = await this.repo.db.one(this.repo.user, 'sc_execution_approvals', String(job.approval_id));
    if (approval.owner_id !== this.repo.user.id || approval.revoked_at || Date.parse(String(approval.valid_until)) <= Date.now()) throw new AppError('approval_required', 403);
    const { versions } = await this.scope({ action: 'startTryOn', intentKey: 'look-validation', draft, referenceAssetId: uuid(referenceAssetId) });
    for (const [assetId, version] of Object.entries(versions)) {
      const asset = await this.repo.asset(assetId, version);
      if (record(approval.allowed_asset_versions)[assetId] !== version || !Array.isArray(asset.allowed_providers) || !asset.allowed_providers.includes('decart')) throw new AppError('approval_required', 403);
    }
    const reference = await this.repo.asset(referenceAssetId);
    if (reference.kind !== 'outfit_reference' || !String(reference.mime_type).startsWith('image/')) throw new AppError('asset_required');
    return { operation_id: id, processing_status: 'look_ready', apply_status: 'not_applied', draft_revision: draft.revision, reference_asset_id: reference.id, reference_asset_version: reference.version, absolute_end_at: job.absolute_end_at, message: '전체 조합 참조가 준비됐습니다. 클라이언트 set 완료 전에는 전환 완료가 아닙니다.' };
  }
  async stop(id: string) {
    const job = await this.jobFor(id);
    if (finalStatuses.has(String(job.status))) return { operation_id: id, cancellation_requested: false, terminal_confirmed: job.stage !== 'realtime', status: job.status };
    if (job.session_id) { await this.update(String(job.id), { error_code: 'cancellation_requested' }); await new AgentsAdapter({ fetch: this.transport, apiKey: this.config.openaiKey }).cancel(String(job.session_id), `cancel:${job.id}`); return { operation_id: id, cancellation_requested: true, terminal_confirmed: false }; }
    if (job.provider_job_id || job.status === 'unknown_submission') return { operation_id: id, cancellation_requested: false, terminal_confirmed: false, message: '접수된 배치/불명확한 작업은 취소되지 않았습니다. 원 작업 조회·정산을 계속합니다.' };
    await this.update(String(job.id), { status: 'cancelled' }); await this.unsettled(String(job.id));
    return { operation_id: id, cancellation_requested: true, terminal_confirmed: false, message: '새 토큰 발급을 막았습니다. 열린 미디어 연결은 브라우저 disconnect와 트랙 종료로 정리합니다.' };
  }
  async readTools(request: AiRequest, scope: AgentInput): Promise<ReadHandlers> {
    const authorized = async (id: unknown) => { const key = uuid(id); if (!scope.allowedGarmentIds.includes(key)) throw new AppError('unauthorized_target', 403); const g = await this.repo.garment(key); if (g.owner_id !== this.repo.user.id) throw new AppError('unauthorized_target', 403); return g; };
    // Every read belongs to the same immutable input revision. A later event or changed source
    // cannot silently mix new data with an older provider turn, even when the IDs are unchanged.
    const current = async () => {
      const state=await this.repo.state(),life=buildLifeSnapshot(state,this.repo.user.id,{conditions:request.conditions});
      if(scope.context.life_snapshot_revision&&scope.context.life_snapshot_revision!==digest(life.revisionKey))throw new AppError('stale_revision',409);
      return {state,life};
    };
    const availabilityFields=(garmentId:string,garments:Awaited<ReturnType<DatabaseRepository['state']>>['garments'],history:{availability:string})=>{
      const lifeBlock=lifeAvailabilityBlock(history);if(lifeBlock)return {availability:lifeBlock==='user_marked_laundry_pending'?'laundry':'unknown',availability_source:'life_history',life_block:lifeBlock};
      const confirmation=verifiedAvailability(this.repo.user.id,garments,request.availabilityConfirmations).get(garmentId);
      return confirmation&&scope.allowedEvidenceIds.includes(confirmation.evidenceId)?{availability:confirmation.status,availability_source:'user_confirmation',availability_evidence_id:confirmation.evidenceId}:{availability:'unknown',availability_source:'unavailable'};
    };
    return {
      get_wardrobe_items: async args => {const {state,life}=await current();return life.garments.filter(g => scope.allowedGarmentIds.includes(g.id) && (!args.category || g.category === args.category) && (!args.query || g.name.includes(String(args.query)))).slice(0, 60).map(g => ({ id: g.id, name: g.name, category: g.category, color: g.color, material: g.material || 'unknown', ...availabilityFields(g.id,state.garments,g.history), life_history:g.history }));},
      get_garment_context: async args => { const g = await authorized(args.garment_id),{state,life}=await current();const garment=life.garments.find(item=>item.id===g.id);if(!garment)throw new AppError('unauthorized_target',403);return { id: garment.id, name: garment.name, category: garment.category, color: garment.color || 'unknown', material: garment.material || 'unknown', ...availabilityFields(garment.id,state.garments,garment.history), life_history:garment.history, events: life.events.filter(e => e.garmentIds!==undefined?e.garmentIds.includes(garment.id):e.garmentId === garment.id || e.outfitId && state.outfits.some(o=>o.ownerId===life.ownerId&&o.id===e.outfitId&&Object.values(o.items).includes(garment.id))).slice(-10), snapshot_revision:scope.context.life_snapshot_revision??digest(life.revisionKey) }; },
      get_care_evidence: async args => { const garment = await authorized(args.garment_id),{life}=await current(); const allowed = life.evidence.filter(e=>e.garmentId===garment.id&&scope.allowedEvidenceIds.includes(e.id)).slice(0,30).map(careEvidenceGrounding).filter((e):e is NonNullable<ReturnType<typeof careEvidenceGrounding>>=>e!==null); return allowed.length ? { status: 'available', evidence: allowed } : { status: 'unavailable' }; },
      get_outing_context: async () => {const {life}=await current();return {profile_id:life.ownerId,snapshot_revision:digest(life.revisionKey),conditions:life.conditions??{status:'unavailable'},context:life.context,weather:life.weather??{status:'unavailable'},preferences:scope.task==='care'?[]:life.preferences};},
      get_style_reference: async args => {
        await current();const id = uuid(args.asset_id); if (id !== request.referenceAssetId) throw new AppError('unauthorized_target', 403);
        const a = await this.repo.asset(id); if (a.kind !== 'style_reference' && a.kind !== 'outfit_reference') throw new AppError('unauthorized_target', 403);
        const rows = await this.repo.db.rows(this.repo.user,'sc_ai_jobs',`owner_id=eq.${this.repo.user.id}&adapter=eq.analyzeStyleReference&status=eq.succeeded&mode=eq.live&select=*&order=created_at.desc&limit=100`);
        const saved = rows.find(row=>{const snapshot=record(row.input_snapshot_json);return snapshot.referenceAssetId===id&&record(snapshot.asset_versions)[id]===a.version;});
        return {id:a.id,version:a.version,kind:a.kind,provenance:a.provenance,source_job_id:saved?.id??null,visual_features:saved?parseStyleObservation(record(saved.result_json).value):'unavailable',message:saved?'Saved visible observations; not proof of ownership.':'No matching saved observations; request the separate, approved reference analysis. Do not invent attributes.'};
      },
    };
  }
  private journal(job: Record<string, unknown>): AgentJournal {
    const split = (key: string) => { const parts = key.split(':'); if (parts.length !== 3 || parts[0] !== job.session_id || parts[1] !== job.turn_id) throw new AppError('unauthorized_target', 403); return parts; };
    return {
      getCall: async key => { const [session, turn, call] = split(key); const rows = await this.repo.db.rows(this.repo.user, 'sc_job_tool_calls', `owner_id=eq.${this.repo.user.id}&job_id=eq.${job.id}&session_id=eq.${encodeURIComponent(session)}&turn_id=eq.${encodeURIComponent(turn)}&call_id=eq.${encodeURIComponent(call)}&select=*&limit=1`); return rows[0] ? record(rows[0].result_json) as unknown as SavedToolCall : null; },
      saveCall: async (key, value) => { const [session, turn, call] = split(key); const signature = record(JSON.parse(value.signature)); const saved = record(await this.repo.db.control('sc_record_tool_call', { p_owner_id: this.repo.user.id, p_job_id: job.id, p_session_id: session, p_turn_id: turn, p_call_id: call, p_tool_name: signature.name, p_arguments_hash: digest(signature.arguments), p_result_json: value, p_event_intent_key: value.eventKey })); return record(saved.result_json) as unknown as SavedToolCall; },
      consumeCallAllowance: async () => (await this.repo.db.rows(this.repo.user, 'sc_job_tool_calls', `owner_id=eq.${this.repo.user.id}&job_id=eq.${job.id}&select=call_id&limit=9`)).length < 8,
    };
  }
  async recoverAgent(id: string) {
    const key = `${this.repo.user.id}:${id}`, active = AiService.activeRecoveries.get(key); if (active) return active;
    const work = this.recoverAgentOnce(id); AiService.activeRecoveries.set(key, work); try { return await work; } finally { AiService.activeRecoveries.delete(key); }
  }
  private async recoverAgentOnce(id: string) {
    let job = await this.jobFor(id); if (!job.session_id || job.provider !== 'openai' || !agentActions.has(String(job.adapter))) throw new AppError('result_unavailable', 404);
    if (finalStatuses.has(String(job.status))) return this.operation(id);
    const scope = record(record(job.config_json).agentScope) as unknown as AgentInput, request = record(job.input_snapshot_json) as unknown as AiRequest;
    const agent = new AgentsAdapter({ fetch: this.transport, apiKey: this.config.openaiKey });
    const recovered = await agent.recover(String(job.session_id), scope, job.turn_id ? String(job.turn_id) : undefined);
    if (recovered.turnId && job.turn_id !== recovered.turnId) { await this.update(String(job.id), { turn_id: recovered.turnId }); job = { ...job, turn_id: recovered.turnId }; }
    if (recovered.processingStatus === 'requires_action') {
      if (job.error_code === 'cancellation_requested') return { operation_id: id, job_id: job.id, processing_status: 'running', cancellation_requested: true, terminal_confirmed: false };
      if (!this.config.liveEnabled || !this.fixtureTransport) throw new AppError('approval_required', 403);
      const approval = await this.repo.db.one(this.repo.user, 'sc_execution_approvals', String(job.approval_id));
      if (approval.revoked_at || Date.parse(String(approval.valid_until)) <= Date.now()) { await this.update(String(job.id), { error_code: 'cancellation_requested' }); await agent.cancel(String(job.session_id), `cancel:${job.id}`); throw new AppError('approval_required', 403); }
      try { await agent.handleRequiredActions(recovered.session, await this.readTools(request, scope), this.journal(job)); }
      catch (e) { if (e instanceof ProviderError && e.code === 'unsupported_action') { await this.update(String(job.id), { error_code: 'cancellation_requested' }); await agent.cancel(String(job.session_id), `cancel:${job.id}`); } throw providerError(e); }
    }
    if (recovered.result) { await this.update(String(job.id), { status: 'succeeded', result_json: { value: recovered.result, usage: recovered.usage } }); await this.unsettled(String(job.id)); }
    else if (['failed','cancelled'].includes(recovered.processingStatus)) { await this.update(String(job.id), { status: recovered.processingStatus }); await this.unsettled(String(job.id)); }
    return { operation_id: id, job_id: job.id, processing_status: recovered.processingStatus, apply_status: 'not_applied', ...await this.reviewAgentResult(job, recovered.result, request), usage: recovered.usage };
  }
}
