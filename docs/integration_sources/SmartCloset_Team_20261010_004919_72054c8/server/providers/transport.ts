/** Provider-only transport. The application supplies a budget/consent gated fetch.
 * No module reads environment variables, retries a submission, or logs payloads. */
export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;
export type ProviderErrorCode = 'invalid_input' | 'configuration_required' | 'provider_authentication' | 'provider_forbidden' | 'provider_rate_limit' | 'provider_refusal' | 'provider_incomplete' | 'provider_failed' | 'unknown_submission' | 'result_unavailable' | 'cancelled' | 'unsupported_action';
export class ProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, public readonly status?: number, public readonly providerId?: string) { super(code); this.name = 'ProviderError'; }
}
export interface ProviderUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; generatedSeconds?: number }
export interface ProviderResult<T> { provider: 'openai' | 'decart'; providerId: string | null; status: string; value: T; usage: ProviderUsage | null }
export interface ProviderOptions { fetch: ProviderFetch; apiKey: string; timeoutMs?: number; onAccepted?: (accepted: { provider: 'openai' | 'decart'; id: string; kind: 'response' | 'session' | 'job' }) => Promise<void> }
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError('provider_failed');
  return value as Record<string, unknown>;
};
export const string = (value: unknown, max = 4096): string => {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new ProviderError('provider_failed');
  return value;
};
export const providerId = (value: unknown) => { const id = string(value, 200); if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ProviderError('provider_failed'); return id; };
export const usage = (value: unknown): ProviderUsage | null => {
  if (!value || typeof value !== 'object') return null;
  const v = object(value), result: ProviderUsage = {};
  for (const [wire, local] of [['input_tokens','inputTokens'],['output_tokens','outputTokens'],['total_tokens','totalTokens'],['generated_seconds','generatedSeconds']] as const) {
    if (typeof v[wire] === 'number' && Number.isFinite(v[wire]) && v[wire] >= 0) result[local] = v[wire];
  }
  return Object.keys(result).length ? result : null;
};
export function requireDataImage(url: string) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || url.length > 14_000_000) throw new ProviderError('invalid_input');
}
export class ProviderHttp {
  constructor(private readonly options: ProviderOptions, private readonly provider: 'openai' | 'decart') {}
  async request(path: string, init: RequestInit = {}, context: { signal?: AbortSignal; idempotent?: boolean; agents?: boolean } = {}): Promise<Response> {
    if (!this.options.apiKey) throw new ProviderError('configuration_required');
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('://')) throw new ProviderError('invalid_input');
    if (context.signal?.aborted) throw new ProviderError('cancelled');
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, this.options.timeoutMs ?? 30_000);
    const method = init.method ?? 'GET';
    const mayHaveSubmitted = method !== 'GET' && !context.idempotent;
    try {
      const headers = new Headers(init.headers);
      headers.set(this.provider === 'openai' ? 'Authorization' : 'x-api-key', this.provider === 'openai' ? `Bearer ${this.options.apiKey}` : this.options.apiKey);
      if (context.agents) headers.set('OpenAI-Beta', 'agents=v1');
      const response = await this.options.fetch(`https://api.${this.provider === 'openai' ? 'openai.com' : 'decart.ai'}${path}`, { ...init, method, headers, signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        const codes: Record<number, ProviderErrorCode> = { 401: 'provider_authentication', 403: 'provider_forbidden', 429: 'provider_rate_limit', 404: 'result_unavailable' };
        throw new ProviderError(codes[response.status] ?? (mayHaveSubmitted && response.status >= 500 ? 'unknown_submission' : 'provider_failed'), response.status);
      }
      return response;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(mayHaveSubmitted ? 'unknown_submission' : context.signal?.aborted ? 'cancelled' : 'provider_failed');
    } finally { clearTimeout(timeout); context.signal?.removeEventListener('abort', abort); }
  }
  async readBody(response: Response, maxBytes = 2_000_000, submitted = false, signal?: AbortSignal): Promise<Uint8Array> {
    const reader = response.body?.getReader(); if (!reader) return new Uint8Array();
    let timeout: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      const reading = (async () => { const chunks: Uint8Array[] = []; let size = 0;
        while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) throw new ProviderError(submitted ? 'unknown_submission' : 'provider_failed'); chunks.push(value); }
        const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; } return all;
      })();
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new ProviderError(submitted ? 'unknown_submission' : signal?.aborted ? 'cancelled' : 'provider_failed'));
        timeout = setTimeout(abort, this.options.timeoutMs ?? 30_000); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      });
      return await Promise.race([reading, interrupted]);
    } finally { clearTimeout(timeout); if (abort) signal?.removeEventListener('abort', abort); void reader.cancel().catch(() => undefined); }
  }
  async json(path: string, body?: unknown, context: { signal?: AbortSignal; idempotent?: boolean; agents?: boolean; idempotencyKey?: string } = {}): Promise<Record<string, unknown>> {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (context.idempotencyKey) headers.set('Idempotency-Key', context.idempotencyKey);
    const response = await this.request(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }, context);
    let value: Record<string, unknown>;
    try {
      const text = new TextDecoder().decode(await this.readBody(response, 2_000_000, body !== undefined && !context.idempotent, context.signal));
      value = !text && [202,204].includes(response.status) ? { accepted: true } : object(JSON.parse(text));
    } catch { throw new ProviderError(body !== undefined && !context.idempotent ? 'unknown_submission' : 'provider_failed'); }
    if (body !== undefined && this.options.onAccepted && ['/v1/responses','/v1/decisions','/v1/agents/sessions'].includes(path) && (path !== '/v1/decisions' || value.id != null)) {
      let id: string; try { id = providerId(value.id); } catch { throw new ProviderError('unknown_submission'); }
      try { await this.options.onAccepted({ provider: this.provider, id, kind: path === '/v1/agents/sessions' ? 'session' : 'response' }); }
      catch { throw new ProviderError('unknown_submission', undefined, id); }
    }
    return value;
  }
}
