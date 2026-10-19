import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, DEMO_PROFILE, DemoApp, type Garment, type OutfitDraft, type StorageLike } from '../src/core/index';
import {
  buildFittingSnapshot, fittingSnapshotsMatch, MIRROR_LED_LABEL, resolveGarmentLocation,
  selectFittingPresentation, selectMirrorScene, type CompartmentDefinition, type FittingCandidate,
  type FittingSnapshot, type LocationBinding, type LocationGuide, type MirrorPerson,
} from '../src/mirrorScene';

// Test-only scene bindings preserve original location strings; production definitions belong to the rendered scene.
const compartments: CompartmentDefinition[] = [
  { id: 'left-hanger-b', label: '행거 B', side: 'left' },
  { id: 'left-hanger-d', label: '행거 D', side: 'left' },
  { id: 'right-shelf-c', label: '선반 C', side: 'right' },
  { id: 'right-shelf-f', label: '선반 F', side: 'right' },
  { id: 'right-shoes', label: '신발장', side: 'right' },
];
const bindings: LocationBinding[] = [
  { locationRef: '행거 B · 오른쪽 1번째', compartmentId: 'left-hanger-b' },
  { locationRef: '행거 B · 오른쪽 2번째', compartmentId: 'left-hanger-b' },
  { locationRef: '행거 D', compartmentId: 'left-hanger-d' },
  { locationRef: '선반 C', compartmentId: 'right-shelf-c' },
  { locationRef: '선반 F', compartmentId: 'right-shelf-f' },
  { locationRef: '신발장', compartmentId: 'right-shoes' },
];
const person: MirrorPerson = { id: 'test-local-person-photo', version: 1, url: 'blob:test-local-person' };
function context() { const state = createSeed(); return { ownerId: DEMO_PROFILE, garments: state.garments, compartments, bindings }; }
test('approved display placement guides a compartment without changing unknown physical location',()=>{
 const c=context();const g=c.garments.find(g=>g.id==='g-jeans')!;g.location='';g.provenance.location='unconfirmed';
 const before=structuredClone(c.garments);
 assert.equal(resolveGarmentLocation({...c,garmentId:g.id}).status,'unknown');
 const fixture={ownerId:c.ownerId,byGarmentId:{[g.id]:'행거 D'}};
 const result=resolveGarmentLocation({...c,garmentId:g.id,demoLocations:fixture});
 assert.equal(result.compartmentId,'left-hanger-d');assert.match(result.message,/시연 배치.*실제 위치 미확인/);
 assert.deepEqual(c.garments,before);
 assert.equal(resolveGarmentLocation({...c,garmentId:g.id,demoLocations:{...fixture,ownerId:'other'}}).status,'unknown');
});
function scene(garmentId: string | null, guide: LocationGuide = { kind: 'none' }) {
  const state = createSeed();
  return selectMirrorScene({ ...context(), inspectedGarmentId: garmentId, outfit: state.outfitDrafts[DEMO_PROFILE], locationGuide: guide });
}
function fittingInput() {
  const state = createSeed();
  const outfit = state.outfitDrafts[DEMO_PROFILE];
  outfit.items.bottom = 'g-jeans'; outfit.items.outer = 'g-jacket';
  return { ownerId: DEMO_PROFILE, person: structuredClone(person), outfit, garments: state.garments, requestVersion: 1 };
}
function snapshot(): FittingSnapshot { const result = buildFittingSnapshot(fittingInput()); assert.deepEqual(result.issues, []); return result.snapshot!; }
function savedResult(input = snapshot()): FittingCandidate {
  return { snapshot: structuredClone(input), origin: 'saved', status: 'ready', content: 'fitting-result',
    resultId: 'test-result-fixture', media: { kind: 'image', url: 'blob:test-fixture-result' } };
}
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }
class MemoryStorage implements StorageLike {
  values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); } removeItem(key: string) { this.values.delete(key); }
}

test('compartment contents and guidance use the same exact garment/location mapping', () => {
  const selected = scene('g-jacket', { kind: 'garment', garmentId: 'g-jacket' });
  assert.deepEqual(selected.guidedCompartmentIds, ['left-hanger-b']);
  const active = selected.compartments.find(c => c.ledOn)!;
  assert.equal(active.id, 'left-hanger-b'); assert.equal(active.ledLabel, MIRROR_LED_LABEL);
  assert.equal(active.garments.find(g => g.id === 'g-jacket')?.asset?.url, '/assets/black-jacket.png');
  assert.deepEqual(active.guidedGarmentIds, ['g-jacket']); assert.equal(active.inspectedGarmentId, 'g-jacket');
  assert.equal(selected.locationGuides[0].locationRef, '행거 B · 오른쪽 2번째');
});

test('A to B clears the old LED; selecting another garment in the same compartment updates only its identity', () => {
  const first = scene('g-jacket', { kind: 'garment', garmentId: 'g-jacket' });
  const second = scene('g-knit', { kind: 'garment', garmentId: 'g-knit' });
  assert.equal(first.compartments.find(c => c.id === 'left-hanger-b')!.ledOn, true);
  assert.equal(second.compartments.find(c => c.id === 'left-hanger-b')!.ledOn, false);
  assert.deepEqual(second.guidedCompartmentIds, ['right-shelf-c']);
  const sameCompartment = scene('g-trench', { kind: 'garment', garmentId: 'g-trench' });
  assert.deepEqual(sameCompartment.guidedCompartmentIds, first.guidedCompartmentIds);
  assert.deepEqual(sameCompartment.compartments.find(c => c.ledOn)!.guidedGarmentIds, ['g-trench']);
  assert.equal(sameCompartment.locationGuides[0].garmentName, '베이지 트렌치 코트');
});

test('unknown, unconfirmed, unmapped, foreign and missing garments leave every LED off', () => {
  for (const [kind, edit, expected] of [
    ['unknown', (g: Garment) => { g.location = '위치 미확인'; }, 'unknown'],
    ['unconfirmed', (g: Garment) => { g.provenance.location = 'unconfirmed'; }, 'unknown'],
    ['unmapped', (g: Garment) => { g.location = '계절 보관함'; }, 'unmapped'],
    ['foreign', (g: Garment) => { g.ownerId = 'test-other-owner'; }, 'other-owner'],
  ] as const) {
    const input = context(); const garment = input.garments.find(g => g.id === 'g-jacket')!; edit(garment);
    const result = selectMirrorScene({ ...input, inspectedGarmentId: garment.id, outfit: null, locationGuide: { kind: 'garment', garmentId: garment.id } });
    assert.equal(result.locationGuides[0].status, expected, kind); assert.ok(result.compartments.every(c => !c.ledOn), kind);
    assert.ok(result.compartments.every(c => !c.garments.some(g => g.id === garment.id)), kind);
    if (kind === 'foreign') { assert.equal(result.inspected.garmentName, null); assert.equal(result.inspected.locationRef, null); }
  }
  assert.equal(resolveGarmentLocation({ ...context(), garmentId: 'missing' }).status, 'not-found');
  assert.equal(resolveGarmentLocation({ ...context(), garmentId: null }).status, 'no-selection');
});

test('location mapping is exact and fails closed for conflicting mappings, duplicate IDs and nonexistent compartments', () => {
  const input = context();
  assert.equal(resolveGarmentLocation({ ...input, bindings: [{ locationRef: '행거 B', compartmentId: 'left-hanger-b' }], garmentId: 'g-jacket' }).status, 'unmapped');
  assert.equal(resolveGarmentLocation({ ...input, bindings: [...bindings, { locationRef: '행거 B · 오른쪽 2번째', compartmentId: 'right-shoes' }], garmentId: 'g-jacket' }).status, 'ambiguous');
  assert.equal(resolveGarmentLocation({ ...input, compartments: [...compartments, compartments[0]], garmentId: 'g-jacket' }).status, 'ambiguous');
  assert.equal(resolveGarmentLocation({ ...input, garments: [...input.garments, input.garments.find(g => g.id === 'g-jacket')!], garmentId: 'g-jacket' }).status, 'ambiguous');
  assert.equal(resolveGarmentLocation({ ...input, bindings: [{ locationRef: '선반 C', compartmentId: 'missing-compartment' }], garmentId: 'g-knit' }).status, 'unmapped');
  assert.equal(resolveGarmentLocation({ ...input, bindings: [{ locationRef: '선반 C', compartmentId: 'right-shelf-c', ownerId: 'test-other' }], garmentId: 'g-knit' }).status, 'unmapped');
});

test('inspection, outfit membership and explicit guidance remain independent and never mutate source data', () => {
  const state = deepFreeze(createSeed()); const input = deepFreeze({ ...context(), garments: state.garments,
    inspectedGarmentId: 'g-jacket', outfit: state.outfitDrafts[DEMO_PROFILE], locationGuide: { kind: 'garment', garmentId: 'g-knit' } as LocationGuide });
  const before = JSON.stringify(input); const result = selectMirrorScene(input);
  assert.equal(result.inspected.garmentId, 'g-jacket');
  assert.ok(!result.outfitItems.some(item => item.garmentId === 'g-jacket'));
  assert.deepEqual(result.guidedCompartmentIds, ['right-shelf-c']);
  assert.equal(result.compartments.find(c => c.id === 'left-hanger-b')!.ledOn, false);
  assert.equal(JSON.stringify(input), before); assert.equal(state.events.length, 0);
  assert.ok(scene('g-jacket').compartments.every(c => !c.ledOn));
});

test('explicit entire-outfit guidance attributes each lit compartment to its garment IDs', () => {
  const result = scene('g-jacket', { kind: 'outfit' });
  assert.equal(result.locationGuides.length, 5);
  assert.deepEqual(result.compartments.find(c => c.id === 'left-hanger-b')!.guidedGarmentIds, ['g-trench']);
  assert.deepEqual(result.compartments.find(c => c.id === 'left-hanger-d')!.guidedGarmentIds, ['g-slacks']);
  for (const compartment of result.compartments.filter(c => c.ledOn)) {
    assert.ok(compartment.guidedGarmentIds.every(id => compartment.garments.some(garment => garment.id === id)));
  }
  const input = context(); const foreign = { ...createSeed().outfitDrafts[DEMO_PROFILE], ownerId: 'test-other' };
  const blocked = selectMirrorScene({ ...input, inspectedGarmentId: null, outfit: foreign, locationGuide: { kind: 'outfit' } });
  assert.equal(blocked.outfitItems.length, 0); assert.equal(blocked.guidedCompartmentIds.length, 0); assert.equal(blocked.outfitIssues.length, 1);
});

test('locked top / explicit bottom replacement / save / reload preserve IDs, images, guidance and event separation', async () => {
  const storage = new MemoryStorage(); const app = new DemoApp(storage);
  app.toggleTopLock(); app.setOutfitItem('bottom', 'g-jeans'); app.setOutfitItem('outer', 'g-jacket'); app.selectGarment('g-jeans');
  const toScene = (source: DemoApp) => selectMirrorScene({ ownerId: source.getState().activeProfileId, garments: source.garments(), compartments, bindings,
    inspectedGarmentId: source.ui().selectedGarmentId, outfit: source.outfitDraft()!, locationGuide: { kind: 'garment', garmentId: 'g-jeans' } });
  const first = toScene(app); const captured = buildFittingSnapshot({ ownerId: DEMO_PROFILE, person, outfit: app.outfitDraft()!, garments: app.garments(), requestVersion: 4 }).snapshot!;
  assert.equal(app.outfitDraft()!.topLocked, true); assert.equal(captured.outfit.items.find(i => i.slot === 'top')!.garmentId, 'g-knit');
  assert.equal(captured.outfit.items.find(i => i.slot === 'bottom')!.garmentId, 'g-jeans');
  const saved = await app.saveOutfit('test-mirror-save', { delayMs: 0 });
  const restored = new DemoApp(storage); const after = toScene(restored);
  assert.deepEqual(after, first); assert.equal(restored.outfit(saved.entity.id).items.bottom, 'g-jeans');
  assert.equal(restored.garment('g-jeans').asset!.url, '/assets/jeans.png'); assert.equal(restored.events().length, 0);
  assert.ok(fittingSnapshotsMatch(captured, buildFittingSnapshot({ ownerId: DEMO_PROFILE, person, outfit: restored.outfitDraft()!, garments: restored.garments(), requestVersion: 4 }).snapshot));
});

test('missing current photos or outfit assets never become a display-ready fitting snapshot', () => {
  const input = fittingInput();
  assert.equal(buildFittingSnapshot({ ...input, person: { ...person, url: null } }).snapshot, null);
  assert.equal(buildFittingSnapshot({ ...input, person: { ...person, ownerId: 'other-owner' } }).snapshot, null);
  const seed = createSeed(); const missing = buildFittingSnapshot({ ...input, outfit: seed.outfitDrafts[DEMO_PROFILE], garments: seed.garments });
  assert.equal(missing.snapshot, null);
  assert.deepEqual(missing.issues.filter(i => i.code === 'missing-garment-asset').map(i => i.garmentId), ['g-slacks', 'g-trench']);
  input.garments.find(g => g.id === 'g-jeans')!.asset!.needsReselection = true;
  assert.equal(buildFittingSnapshot(input).snapshot, null);
});

test('private storage identity is retained without requiring a public URL; invalid ownership/slot/revision is rejected', () => {
  const input = fittingInput(); input.garments.find(g => g.id === 'g-jeans')!.asset = { id: 'test-private-asset', version: 2, source: 'storage', url: null };
  const result = buildFittingSnapshot(input); assert.equal(result.snapshot!.outfit.items.find(i => i.slot === 'bottom')!.assetId, 'test-private-asset');
  for (const mutate of [
    (value: ReturnType<typeof fittingInput>) => { value.outfit.ownerId = 'other-owner'; },
    (value: ReturnType<typeof fittingInput>) => { value.outfit.revision = 0; },
    (value: ReturnType<typeof fittingInput>) => { value.requestVersion = 0; },
    (value: ReturnType<typeof fittingInput>) => { delete value.outfit.items.top; },
    (value: ReturnType<typeof fittingInput>) => { value.outfit.items.bottom = 'g-jacket'; },
    (value: ReturnType<typeof fittingInput>) => { value.garments.find(g => g.id === 'g-jeans')!.ownerId = 'other-owner'; },
  ]) { const changed = fittingInput(); mutate(changed); assert.equal(buildFittingSnapshot(changed).snapshot, null); }
});

test('saved outfit asset version must match current garment assets', () => {
  const input = fittingInput(); const outfit = { id: 'test-saved-outfit', ownerId: DEMO_PROFILE, name: 'test', revision: 1,
    items: input.outfit.items, assetVersions: Object.fromEntries(Object.values(input.outfit.items).map(id => [id, 1])) };
  assert.ok(buildFittingSnapshot({ ...input, outfit }).snapshot);
  input.garments.find(g => g.id === 'g-jeans')!.asset!.version++;
  assert.equal(buildFittingSnapshot({ ...input, outfit }).issues[0].code, 'stale-outfit-asset');
});

test('fitting snapshot captures values independently of later draft and asset edits', () => {
  const input = fittingInput(); const captured = buildFittingSnapshot(input).snapshot!;
  input.outfit.items.bottom = 'g-slacks'; input.outfit.revision++; input.garments.find(g => g.id === 'g-jeans')!.asset!.version++;
  assert.equal(captured.outfit.items.find(i => i.slot === 'bottom')!.garmentId, 'g-jeans');
  assert.equal(captured.outfit.items.find(i => i.slot === 'bottom')!.assetVersion, 1); assert.equal(captured.outfit.revision, 1);
});

test('exactly matching saved/batch/realtime results have distinct accurate presentation labels', () => {
  const current = snapshot(); const result = savedResult(current);
  assert.equal(selectFittingPresentation({ current, request: null, result }).label, '저장된 피팅 결과');
  const batch: FittingCandidate = { ...result, origin: 'provider-batch', operationId: 'test-operation', resultId: undefined };
  const batchView = selectFittingPresentation({ current, request: { snapshot: current, status: 'completed' }, result: batch });
  assert.equal(batchView.display, 'fitting-result'); assert.equal(batchView.label, '실제 생성 피팅 결과 · 배치');
  const realtime: FittingCandidate = { ...batch, origin: 'provider-realtime', media: { kind: 'stream', streamId: 'test-stream' } };
  assert.equal(selectFittingPresentation({ current, request: { snapshot: current, status: 'processing' }, result: realtime }).label, '실시간 피팅 세션');
  assert.equal(selectFittingPresentation({ current, request: { snapshot: current, status: 'canceled' }, result: realtime }).display, 'original-person');
  assert.equal(selectFittingPresentation({ current, request: null, result: realtime }).display, 'original-person');
});

test('every person, outfit, garment, slot, asset, owner and request version mismatch blocks current result display', () => {
  const current = snapshot();
  for (const mutate of [
    (s: FittingSnapshot) => { s.ownerId = 'other-owner'; },
    (s: FittingSnapshot) => { s.person.assetId = 'other-person'; },
    (s: FittingSnapshot) => { s.person.assetVersion++; },
    (s: FittingSnapshot) => { s.outfit.draftId = 'other-draft'; },
    (s: FittingSnapshot) => { s.outfit.outfitId = 'other-outfit'; },
    (s: FittingSnapshot) => { s.outfit.revision++; },
    (s: FittingSnapshot) => { s.outfit.items[0].garmentId = 'other-top'; },
    (s: FittingSnapshot) => { s.outfit.items[0].assetId = 'other-top-asset'; },
    (s: FittingSnapshot) => { s.outfit.items[0].assetVersion++; },
    (s: FittingSnapshot) => { s.outfit.items[0].slot = 'bottom'; },
    (s: FittingSnapshot) => { s.outfit.items.pop(); },
    (s: FittingSnapshot) => { s.outfit.items.push({ slot: 'hat', garmentId: 'hat', assetId: 'hat-asset', assetVersion: 1 }); },
    (s: FittingSnapshot) => { s.requestVersion++; },
  ]) {
    const candidate = savedResult(current); mutate(candidate.snapshot);
    assert.equal(fittingSnapshotsMatch(current, candidate.snapshot), false);
    assert.equal(selectFittingPresentation({ current, request: null, result: candidate }).reason, 'stale');
  }
  const reordered = structuredClone(current); reordered.outfit.items.reverse(); assert.ok(fittingSnapshotsMatch(current, reordered));
});

test('late A result never overlays B or a new A request after switching back', () => {
  const firstA = snapshot(); const lateResult = savedResult(firstA);
  const selectionB = structuredClone(firstA); selectionB.outfit.items.find(i => i.slot === 'bottom')!.garmentId = 'test-other-bottom'; selectionB.outfit.revision++; selectionB.requestVersion++;
  assert.equal(selectFittingPresentation({ current: selectionB, request: { snapshot: firstA, status: 'completed' }, result: lateResult }).reason, 'stale');
  const newA = structuredClone(firstA); newA.requestVersion = 3;
  assert.equal(selectFittingPresentation({ current: newA, request: { snapshot: newA, status: 'processing' }, result: lateResult }).reason, 'stale');
  const noResult = selectFittingPresentation({ current: newA, request: { snapshot: newA, status: 'processing' }, result: null });
  assert.equal(noResult.reason, 'pending'); assert.equal(noResult.media, null); assert.match(noResult.message, /선택 코디 미적용/);
});

test('outfit collages, absent media, absent provenance, mock origins and inactive streams remain original photos', () => {
  const current = snapshot();
  const cases: FittingCandidate[] = [
    { ...savedResult(current), content: 'outfit-card' },
    { ...savedResult(current), media: null },
    { ...savedResult(current), resultId: undefined },
    { ...savedResult(current), origin: 'provider-batch', operationId: undefined },
    { ...savedResult(current), origin: 'mock' as FittingCandidate['origin'] },
    { ...savedResult(current), media: { kind: 'image', url: '' } },
    { ...savedResult(current), media: { kind: 'stream', streamId: 'test-stream' } },
  ];
  for (const result of cases) assert.equal(selectFittingPresentation({ current, request: null, result }).display, 'original-person');
  assert.equal(selectFittingPresentation({ current, request: null, result: null }).reason, 'no-result');
  assert.equal(selectFittingPresentation({ current: null, request: null, result: savedResult(current) }).reason, 'missing-input');
});
