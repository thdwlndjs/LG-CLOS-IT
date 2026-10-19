// Existing SQL/RLS in PostgreSQL WASM only. No network, remote database or real login.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseRepository } from '../server/repository';
import type { SupabaseGateway, UserContext } from '../server/supabase';
import { asRole, createTestDatabase, OWNER } from './db-harness';
import { DemoApp } from '../src/core/app';
import { captureSelectionSnapshot, selectionSnapshotDraft, selectionSnapshotIntent } from '../src/core/selectionScenario';
import type { Garment, Outfit, OutfitDraft, RegistrationDraft, SaveResult } from '../src/core/types';
import type { RemoteBackend } from '../src/integrations/backendClient';

const day = '2026-10-09';

test('B5 selection uses existing SQL plan receipts, recovers lost responses, preserves the user draft and never creates wear', async () => {
  const db = await createTestDatabase();
  try {
    await asRole(db, 'authenticated', OWNER);
    const gateway = {
      async rpc(_user: UserContext, name: string, args: Record<string, unknown>) {
        assert.match(name, /^sc_[a-z_]+$/); const keys = Object.keys(args); keys.forEach(key => assert.match(key, /^p_[a-z_]+$/));
        const values = keys.map(key => args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]);
        const rows = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(',')}) as result`, values);
        return rows.rows[0].result;
      },
      async rows(_user: UserContext, table: string, query: string) {
        assert.match(table, /^sc_[a-z_]+$/); const clauses: string[] = [], values: unknown[] = [];
        for (const [key, value] of new URLSearchParams(query)) {
          if (key === 'select' || key === 'limit') continue;
          const column = key === 'snapshot_json->_client->>revision' ? "snapshot_json -> '_client' ->> 'revision'" : key;
          if (column === key) assert.match(key, /^[a-z_]+$/); assert.ok(value.startsWith('eq.'));
          values.push(value.slice(3)); clauses.push(`${column}=$${values.length}`);
        }
        return (await db.query<Record<string, unknown>>(`select * from public.${table}${clauses.length ? ' where ' + clauses.join(' and ') : ''}`, values)).rows;
      },
      async one(user: UserContext, table: string, id: string) {
        const rows = await this.rows(user, table, `id=eq.${id}&select=*`); if (!rows[0]) throw Error('fixture row missing'); return rows[0];
      },
    };
    const repo = new DatabaseRepository(gateway as unknown as SupabaseGateway, { id: OWNER, token: 'fixture-only-not-a-real-token' });
    function garmentDraft(category: 'top' | 'bottom'): RegistrationDraft {
      return { draftId: randomUUID(), ownerId: OWNER, revision: 1, name: category, category, asset: null, color: '', features: [], material: '', size: '', location: '', careNotes: '', manualFields: {}, provenance: { location: 'unconfirmed', size: 'unconfirmed', care: 'unconfirmed' } };
    }
    const top = await repo.save('saveGarment', garmentDraft('top'), randomUUID());
    const bottom = await repo.save('saveGarment', garmentDraft('bottom'), randomUUID());
    const draft: OutfitDraft = { draftId: randomUUID(), ownerId: OWNER, revision: 4, name: '사용자가 편집하던 코디', items: { top: top.entity.id, bottom: bottom.entity.id }, topLocked: true };
    await repo.putDraft(draft);
    const remote: RemoteBackend = {
      mode: 'mock', state: () => repo.state(), putDraft: async value => { await repo.putDraft(value); }, discardDraft: async value => { await repo.discardDraft(value.draftId, value.revision); },
      saveGarment: (value, intent) => repo.save('saveGarment', value, intent) as Promise<SaveResult<Garment>>,
      saveOutfit: (value, intent) => repo.save('saveOutfit', value, intent) as Promise<SaveResult<Outfit>>,
      recordEvent: (kind, targetId, value, date, intentKey) => repo.event(kind === 'wear' ? 'recordWear' : 'planOutfit', { targetId, value, date, intentKey, clientEventId: intentKey, inputSource: 'user_confirmed' }),
      analyze: async () => null, recommend: async () => null, care: async () => { throw Error('unused'); }, tryOn: async () => ({}),
    };
    const app = new DemoApp(); await app.configureRemote(remote); assert.deepEqual(app.outfitDraft(), draft);
    // A server interruption between internal putDraft and save receipt must not replace the user's draft.
    const internal = await selectionSnapshotDraft(captureSelectionSnapshot(draft, day, app.garments())); await repo.putDraft(internal);
    assert.deepEqual((await repo.state()).outfitDrafts[OWNER], draft);
    const save = remote.saveOutfit; let lostSave = true;
    remote.saveOutfit = async (...args) => { const value = await save(...args); if (lostSave) { lostSave = false; throw Error('save response lost after SQL commit'); } return value; };
    await assert.rejects(app.commitCurrentSelection(day), /save response lost/);
    assert.equal(app.outfits().length, 0); assert.equal(app.events().length, 0);
    assert.deepEqual((await repo.state()).outfitDrafts[OWNER], draft);
    const record = remote.recordEvent; let lostWear = true;
    remote.recordEvent = async (...args) => { const value = await record(...args); if (lostWear) { lostWear = false; throw Error('plan response lost after SQL commit'); } return value; };
    await assert.rejects(app.commitCurrentSelection(day), /plan response lost/);
    assert.equal(app.outfits().length, 1); assert.equal(app.events().length, 0);
    const recovered = await app.commitCurrentSelection(day); assert.equal(recovered.replayed, true); assert.equal(recovered.event.outfitId, recovered.savedOutfit.id);
    assert.deepEqual(recovered.savedOutfit.items, draft.items); assert.equal(app.events().length, 1); assert.equal(app.outfits().length, 1);
    await app.configureRemote(remote); assert.deepEqual(app.outfitDraft(), draft); assert.equal(app.previousOutfitDraft(), undefined);
    const repeated = await app.commitCurrentSelection(day); assert.equal(repeated.event.id, recovered.event.id); assert.equal(repeated.replayed, true);
    const alias = await repo.save('saveOutfit', internal, selectionSnapshotIntent(internal.draftId)); assert.equal(alias.entity.id, recovered.savedOutfit.id);
    const rows = await db.query<{ kind: string; count: number }>('select kind, count(*)::int as count from public.sc_activity_events group by kind');
    assert.deepEqual(rows.rows, [{ kind: 'plan', count: 1 }]);
    // The same visible name on an ordinary user draft does not hide it.
    const ordinary = { ...internal, draftId: randomUUID(),purpose:'card' as const,recordContext:undefined }; await repo.putDraft(ordinary);
    assert.equal((await repo.state()).outfitDrafts[OWNER].draftId, ordinary.draftId);
  } finally { await db.close(); }
});