import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoApp } from '../src/core/app';
import { createSeed, emptyUI } from '../src/core/seed';
import { PreparedMockRunner } from '../src/core/mock';
import { garmentWearSummary, isWearSnapshotDraft, wearSnapshotDraft } from '../src/core/wearScenario';
import type { DemoEvent, DemoState, Garment, Outfit, OutfitDraft, Receipt, SaveResult, StorageLike } from '../src/core/types';
import type { RemoteBackend } from '../src/integrations/backendClient';

const day = '2026-10-09', fast = { delayMs: 0 };
const copy = <T>(value: T): T => structuredClone(value);
class Storage implements StorageLike {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw Error('quota exceeded'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
function local(seed?: () => DemoState, runner?: PreparedMockRunner) { const storage = new Storage(); return { app: new DemoApp(storage, seed, runner), storage }; }
function result<T extends Outfit | DemoEvent>(entity: T, draft?: OutfitDraft, replayed = false): SaveResult<T> {
  const receipt: Receipt = { id: 'receipt-' + entity.id, ownerId: entity.ownerId, operation: 'kind' in entity ? entity.kind : 'saveOutfit', entityId: entity.id,
    draftId: draft?.draftId ?? 'event', revision: draft?.revision ?? 1, fingerprint: 'fixture', createdAt: new Date().toISOString(), result: copy(entity) };
  return { entity: copy(entity), receipt, replayed };
}
function remoteFixture() {
  const state = createSeed(), { app, storage } = local();
  const saves = new Map<string, SaveResult<Outfit>>(), events = new Map<string, SaveResult<DemoEvent>>();
  let saveCalls = 0, eventCalls = 0;
  const remote: RemoteBackend = {
    mode: 'mock', state: async () => copy(state), putDraft: async () => {}, discardDraft: async () => {},
    saveGarment: async () => { throw Error('unused'); },
    saveOutfit: async (draft, key) => {
      saveCalls++;
      if (saves.has(key)) return { ...copy(saves.get(key)!), replayed: true };
      const entity: Outfit = { id: `saved-${saves.size}`, ownerId: draft.ownerId, items: copy(draft.items), name: draft.name, revision: draft.revision,
        assetVersions: Object.fromEntries(Object.values(draft.items).map(id => [id, 1])) };
      const saved = result(entity, draft); saves.set(key, saved); state.outfits.push(copy(entity)); state.receipts.push(copy(saved.receipt)); return copy(saved);
    },
    recordEvent: async (kind, target, value, date, key) => {
      eventCalls++;
      if (events.has(key)) return { ...copy(events.get(key)!), replayed: true };
      const saved = result({ id: `event-${events.size}`, ownerId: state.activeProfileId, kind, outfitId: target, value, date });
      events.set(key, saved); state.events.push(copy(saved.entity)); state.receipts.push(copy(saved.receipt)); return copy(saved);
    },
    analyze: async () => null, recommend: async () => null, care: async () => { throw Error('unused'); }, tryOn: async () => ({}),
  };
  return { app, storage, state, remote, saves, events, calls: () => ({ saveCalls, eventCalls }) };
}

test('one wear click persists the entire changed outfit and leaves navigation, selection and draft unchanged', async () => {
  const { app, storage } = local();
  app.setOutfitItem('bottom', 'g-jeans'); app.setScreen('tryOn'); app.setCalendarDate('2026-11-04'); app.selectOutfit('outfit-prepared');
  const draft = copy(app.outfitDraft()!), ui = copy(app.ui());
  const worn = await app.wearCurrentOutfit(day, fast);
  assert.equal(worn.event.kind, 'wear'); assert.equal(worn.event.date, day); assert.equal(worn.event.outfitId, worn.savedOutfit.id);
  assert.deepEqual(worn.savedOutfit.items, draft.items); assert.deepEqual(worn.garmentIds.sort(), Object.values(draft.items).sort());
  assert.equal(worn.replayed, false); assert.deepEqual(worn.source, { ownerId: draft.ownerId, draftId: draft.draftId, revision: draft.revision });
  assert.deepEqual(app.outfitDraft(), draft); assert.deepEqual(app.ui(), ui);
  app.setOutfitItem('bottom', 'g-slacks'); assert.equal(app.outfit(worn.savedOutfit.id).items.bottom, 'g-jeans');
  const restored = new DemoApp(storage); assert.equal(restored.events()[0].outfitId, worn.savedOutfit.id); assert.equal(restored.outfit(worn.savedOutfit.id).items.bottom, 'g-jeans');
});

test('same request retries replay, while a deliberately confirmed new draft revision is a separate wear intent', async () => {
  const { app, storage } = local();
  const [first, second] = await Promise.all([app.wearCurrentOutfit(day, { delayMs: 10 }), app.wearCurrentOutfit(day, fast)]);
  assert.equal(first.event.id, second.event.id); assert.equal(second.replayed, true); assert.equal(app.events().length, 1); assert.equal(app.outfits().length, 2);
  app.editOutfitName('새 이름만 변경'); app.toggleTopLock();
  const afterEdit=await app.wearCurrentOutfit(day,fast);assert.notEqual(afterEdit.event.id,first.event.id);
  const restored = new DemoApp(storage); assert.equal((await restored.wearCurrentOutfit(day, fast)).event.id,afterEdit.event.id);
  assert.equal(restored.events().length, 2); assert.equal(restored.outfits().length, 3);
  const nextDay = await restored.wearCurrentOutfit('2026-10-10', fast); assert.notEqual(nextDay.event.id, first.event.id);
});

test('a distinct wear action does not merge an existing same-day confirmation by composition alone', async () => {
  const { app } = local(); const saved = await app.saveOutfit('card', fast);
  await app.planOutfit(saved.entity.id, day, 'plan', fast); await app.startTryOn(saved.entity.id, fast);
  assert.equal(garmentWearSummary('g-knit', app.getState().activeProfileId, app.outfits(), app.events()).wearDays, 0);
  const original = await app.recordWear(saved.entity.id, day, 'older-confirmed-flow', fast), before = app.outfits().length;
  const worn = await app.wearCurrentOutfit(day, fast); assert.notEqual(worn.event.id, original.entity.id); assert.equal(worn.replayed, false);
  assert.equal(app.outfits().length, before+1); assert.equal(app.events().length, 3);assert.equal(garmentWearSummary('g-knit',app.getState().activeProfileId,app.outfits(),app.events()).wearDays,1);
});

test('outfit/day keys are valid stable UUIDs and internal snapshots require composition verification', async () => {
  const first = await wearSnapshotDraft('owner', day, { top: 'top', bottom: 'bottom' });
  assert.match(first.draftId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.draftId, (await wearSnapshotDraft('owner', day, { bottom: 'bottom', top: 'top' })).draftId);
  assert.equal(await isWearSnapshotDraft(first), true); assert.equal(await isWearSnapshotDraft({ ...first, draftId: 'normal-user-draft' }), false);
  assert.equal(await isWearSnapshotDraft({ ...first, items: { top: 'changed', bottom: 'bottom' } }), false);
  assert.notEqual(first.draftId, (await wearSnapshotDraft('other', day, first.items)).draftId);
  assert.notEqual(first.draftId, (await wearSnapshotDraft('owner', '2026-10-10', first.items)).draftId);
});

test('save failure and local persistence failure never invent a wear event or damage the draft', async () => {
  const { app, storage } = local(); const draft = copy(app.outfitDraft());
  await assert.rejects(app.wearCurrentOutfit(day, { ...fast, fail: true })); assert.equal(app.events().length, 0); assert.equal(app.outfits().length, 1);
  storage.fail = true; await assert.rejects(app.wearCurrentOutfit(day, fast), /저장|용량/);
  assert.deepEqual(app.outfitDraft(), draft); assert.equal(app.events().length, 0); assert.equal(app.outfits().length, 1);
  storage.fail = false; await app.wearCurrentOutfit(day, fast); assert.equal(app.events().length, 1);
});

test('a failed wear step keeps its saved snapshot, and retry finishes without a duplicate card', async () => {
  class FailWearOnce extends PreparedMockRunner {
    count = 0;
    override async simulate(options = {}) { if (++this.count === 2) throw Error('wear step failed'); return super.simulate(options); }
  }
  const { app } = local(undefined, new FailWearOnce()); const draft = copy(app.outfitDraft());
  await assert.rejects(app.wearCurrentOutfit(day, fast), /wear step failed/);
  assert.equal(app.outfits().length, 2); assert.equal(app.events().length, 0); assert.deepEqual(app.outfitDraft(), draft);
  const retry = await app.wearCurrentOutfit(day, fast); assert.equal(app.outfits().length, 2); assert.equal(app.events().length, 1);
  assert.equal(retry.event.outfitId, retry.savedOutfit.id);
});

test('editing during a save keeps the new draft and stops the old request before wear submission', async () => {
  const fixture = remoteFixture(); await fixture.app.configureRemote(fixture.remote);
  const started = deferred<void>(), pending = deferred<void>(), save = fixture.remote.saveOutfit;
  fixture.remote.saveOutfit = async (...args) => { started.resolve(); await pending.promise; return save(...args); };
  const wear = fixture.app.wearCurrentOutfit(day, fast); await started.promise;
  fixture.app.setOutfitItem('bottom', 'g-jeans'); const current = copy(fixture.app.outfitDraft()); pending.resolve();
  await assert.rejects(wear, /바뀌어/); assert.deepEqual(fixture.app.outfitDraft(), current);
  assert.equal(fixture.calls().eventCalls, 0); assert.equal(fixture.app.events().length, 0);
  const next = await fixture.app.wearCurrentOutfit(day, fast); assert.equal(next.savedOutfit.items.bottom, 'g-jeans');
});

test('lost save response recovers the same saved snapshot before creating one wear event', async () => {
  const fixture = remoteFixture(); await fixture.app.configureRemote(fixture.remote); const save = fixture.remote.saveOutfit;
  let first = true; fixture.remote.saveOutfit = async (...args) => { const saved = await save(...args); if (first) { first = false; throw Error('save response lost'); } return saved; };
  await assert.rejects(fixture.app.wearCurrentOutfit(day, fast), /save response lost/);
  assert.equal(fixture.app.outfits().length, 1); assert.equal(fixture.app.events().length, 0); assert.equal(fixture.calls().eventCalls, 0);
  const recovered = await fixture.app.wearCurrentOutfit(day, fast); assert.equal(fixture.saves.size, 1); assert.equal(fixture.events.size, 1);
  assert.equal(fixture.app.outfit(recovered.savedOutfit.id).id, recovered.event.outfitId);
});

test('lost wear response replays after retry or reconnection without duplicating wear or a snapshot', async () => {
  const fixture = remoteFixture(); await fixture.app.configureRemote(fixture.remote); const record = fixture.remote.recordEvent;
  let first = true; fixture.remote.recordEvent = async (...args) => { const event = await record(...args); if (first) { first = false; throw Error('wear response lost'); } return event; };
  await assert.rejects(fixture.app.wearCurrentOutfit(day, fast), /wear response lost/); assert.equal(fixture.app.events().length, 0);
  const recovered = await fixture.app.wearCurrentOutfit(day, fast); assert.equal(recovered.replayed, true); assert.equal(fixture.app.events().length, 1);
  await fixture.app.configureRemote(fixture.remote); const repeated = await fixture.app.wearCurrentOutfit(day, fast);
  assert.equal(repeated.event.id, recovered.event.id); assert.equal(repeated.replayed, true); assert.equal(fixture.saves.size, 1); assert.equal(fixture.events.size, 1);
});

test('a late event response retains its clicked source and never changes newer selection/navigation', async () => {
  const fixture = remoteFixture(); await fixture.app.configureRemote(fixture.remote);
  const started = deferred<void>(), pending = deferred<void>(), record = fixture.remote.recordEvent;
  fixture.remote.recordEvent = async (...args) => { started.resolve(); await pending.promise; return record(...args); };
  const source = copy(fixture.app.outfitDraft()!), wear = fixture.app.wearCurrentOutfit(day, fast); await started.promise;
  fixture.app.setOutfitItem('bottom', 'g-jeans'); fixture.app.setScreen('care'); const next = copy(fixture.app.outfitDraft()); pending.resolve();
  const result = await wear; assert.equal(result.source.revision, source.revision); assert.equal(result.savedOutfit.items.bottom, source.items.bottom);
  assert.deepEqual(fixture.app.outfitDraft(), next); assert.equal(fixture.app.ui().screen, 'care');
});

test('profile changes, switching away/back and adapter reconnection stop old requests before wear', async () => {
  for (const change of ['profile', 'reconnect'] as const) {
    const fixture = remoteFixture();
    fixture.state.profiles.push({ id: 'other', name: 'other' }); fixture.state.ui.other = emptyUI();
    await fixture.app.configureRemote(fixture.remote); const started = deferred<void>(), pending = deferred<void>(), save = fixture.remote.saveOutfit;
    fixture.remote.saveOutfit = async (...args) => { started.resolve(); await pending.promise; return save(...args); };
    const wear = fixture.app.wearCurrentOutfit(day, fast); await started.promise;
    if (change === 'profile') { const original=fixture.state.activeProfileId;assert.throws(()=>fixture.app.setActiveProfile('other'),/허용/);fixture.state.activeProfileId='other';await fixture.app.configureRemote(fixture.remote);fixture.state.activeProfileId=original;await fixture.app.configureRemote(fixture.remote); }
    else await fixture.app.configureRemote(fixture.remote);
    pending.resolve(); await assert.rejects(wear, /바뀌어/); assert.equal(fixture.calls().eventCalls, 0);
  }
});

test('garment wear days deduplicate dates, reject other owners and expose missing snapshot uncertainty', () => {
  const state = createSeed(), owner = state.activeProfileId, outfit = state.outfits[0];
  const events: DemoEvent[] = [
    { id: 'one', ownerId: owner, kind: 'wear', outfitId: outfit.id, date: day, value: 'wear' },
    { id: 'same-day', ownerId: owner, kind: 'wear', outfitId: outfit.id, date: day, value: 'wear' },
    { id: 'next-day', ownerId: owner, kind: 'wear', outfitId: outfit.id, date: '2026-10-10', value: 'wear' },
    { id: 'plan', ownerId: owner, kind: 'plan', outfitId: outfit.id, date: '2026-10-11', value: 'plan' },
    { id: 'care', ownerId: owner, kind: 'care', garmentId: 'g-knit', date: '2026-10-12', value: 'care' },
    { id: 'other', ownerId: 'another-owner', kind: 'wear', outfitId: outfit.id, date: '2026-10-13', value: 'other' },
    { id: 'missing', ownerId: owner, kind: 'wear', outfitId: 'deleted-outfit', date: '2026-10-14', value: 'unknown' },
  ];
  assert.deepEqual(garmentWearSummary('g-knit', owner, state.outfits, events), { wearDays: 2, lastWornDate: '2026-10-10', dates: ['2026-10-10', day], unresolvedWearEvents: 1 });
  assert.equal(garmentWearSummary('g-jeans', owner, state.outfits, events).wearDays, 0);
  assert.equal(garmentWearSummary('g-knit', 'another-owner', state.outfits, events).wearDays, 0);
  assert.equal(state.events.length, 0);
});
test('opening TODAY proposal preserves the prior draft and creates no saved card, wear or selection change', () => {
  const { app } = local(); const original = copy(app.outfitDraft()!), ui = copy(app.ui());
  const proposal = { top: 'g-knit', bottom: 'g-jeans', outer: 'g-jacket' };
  const opened = app.openOutfitProposal(proposal, 'TODAY 추천');
  assert.deepEqual(opened.items, proposal); assert.deepEqual(app.previousOutfitDraft(), original);
  assert.equal(app.outfits().length, 1); assert.equal(app.events().length, 0); assert.equal(app.receipts().length, 0);
  assert.equal(app.ui().selectedOutfitId, ui.selectedOutfitId); assert.equal(app.ui().screen, ui.screen);
  assert.equal(app.openOutfitProposal(proposal, 'TODAY 추천').draftId, opened.draftId);
  assert.equal(app.getState().previousOutfitDrafts![original.ownerId].length, 1);
  const current = copy(app.outfitDraft());
  assert.throws(() => app.openOutfitProposal({ top: 'g-jeans', bottom: 'g-slacks' }, 'wrong category'), /종류/);
  assert.throws(() => app.openOutfitProposal({ top: 'other-owner-shirt', bottom: 'g-slacks' }, 'other owner'), /프로필/);
  assert.deepEqual(app.outfitDraft(), current); app.resumePreviousDraft(); assert.deepEqual(app.outfitDraft(), original);
});