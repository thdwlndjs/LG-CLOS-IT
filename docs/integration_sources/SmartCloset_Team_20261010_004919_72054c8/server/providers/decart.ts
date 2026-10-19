import { ProviderError, ProviderHttp, object, providerId, string, usage, type ProviderOptions, type ProviderResult } from './transport';

export interface VideoInput { blob: Blob; filename: string; durationSeconds: number; codec: 'h264' | 'vp8' | 'vp9'; inspected: true }
export interface DecartBatchInput { video: VideoInput; referenceImage: Blob; prompt: string; seed: number; enhancePrompt: boolean; maxDurationSeconds: number }
export interface DecartJob { jobId: string; status: 'pending' | 'processing' | 'completed' | 'failed' }
export interface ClientTokenInput { origin: string; absoluteEndMs: number; nowMs: number; ttlSeconds: number; maxSessionSeconds: number }
export interface ClientToken { apiKey: string; expiresAt: string; absoluteEndMs: number }
export class DecartAdapter {
  private readonly http: ProviderHttp;
  constructor(private readonly options: ProviderOptions) { this.http = new ProviderHttp(options, 'decart'); }
  async submit(input: DecartBatchInput, signal?: AbortSignal): Promise<ProviderResult<DecartJob>> {
    if (!input.video.inspected || !['video/mp4','video/webm'].includes(input.video.blob.type) || input.video.blob.size === 0 || input.video.blob.size > 100 * 1024 * 1024 || !['h264','vp8','vp9'].includes(input.video.codec) || input.video.durationSeconds <= 0 || !Number.isFinite(input.video.durationSeconds) || !Number.isFinite(input.maxDurationSeconds) || input.maxDurationSeconds <= 0 || input.video.durationSeconds > input.maxDurationSeconds || !['image/png','image/jpeg','image/webp'].includes(input.referenceImage.type) || input.referenceImage.size === 0 || input.referenceImage.size > 10 * 1024 * 1024 || input.prompt.length > 2000 || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4294967295) throw new ProviderError('invalid_input');
    const form = new FormData();
    form.set('data', input.video.blob, input.video.blob.type === 'video/mp4' ? 'person.mp4' : 'person.webm');
    form.set('reference_image', input.referenceImage, input.referenceImage.type === 'image/png' ? 'outfit.png' : input.referenceImage.type === 'image/webp' ? 'outfit.webp' : 'outfit.jpg');
    form.set('prompt', input.prompt); form.set('seed', String(input.seed)); form.set('resolution', '720p'); form.set('enhance_prompt', String(input.enhancePrompt));
    const response = await this.http.request('/v1/jobs/lucy-vton-3.6', { method: 'POST', body: form }, { signal });
    let v: Record<string, unknown>; try { v = object(JSON.parse(new TextDecoder().decode(await this.http.readBody(response, 2_000_000, true, signal)))); } catch { throw new ProviderError('unknown_submission'); }
    let jobId: string; try { jobId = providerId(v.job_id); } catch { throw new ProviderError('unknown_submission'); }
    try { await this.options.onAccepted?.({ provider: 'decart', id: jobId, kind: 'job' }); } catch { throw new ProviderError('unknown_submission', undefined, jobId); }
    if (!['pending','processing','completed','failed'].includes(String(v.status))) throw new ProviderError('provider_failed', undefined, jobId);
    return { provider: 'decart', providerId: jobId, status: String(v.status), value: { jobId, status: v.status as DecartJob['status'] }, usage: usage(v.usage) };
  }
  async status(jobId: string, signal?: AbortSignal): Promise<ProviderResult<DecartJob>> {
    const id = providerId(jobId), v = await this.http.json(`/v1/jobs/${id}`, undefined, { signal });
    if (v.job_id && v.job_id !== id || !['pending','processing','completed','failed'].includes(String(v.status))) throw new ProviderError('provider_failed');
    return { provider: 'decart', providerId: id, status: String(v.status), value: { jobId: id, status: v.status as DecartJob['status'] }, usage: usage(v.usage) };
  }
  async content(jobId: string, signal?: AbortSignal): Promise<Blob> {
    const response = await this.http.request(`/v1/jobs/${providerId(jobId)}/content`, {}, { signal });
    const mime = response.headers.get('content-type')?.split(';')[0];
    const length = Number(response.headers.get('content-length'));
    if (!mime || !['video/mp4','video/webm'].includes(mime) || length > 100 * 1024 * 1024) throw new ProviderError('result_unavailable');
    const bytes = await this.http.readBody(response, 100 * 1024 * 1024, false, signal);
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }); if (!blob.size) throw new ProviderError('result_unavailable');
    // App still validates container/codec, persists the asset, and verifies actual playback.
    return blob;
  }
  async createClientToken(input: ClientTokenInput, signal?: AbortSignal): Promise<ClientToken> {
    let origin: URL; try { origin = new URL(input.origin); } catch { throw new ProviderError('invalid_input'); }
    const remaining = Math.floor((input.absoluteEndMs - input.nowMs) / 1000);
    if (!['http:','https:'].includes(origin.protocol) || origin.origin !== input.origin || origin.username || origin.password || remaining < 11 || !Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 60 || !Number.isInteger(input.maxSessionSeconds) || input.maxSessionSeconds < 10 || input.maxSessionSeconds + input.ttlSeconds > remaining) throw new ProviderError('invalid_input');
    const v = await this.http.json('/v1/client/tokens', { expiresIn: Math.min(input.ttlSeconds, remaining), allowedModels: ['lucy-vton-3.6'], allowedOrigins: [input.origin], constraints: { realtime: { maxSessionDuration: input.maxSessionSeconds } } }, { signal });
    const expiresAt = string(v.expiresAt, 100);
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= input.nowMs || Date.parse(expiresAt) + input.maxSessionSeconds * 1000 > input.absoluteEndMs) throw new ProviderError('provider_failed');
    return { apiKey: string(v.apiKey, 20_000), expiresAt, absoluteEndMs: input.absoluteEndMs };
  }
}
