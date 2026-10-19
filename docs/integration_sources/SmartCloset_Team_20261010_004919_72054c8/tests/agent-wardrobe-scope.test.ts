import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProposal, ProviderError, type AgentInput, type AgentGarmentScope } from '../server/providers';
import { AiService, type AiRequest } from '../server/ai';
import type { DatabaseRepository } from '../server/repository';
import type { ServerConfig } from '../server/config';
import { AppError } from '../server/errors';

const TOP = '11111111-1111-4111-8111-111111111111';
const BOTTOM = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const FOREIGN_OWNER = '55555555-5555-4555-8555-555555555555';
const confirmation = (garmentId: string, category: AgentGarmentScope['category']): AgentGarmentScope => ({ garmentId, category, availability: 'available', availabilitySource: 'user_confirmation', availabilityEvidenceId: 'availability-confirmation' });
const scope = (): AgentInput => ({ task: 'outfit', context: {}, allowedGarmentIds: [TOP, BOTTOM], allowedEvidenceIds: ['availability-confirmation', 'care-label'], garmentScope: [confirmation(TOP, 'top'), confirmation(BOTTOM, 'bottom')], lockedTopId: TOP });
const proposal = () => ({ kind: 'proposal', items: [{ slot: 'top', garment_id: TOP }, { slot: 'bottom', garment_id: BOTTOM }], explanation: 'Fixture review proposal', evidence_ids: [], unknown_fields: [] });
const rejected = (error: unknown) => error instanceof ProviderError && error.code === 'provider_failed';
function needsInformation(input: AgentInput, field: string) {
  const result = parseProposal(proposal(), input);
  assert.equal(result.kind, 'needs_information');
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.evidence_ids, []);
  assert.ok(result.unknown_fields.includes(field));
  assert.notEqual(result.explanation, proposal().explanation);
}

test('Outfit and adapted style accept only category-matched garments with authorized availability confirmation', () => {
  for (const task of ['outfit', 'adapt_style'] as const) {
    assert.deepEqual(parseProposal(proposal(), { ...scope(), task }), proposal());
  }
});

test('Owned-ID scope rejects nonexistent garments, mismatched categories and unknown slots', () => {
  assert.throws(() => parseProposal({ ...proposal(), items: [{ slot: 'top', garment_id: OTHER }] }, scope()), rejected);
  const categoryMismatch = scope();
  categoryMismatch.garmentScope![1].category = 'shoes';
  assert.throws(() => parseProposal(proposal(), categoryMismatch), rejected);
  assert.throws(() => parseProposal({ ...proposal(), items: [{ slot: 'socks', garment_id: BOTTOM }] }, { ...scope(), lockedTopId: undefined }), rejected);
});

test('Duplicate slots, duplicate garments, ambiguous manifest and changed locked top fail closed', () => {
  assert.throws(() => parseProposal({ ...proposal(), items: [{ slot: 'top', garment_id: TOP }, { slot: 'top', garment_id: BOTTOM }] }, scope()), rejected);
  assert.throws(() => parseProposal({ ...proposal(), items: [{ slot: 'top', garment_id: TOP }, { slot: 'bottom', garment_id: TOP }] }, scope()), rejected);
  assert.throws(() => parseProposal(proposal(), { ...scope(), garmentScope: [confirmation(TOP, 'top'), confirmation(TOP, 'top'), confirmation(BOTTOM, 'bottom')] }), rejected);
  assert.throws(() => parseProposal({ ...proposal(), items: [{ slot: 'bottom', garment_id: BOTTOM }] }, scope()), rejected);
});

test('Legacy ID-only and missing-category scopes become empty needs_information results', () => {
  needsInformation({ ...scope(), garmentScope: undefined }, `category:${TOP}`);
  const missing = scope(); missing.garmentScope![1].category = 'unknown';
  needsInformation(missing, `category:${BOTTOM}`);
  needsInformation({ ...scope(), garmentScope: [confirmation(TOP, 'top')] }, `availability:${BOTTOM}`);
});

test('Unknown, laundry and repair garments cannot appear in outfit or adapted-style proposals', () => {
  for (const task of ['outfit', 'adapt_style'] as const) {
    for (const availability of ['unknown', 'laundry', 'repair'] as const) {
      const input = { ...scope(), task };
      input.garmentScope![1].availability = availability;
      needsInformation(input, `availability:${BOTTOM}`);
    }
  }
});

test('Available claims require server-authorized current user-confirmation evidence', () => {
  const noSource = scope(); delete noSource.garmentScope![0].availabilitySource;
  needsInformation(noSource, `availability_evidence:${TOP}`);
  const noEvidence = scope(); delete noEvidence.garmentScope![0].availabilityEvidenceId;
  needsInformation(noEvidence, `availability_evidence:${TOP}`);
  const forged = scope(); forged.garmentScope![0].availabilityEvidenceId = 'forged';
  needsInformation(forged, `availability_evidence:${TOP}`);
  const blank = scope(); blank.garmentScope![0].availabilityEvidenceId = ' ';
  needsInformation(blank, `availability_evidence:${TOP}`);
});

test('Missing information and unsupported results cannot carry selections; empty proposals require information', () => {
  for (const kind of ['needs_information', 'unsupported']) {
    assert.throws(() => parseProposal({ ...proposal(), kind }, scope()), rejected);
    const empty = { ...proposal(), kind, items: [], unknown_fields: ['availability'] };
    assert.deepEqual(parseProposal(empty, scope()), empty);
  }
  const empty = parseProposal({ ...proposal(), items: [] }, { ...scope(), lockedTopId: undefined });
  assert.equal(empty.kind, 'needs_information'); assert.deepEqual(empty.items, []); assert.ok(empty.unknown_fields.includes('items'));
});

test('Care contract retains required authorized evidence without imposing outfit availability', () => {
  const care: AgentInput = { ...scope(), task: 'care', garmentScope: undefined };
  assert.throws(() => parseProposal(proposal(), care), rejected);
  assert.throws(() => parseProposal({ ...proposal(), evidence_ids: ['forged'] }, care), rejected);
  const allowed = { ...proposal(), evidence_ids: ['care-label'] };
  assert.deepEqual(parseProposal(allowed, care), allowed);
});

const config: ServerConfig = { origin: 'http://127.0.0.1:4311', port: 4312, supabaseUrl: 'https://fixture.invalid', publishableKey: 'fixture-public', serverKey: 'fixture-server', openaiKey: 'fixture-openai', decartKey: '', liveEnabled: true, aiMode: 'live' };
function repositoryFixture() {
  const garments = [
    { id: TOP, ownerId: OWNER, category: 'top', name: 'Fixture top', color: 'blue', material: '', availability: 'available', location: 'ready to wear' },
    { id: BOTTOM, ownerId: OWNER, category: 'bottom', name: 'Fixture bottom', color: 'black', material: '', availability: 'laundry' },
    { id: OTHER, ownerId: FOREIGN_OWNER, category: 'shoes', name: 'Foreign item', color: '', material: '' },
  ].map(g=>({...g,features:[],revision:1,asset:null,size:'',careNotes:'',provenance:{care:'unconfirmed',size:'unconfirmed',location:'unconfirmed'}}));
  let reads = 0;
  const repository = {
    user: { id: OWNER, token: 'fixture-token' },
    state: async () => ({ garments, events: [{ id:'care-fixture', ownerId: OWNER, garmentId: TOP, kind: 'care', date: '2026-10-09', value: 'clean and available' }], careEvidence:[{id:OTHER,ownerId:OWNER,garmentId:TOP,kind:'official_guidance',originalText:'Fixture care source only',sourceRef:'fixture-source',observedAt:'2026-10-08T12:00:00+09:00',asset:null}] }),
    garment: async (id: string) => ({ id, owner_id: OWNER, category: 'top', name: 'Fixture top', attributes_json: { availability: 'available' }, location_json: {} }),
    db: { rows: async (_user: unknown, table: string) => { reads++; assert.equal(table, 'sc_evidence_items'); return [{ id: 'care-label', garment_id: TOP }, { id: 'foreign-evidence', garment_id: OTHER }]; } },
  } as unknown as DatabaseRepository;
  return { repository, reads: () => reads };
}

test('Server builds owner-scoped categories but keeps availability unknown regardless of conditions, location or care events', async () => {
  const { repository } = repositoryFixture();
  const service = new AiService(config, repository, async () => { throw Error('No provider calls allowed'); });
  const request: AiRequest = { action: 'generateOutfits', intentKey: 'fixture', conditions: { availability: 'available', availabilityEvidenceId: 'care-label' } };
  const input = await (service as unknown as { agentScope(request: AiRequest): Promise<AgentInput> }).agentScope(request);
  assert.deepEqual(input.allowedGarmentIds, [TOP, BOTTOM]);
  // Unreviewed official text remains stored but cannot ground a care answer.
  assert.deepEqual(input.allowedEvidenceIds, []);
  assert.deepEqual(input.garmentScope, [{ garmentId: TOP, category: 'top', availability: 'unknown' }, { garmentId: BOTTOM, category: 'bottom', availability: 'unknown' }]);
  needsInformation(input, `availability:${TOP}`);
});

test('Read tools report unknown availability and preserve owner/read scope', async () => {
  const { repository } = repositoryFixture();
  const service = new AiService(config, repository, async () => { throw Error('No provider calls allowed'); });
  const tools = await service.readTools({ action: 'generateOutfits', intentKey: 'fixture' }, scope());
  const listed = await tools.get_wardrobe_items({}) as Array<Record<string, unknown>>;
  assert.deepEqual(listed.map(item => item.id), [TOP, BOTTOM]);
  assert.ok(listed.every(item => item.availability === 'unknown' && item.availability_source === 'unavailable'));
  const garment = await tools.get_garment_context({ garment_id: TOP }) as Record<string, unknown>;
  assert.equal(garment.availability, 'unknown'); assert.equal(garment.availability_source, 'unavailable');
  await assert.rejects(tools.get_garment_context({ garment_id: OTHER }), (error: unknown) => error instanceof AppError && error.code === 'unauthorized_target');
});

test('Runtime recommendation spend gate still blocks before provider or approval database reads', async () => {
  const { repository, reads } = repositoryFixture(); let calls = 0;
  const service = new AiService(config, repository, async () => { calls++; throw Error('No provider calls allowed'); });
  for (const action of ['generateOutfits', 'adaptStyleToWardrobe'] as const) {
    await assert.rejects(service.execute({ action, intentKey: 'fixture' }), (error: unknown) => error instanceof AppError && error.code === 'approval_required');
  }
  assert.equal(calls, 0); assert.equal(reads(), 0);
});

test('Saved, operation and terminal recovery responses recheck current wardrobe without changing historical results', async () => {
  for (const action of ['generateOutfits', 'adaptStyleToWardrobe'] as const) {
    for (const change of ['deleted', 'recategorized', 'unconfirmed'] as const) {
      const request: AiRequest = { action, intentKey: 'saved-fixture' };
      const historical = { value: proposal(), usage: { totalTokens: 10 } };
      const job = { id: OTHER, operation_id: TOP, owner_id: OWNER, adapter: action, provider: 'openai', session_id: 'fixture_session', status: 'succeeded', application_status: 'applied', mode: 'live', input_snapshot_json: request, config_json: { agentScope: scope() }, result_json: historical };
      const snapshot = structuredClone(job);
      const garments = [
        { id: TOP, ownerId: OWNER, category: 'top', name: 'Current top', color: '', material: '' },
        ...(change === 'deleted' ? [] : [{ id: BOTTOM, ownerId: OWNER, category: change === 'recategorized' ? 'shoes' : 'bottom', name: 'Current item', color: '', material: '' }]),
      ].map(g=>({...g,features:[],revision:1,asset:null,size:'',location:'',careNotes:'',provenance:{care:'unconfirmed',size:'unconfirmed',location:'unconfirmed'}}));
      let providerCalls = 0, writes = 0;
      const repository = {
        user: { id: OWNER, token: 'fixture-token' },
        state: async () => ({ garments, events: [] }),
        db: {
          one: async (_user: unknown, table: string) => { assert.equal(table, 'sc_operations'); return { owner_id: OWNER, processing_status: 'succeeded', apply_status: 'applied' }; },
          rows: async (_user: unknown, table: string) => {
            if (table === 'sc_ai_jobs') return [job];
            assert.equal(table, 'sc_evidence_items'); return [{ id: 'availability-confirmation', garment_id: TOP }];
          },
          control: async () => { writes++; throw Error('Historical result must remain unchanged'); },
        },
      } as unknown as DatabaseRepository;
      const service = new AiService(config, repository, async () => { providerCalls++; throw Error('No provider calls allowed'); });
      const responses = [await service.execute(request, 'saved_result'), await service.operation(TOP), await service.recoverAgent(TOP)];
      for (const response of responses) {
        const current = response as { result: { kind: string; items: unknown[] }; apply_status: string; result_review: unknown };
        assert.equal(current.result.kind, 'needs_information');
        assert.deepEqual(current.result.items, []);
        assert.equal(current.apply_status, 'unavailable');
        assert.deepEqual(current.result_review, { scope: 'current_wardrobe', status: 'needs_information', stored_result_unchanged: true });
      }
      assert.equal((responses[1] as { historical_apply_status: unknown }).historical_apply_status, 'applied');
      assert.deepEqual(job, snapshot);
      assert.equal(providerCalls, 0); assert.equal(writes, 0);
    }
  }
});

test('Reading historical care results preserves the care contract and original response', async () => {
  const value = { ...proposal(), evidence_ids: ['care-label'] };
  const repository = {
    user: { id: OWNER, token: 'fixture-token' },
    state: async () => { throw Error('Care result must not use outfit availability review'); },
    db: {
      one: async () => ({ owner_id: OWNER }),
      rows: async () => [{ id: OTHER, owner_id: OWNER, adapter: 'requestCareGuide', status: 'succeeded', application_status: 'not_applied', mode: 'live', result_json: { value } }],
    },
  } as unknown as DatabaseRepository;
  const service = new AiService(config, repository, async () => { throw Error('No provider calls allowed'); });
  const response = await service.operation(TOP);
  assert.deepEqual(response.result, value); assert.equal('result_review' in response, false);
});
