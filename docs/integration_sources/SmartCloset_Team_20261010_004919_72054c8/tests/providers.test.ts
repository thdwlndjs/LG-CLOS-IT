import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentsAdapter, DecartAdapter, DecisionsAdapter, ProviderError, ResponsesAdapter, parseProposal, parseStyleObservation, type AgentInput, type AgentJournal, type ReadHandlers, type SavedToolCall } from '../server/providers';
import { DecartRealtimeController } from '../src/integrations/decartRealtime';
import type { DecartClientOptions, RealTimeClient, RealTimeClientConnectOptions } from '@decartai/sdk';

const image = 'data:image/png;base64,aGVsbG8=';
const analysis = { observations: { name: 'Test knit', category: 'top', color: 'red', material: null }, label_text: null, evidence: [{ field: 'color', observation: 'red fabric' }], unknown_fields: ['material'] };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const options = (fetch: (url: string, init: RequestInit) => Promise<Response>, extra = {}) => ({ apiKey: 'fixture-not-a-real-key', fetch, ...extra });
const input = { assetId: 'asset_fixture', assetVersion: 1, draftRevision: 2, imageDataUrl: image, kind: 'garment' as const, manualFields: ['name'] };
const code = (expected: string) => (e: unknown) => e instanceof ProviderError && e.code === expected;
const scope: AgentInput = { task: 'outfit', context: { condition: 'work' }, allowedGarmentIds: ['g1','g2'], allowedEvidenceIds: ['e1'], garmentScope: [{ garmentId: 'g1', category: 'top', availability: 'available', availabilitySource: 'user_confirmation', availabilityEvidenceId: 'e1' }, { garmentId: 'g2', category: 'bottom', availability: 'available', availabilitySource: 'user_confirmation', availabilityEvidenceId: 'e1' }], lockedTopId: 'g1' };
const proposal = { kind: 'proposal', items: [{ slot: 'top', garment_id: 'g1' }, { slot: 'bottom', garment_id: 'g2' }], explanation: 'Fixture proposal', evidence_ids: ['e1'], unknown_fields: [] };

test('Responses uses real strict schema endpoint, fixed model, manual protection, accepted ID before parsing', async () => {
  let accepted = '';
  const adapter = new ResponsesAdapter(options(async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-not-a-real-key');
    const body = JSON.parse(String(init.body)); assert.equal(body.model, 'gpt-6.1-sol'); assert.equal(body.reasoning.effort, 'low'); assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.ok(body.max_output_tokens > 0);
    return response({ id: 'resp_fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }], usage: { input_tokens: 40, output_tokens: 20 } });
  }, { onAccepted: async ({ id }: { id: string }) => { accepted = id; } }));
  const result = await adapter.analyze(input); assert.equal(accepted, 'resp_fixture'); assert.equal(result.value.observations.name, null); assert.equal(result.value.observations.color, 'red'); assert.equal(result.usage?.inputTokens, 40);
});
test('Responses refusal, incomplete, malformed and absent key have separate outcomes', async () => {
  for (const [payload, expected] of [
    [{ id: 'r1', status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }, 'provider_refusal'],
    [{ id: 'r2', status: 'incomplete' }, 'provider_incomplete'],
    [{ id: 'r3', status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }] }, 'provider_failed'],
  ] as const) await assert.rejects(new ResponsesAdapter(options(async () => response(payload))).analyze(input), code(expected));
  let called = 0; await assert.rejects(new ResponsesAdapter({ apiKey: '', fetch: async () => { called++; return response({}); } }).analyze(input), code('configuration_required')); assert.equal(called, 0);
});
test('Style reference uses separate strict Sol observations and rejects invented ownership/unsupported slots', async () => {
  const style={kind:'style_observation',colors:['cream','charcoal'],silhouettes:['wide-leg'],layers:['coat over shirt'],style_keywords:['smart casual'],observed_items:[{slot:'outer',description:'short beige coat'}],unknown_fields:['material']};
  const adapter=new ResponsesAdapter(options(async(url,init)=>{
    assert.ok(url.endsWith('/v1/responses'));const body=JSON.parse(String(init.body));assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.reasoning.effort,'low');assert.equal(body.text.format.name,'style_observation_v1');assert.equal(body.text.format.strict,true);assert.equal(body.max_output_tokens,1800);assert.equal(body.store,false);
    return response({id:'resp_style',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(style)}]}]});
  }));
  assert.deepEqual((await adapter.analyzeStyleReference({assetId:'fixture',assetVersion:1,imageDataUrl:image})).value,style);
  assert.throws(()=>parseStyleObservation({...style,owner_id:'invented'}),code('provider_failed'));
  assert.throws(()=>parseStyleObservation({...style,observed_items:[{slot:'shirt',description:'bad category'}]}),code('provider_failed'));
  assert.throws(()=>parseStyleObservation({...style,colors:Array(21).fill('red')}),code('provider_failed'));
});
test('Provider HTTP failures map safely and submissions never retry on timeout or 5xx', async () => {
  for (const [status, expected] of [[401,'provider_authentication'],[403,'provider_forbidden'],[429,'provider_rate_limit'],[503,'unknown_submission']] as const) {
    let called = 0; await assert.rejects(new ResponsesAdapter(options(async () => { called++; return response({}, status); })).analyze(input), code(expected)); assert.equal(called, 1);
  }
  let count = 0;
  const adapter = new ResponsesAdapter(options(async (_url, init) => { count++; return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('network')), { once: true })); }, { timeoutMs: 10 }));
  await assert.rejects(adapter.analyze(input), code('unknown_submission')); assert.equal(count, 1);
});
test('Decisions sends inline image questions and parses predicate/choice/score without free text routing', async () => {
  const adapter = new DecisionsAdapter(options(async (url, init) => { assert.equal(url, 'https://api.openai.com/v1/decisions'); const body = JSON.parse(String(init.body)); assert.equal(body.model, 'gpt-6-luna'); assert.deepEqual(body.questions.map((q: { type: string }) => q.type), ['predicate','choice','score']); assert.equal(body.input[0].content[1].image_url, image); return response({ id: 'decision_fixture', answers: [{ name: 'visible_garment', type: 'predicate', probability: 0.9 }, { name: 'target_count', type: 'choice', choice: 'one', confidence: 0.9 }, { name: 'visibility', type: 'score', score: 1.9, confidence: 0.9 }] }); }));
  assert.equal((await adapter.evaluatePhoto(image)).value.analyzable, true);
  await assert.rejects(adapter.evaluatePhoto('https://example.invalid/image.png'), code('invalid_input'));
});
test('Decisions refusal and uncertain photo retain manual review', async () => {
  const adapter = new DecisionsAdapter(options(async () => response({ answers: [{ name: 'visible_garment', type: 'refusal' }, { name: 'target_count', type: 'choice', choice: 'many' }, { name: 'visibility', type: 'score', score: 0.4 }] })));
  const result = await adapter.evaluatePhoto(image); assert.equal(result.status, 'refused'); assert.equal(result.value.needsManualReview, true); assert.equal(result.value.analyzable, false);
});
test('Decisions retains optional accepted ID before malformed answers and preserves missing-ID support', async () => {
  const accepted: Array<{id:string;kind:string}> = [];
  const adapter = new DecisionsAdapter(options(async () => response({ id: 'decision_malformed', answers: [] }), { onAccepted: async (a:{id:string;kind:string}) => { accepted.push(a); } }));
  await assert.rejects(adapter.evaluatePhoto(image), code('provider_failed'));
  assert.equal(accepted[0].id, 'decision_malformed'); assert.equal(accepted[0].kind, 'response');
  await assert.rejects(new DecisionsAdapter(options(async () => response({ answers: [] }), { onAccepted: async () => { throw Error('must not be called without optional ID'); } })).evaluatePhoto(image), code('provider_failed'));
  await assert.rejects(new DecisionsAdapter(options(async () => response({ id: 'decision_lost_ack', answers: [] }), { onAccepted: async () => { throw Error('database acknowledgment lost'); } })).evaluatePhoto(image), code('unknown_submission'));
});
test('Agents uses sessions API with none environment, fixed safety toggles and only read functions', async () => {
  const adapter = new AgentsAdapter(options(async (url, init) => { assert.equal(url, 'https://api.openai.com/v1/agents/sessions'); const body = JSON.parse(String(init.body)); assert.equal(new Headers(init.headers).get('OpenAI-Beta'), 'agents=v1'); assert.equal(body.agent.model, 'gpt-6-astra'); assert.equal(body.agent.reasoning.effort, 'medium'); assert.equal(body.environment.type, 'none'); assert.equal(body.agent.multi_agent.enabled, false); assert.equal(body.agent.tools.find((t: { type: string }) => t.type === 'programmatic_tool_calling').enabled, false); assert.equal(body.agent.tools.filter((t: { type: string }) => t.type === 'function').length, 5); return response({ id: 'session_fixture', status: 'idle', required_actions: [] }); }));
  assert.equal((await adapter.start(scope)).status, 'idle');
});
test('Agents duplicate required action reuses journal output and exact event idempotency key', async () => {
  const submitted: Array<{ key: string | null; body: unknown }> = []; let executions = 0;
  const adapter = new AgentsAdapter(options(async (url, init) => { assert.match(url, /sessions\/s1\/events$/); submitted.push({ key: new Headers(init.headers).get('Idempotency-Key'), body: JSON.parse(String(init.body)) }); return new Response(null, { status: 202 }); }));
  const calls = new Map<string, SavedToolCall>(); const journal: AgentJournal = { getCall: async key => calls.get(key) ?? null, saveCall: async (key, value) => { calls.set(key, value); }, consumeCallAllowance: async () => true };
  const handlers = Object.fromEntries(['get_wardrobe_items','get_garment_context','get_care_evidence','get_outing_context','get_style_reference'].map(name => [name, async () => { executions++; return { available: false }; }])) as unknown as ReadHandlers;
  const current = { id: 's1', status: 'requires_action' as const, requiredActions: [{ type: 'function_call', turn_id: 't1', call_id: 'c1', name: 'get_wardrobe_items', arguments: {} }] };
  await adapter.handleRequiredActions(current, handlers, journal); await adapter.handleRequiredActions(current, handlers, journal);
  assert.equal(executions, 1); assert.deepEqual(submitted[0], submitted[1]); assert.equal((submitted[0].body as any).events[0].type, 'agent.session.input.tool_result');
  current.requiredActions[0].arguments = { owner_id: 'victim' };
  await assert.rejects(adapter.handleRequiredActions(current, handlers, journal), code('provider_failed'));
});
test('Agents denies owner arguments/unsupported tools, does not execute historical calls, enforces call allowance', async () => {
  let executions = 0, sent: any;
  const adapter = new AgentsAdapter(options(async (_url, init) => { sent = JSON.parse(String(init.body)); return new Response(null, { status: 202 }); }));
  const journal: AgentJournal = { getCall: async () => null, saveCall: async () => {}, consumeCallAllowance: async () => true };
  const handlers = { get_wardrobe_items: async () => { executions++; return {}; } } as unknown as ReadHandlers;
  const current = { id: 's1', status: 'requires_action' as const, requiredActions: [{ type: 'function_call', turn_id: 't1', call_id: 'c1', name: 'get_wardrobe_items', arguments: { owner_id: 'victim' } }] };
  await adapter.handleRequiredActions(current, handlers, journal); assert.equal(executions, 0); assert.equal(sent.events[0].success, false);
  await adapter.handleRequiredActions({ ...current, status: 'idle' }, handlers, journal); assert.equal(executions, 0);
  await assert.rejects(adapter.handleRequiredActions(current, handlers, { ...journal, consumeCallAllowance: async () => false }), code('unsupported_action'));
});
test('Agents recovery checks actual turn, filters/paginates saved items, validates locked top and evidence', async () => {
  const paths: string[] = [];
  const adapter = new AgentsAdapter(options(async url => { paths.push(url); if (url.includes('/turns')) return response({ data: [{ id: 't1', status: 'completed', subagent_id: null, usage: { total_tokens: 100 } }], has_more: false }); if (url.includes('/items')) return response({ data: [{ id: 'i1', type: 'message', role: 'assistant', turn_id: 't1', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }], has_more: false }); return response({ id: 's1', status: 'idle', required_actions: [] }); }));
  const result = await adapter.recover('s1', scope, 't1'); assert.equal(result.processingStatus, 'completed'); assert.equal(result.result?.items[0].garment_id, 'g1'); assert.ok(paths.some(p => p.includes('turn_id=t1')));
  assert.throws(() => parseProposal({ ...proposal, items: [{ slot: 'top', garment_id: 'g2' }] }, scope), code('provider_failed'));
  assert.throws(() => parseProposal({ ...proposal, evidence_ids: ['forged'] }, scope), code('provider_failed'));
});
test('Agents idle/202 never imply completion and cancel requires later terminal confirmation', async () => {
  const adapter = new AgentsAdapter(options(async (url, init) => init.method === 'POST' ? new Response(null, { status: 202 }) : url.includes('/turns') ? response({ data: [{ id: 't1', status: 'in_progress' }], has_more: false }) : response({ id: 's1', status: 'idle', required_actions: [] })));
  assert.equal((await adapter.recover('s1', scope)).processingStatus, 'running');
  assert.deepEqual(await adapter.cancel('s1', 'cancel_operation1'), { cancellationRequested: true, terminalConfirmed: false });
});
test('Agents SSE duplicate events are ignored and truncated stream requires durable recovery', async () => {
  const event = { event_id: 'ev1', type: 'agent.session.idle', session: { id: 's1', status: 'idle' } };
  let handled = 0;
  const adapter = new AgentsAdapter(options(async (_url, init) => { assert.equal(new Headers(init.headers).get('accept'), 'text/event-stream'); return new Response(`data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }); }));
  const result = await adapter.streamEvents('s1', async () => { handled++; }, new Set()); assert.equal(handled, 1); assert.equal(result.terminal, false); assert.equal(result.recoveryRequired, true);
});
test('Response body stalls retain unknown submission and do not retry', async () => {
  let calls = 0;
  const adapter = new ResponsesAdapter(options(async () => { calls++; return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }); }, { timeoutMs: 10 }));
  await assert.rejects(adapter.analyze(input), code('unknown_submission')); assert.equal(calls, 1);
});
const batch = () => ({ video: { blob: new Blob(['fixture-video'], { type: 'video/mp4' }), filename: 'input.mp4', durationSeconds: 2, codec: 'h264' as const, inspected: true as const }, referenceImage: new Blob(['fixture-image'], { type: 'image/png' }), prompt: 'Wear the reference outfit', seed: 1, enhancePrompt: false, maxDurationSeconds: 3 });
test('Decart batch multipart fixed3.6/720p, ID persistence, separate GET status/content', async () => {
  const paths: string[] = [], accepted: string[] = [];
  const adapter = new DecartAdapter(options(async (url, init) => { paths.push(url); assert.equal(new Headers(init.headers).get('x-api-key'), 'fixture-not-a-real-key'); if (init.method === 'POST') { assert.match(url, /lucy-vton-3.6$/); const form = init.body as FormData; assert.equal(form.get('resolution'), '720p'); assert.equal(form.get('enhance_prompt'), 'false'); assert.equal(form.has('fast'), false); assert.equal((form.get('data') as Blob).type, 'video/mp4'); return response({ job_id: 'job_fixture', status: 'pending' }); } if (url.endsWith('/content')) return new Response(new Blob(['movie'], { type: 'video/mp4' })); return response({ job_id: 'job_fixture', status: 'completed' }); }, { onAccepted: async ({ id }: { id: string }) => { accepted.push(id); } }));
  assert.equal((await adapter.submit(batch())).status, 'pending'); assert.deepEqual(accepted, ['job_fixture']); assert.equal((await adapter.status('job_fixture')).status, 'completed'); assert.equal((await adapter.content('job_fixture')).type, 'video/mp4'); assert.equal(paths.length, 3);
});
test('Decart rejects still-photo input, invalid bounds and result MIME; submit loss is unknown', async () => {
  let calls = 0; const adapter = new DecartAdapter(options(async () => { calls++; throw new Error('lost'); }));
  await assert.rejects(adapter.submit({ ...batch(), video: { ...batch().video, blob: new Blob(['image'], { type: 'image/png' }) } }), code('invalid_input')); assert.equal(calls, 0);
  await assert.rejects(adapter.submit(batch()), code('unknown_submission')); assert.equal(calls, 1);
  await assert.rejects(new DecartAdapter(options(async () => new Response('bad', { headers: { 'Content-Type': 'text/html' } }))).content('job_fixture'), code('result_unavailable'));
});
test('Decart token uses bounded model/origin/absolute time and does not mint after stop deadline', async () => {
  let calls = 0; const now = Date.parse('2026-10-08T00:00:00Z');
  const adapter = new DecartAdapter(options(async (url, init) => { calls++; assert.equal(url, 'https://api.decart.ai/v1/client/tokens'); const body = JSON.parse(String(init.body)); assert.deepEqual(body.allowedModels, ['lucy-vton-3.6']); assert.deepEqual(body.allowedOrigins, ['http://localhost:4311']); assert.equal(body.constraints.realtime.maxSessionDuration, 15); return response({ apiKey: 'fixture-ephemeral', expiresAt: new Date(now + 5_000).toISOString() }); }));
  const tokenInput = { origin: 'http://localhost:4311', absoluteEndMs: now + 20_000, nowMs: now, ttlSeconds: 5, maxSessionSeconds: 15 };
  assert.equal((await adapter.createClientToken(tokenInput)).absoluteEndMs, now + 20_000);
  await assert.rejects(adapter.createClientToken({ ...tokenInput, nowMs: now + 15_000 }), code('invalid_input'));
  await assert.rejects(adapter.createClientToken({ ...tokenInput, origin: 'https://evil.invalid/' }), code('invalid_input')); assert.equal(calls, 1);
});

function streamFixture() {
  let stopped = 0; const listeners = new Set<EventListenerOrEventListenerObject>();
  const track = { stop: () => { stopped++; }, addEventListener: (_: string, callback: EventListenerOrEventListenerObject) => listeners.add(callback), removeEventListener: (_: string, callback: EventListenerOrEventListenerObject) => listeners.delete(callback) };
  return { stream: { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] } as unknown as MediaStream, stopped: () => stopped, listeners };
}
function clientFixture() {
  let disconnected = 0; const sets: unknown[] = [], listeners = new Set<unknown>();
  const client = { sessionId: 'fixture-session', disconnect: () => { disconnected++; }, set: async (value: unknown) => { sets.push(value); }, on: (_: unknown, cb: unknown) => listeners.add(cb), off: (_: unknown, cb: unknown) => listeners.delete(cb) } as unknown as RealTimeClient;
  return { client, disconnected: () => disconnected, sets, listeners };
}
test('Realtime invokes actual SDK contract with full look updates and cleans tracks/listeners/token access', async () => {
  const source = streamFixture(), remote = streamFixture(), connection = clientFixture(); let sdkOptions!: DecartClientOptions, connectOptions!: RealTimeClientConnectOptions, tokens = 0, stopped = 0;
  const now = Date.now();
  const controller = new DecartRealtimeController(opts => { sdkOptions = opts; return { realtime: { connect: async (_stream, args) => { connectOptions = args; await opts.apiKeyProvider!(); args.onRemoteStream(remote.stream); return connection.client; } } }; });
  const look = { revision: 1, prompt: 'fixture', image: new Blob(['image']), enhance: false };
  const result = await controller.start({ operationId: 'op_fixture', absoluteEndMs: now + 30_000, maxReconnects: 0, inputStream: source.stream, look, requestToken: async () => { tokens++; return { apiKey: 'fixture-token', expiresAt: new Date(now + 20_000).toISOString(), absoluteEndMs: now + 30_000 }; }, onRemoteStream: () => {}, onState: () => {}, onStopped: async () => { stopped++; } });
  assert.equal(result.connected, true); assert.equal(sdkOptions.telemetry, false); assert.equal(connectOptions.model.name, 'lucy-vton-3.6'); assert.equal(connectOptions.resolution, '720p'); assert.equal(connectOptions.speed, undefined); assert.equal(connectOptions.retries, 0);
  await controller.applyLook({ ...look, revision: 2, prompt: 'changed' }); assert.deepEqual(Object.keys(connection.sets[0] as object).sort(), ['enhance','image','prompt']); assert.equal(await controller.applyLook(look), false);
  await controller.stop(); await assert.rejects(async () => sdkOptions.apiKeyProvider!()); assert.equal(tokens, 1); assert.equal(stopped, 1); assert.equal(source.stopped(), 1); assert.equal(remote.stopped(), 1); assert.equal(connection.disconnected(), 1); assert.equal(connection.listeners.size, 0); assert.equal(source.listeners.size, 0);
});
test('Realtime late connect after stop immediately disconnects; later remote streams are stopped', async () => {
  const source = streamFixture(), remote = streamFixture(), connection = clientFixture(); let resolve!: (client: RealTimeClient) => void, args!: RealTimeClientConnectOptions;
  const controller = new DecartRealtimeController(() => ({ realtime: { connect: async (_stream, options) => { args = options; return new Promise(done => { resolve = done; }); } } }));
  const pending = controller.start({ operationId: 'op_fixture', absoluteEndMs: Date.now() + 30_000, maxReconnects: 0, inputStream: source.stream, look: { revision: 1, prompt: 'fixture', image: new Blob(['image']), enhance: false }, requestToken: async () => { throw new Error('must not call'); }, onRemoteStream: () => {}, onState: () => {}, onStopped: async () => {} });
  await controller.stop(); args.onRemoteStream(remote.stream); resolve(connection.client); assert.equal((await pending).connected, false); assert.equal(connection.disconnected(), 1); assert.equal(remote.stopped(), 1); assert.equal(source.stopped(), 1);
});
test('Realtime reconnect token allowance retains original deadline, and absolute timeout tears down', async () => {
  const source = streamFixture(), connection = clientFixture(); let sdkOptions!: DecartClientOptions, tokens = 0, stopped = 0;
  const end = Date.now() + 40;
  const controller = new DecartRealtimeController(opts => { sdkOptions = opts; return { realtime: { connect: async () => { await opts.apiKeyProvider!(); return connection.client; } } }; });
  await controller.start({ operationId: 'op_fixture', absoluteEndMs: end, maxReconnects: 1, inputStream: source.stream, look: { revision: 1, prompt: 'fixture', image: new Blob(['image']), enhance: false }, requestToken: async () => { tokens++; return { apiKey: 'fixture-token', expiresAt: new Date(Date.now() + 1000).toISOString(), absoluteEndMs: end }; }, onRemoteStream: () => {}, onState: () => {}, onStopped: async () => { stopped++; } });
  await sdkOptions.apiKeyProvider!(); await assert.rejects(async () => sdkOptions.apiKeyProvider!()); assert.equal(tokens, 2);
  await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(stopped, 1); assert.equal(connection.disconnected(), 1); assert.equal(source.stopped(), 1);
});
