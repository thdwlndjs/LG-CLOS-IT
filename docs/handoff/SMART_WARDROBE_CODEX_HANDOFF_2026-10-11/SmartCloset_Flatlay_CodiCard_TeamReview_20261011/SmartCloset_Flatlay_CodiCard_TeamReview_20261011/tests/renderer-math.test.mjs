import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlphaBounds, fitBounds, renderProviderReference, exportCard } from '../src/card-renderer.mjs';

function pixels(w, h, fills = []) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (const [x, y, width, height, alpha] of fills) for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) rgba[(yy * w + xx) * 4 + 3] = alpha;
  return rgba;
}
test('transparent file has no invented visible garment', () => assert.equal(getAlphaBounds(pixels(20, 20), 20, 20), null));
test('solid full image retains all source pixels', () => assert.deepEqual(getAlphaBounds(pixels(10, 10, [[0, 0, 10, 10, 255]]), 10, 10), { x: 0, y: 0, width: 10, height: 10 }));
test('isolated opaque dust cannot shrink garment display to full canvas', () => assert.deepEqual(getAlphaBounds(pixels(100, 100, [[30, 20, 40, 60, 255], [0, 0, 1, 1, 255], [99, 99, 1, 1, 255]]), 100, 100), { x: 28, y: 18, width: 44, height: 64 }));
test('faint wide shadow ignored, two pixel antialias margin preserved', () => assert.deepEqual(getAlphaBounds(pixels(100, 100, [[0, 0, 100, 100, 8], [30, 20, 40, 60, 255]]), 100, 100), { x: 28, y: 18, width: 44, height: 64 }));
test('both disconnected shoes remain in source bounds', () => assert.deepEqual(getAlphaBounds(pixels(100, 100, [[10, 10, 20, 60, 255], [65, 25, 15, 55, 255]]), 100, 100), { x: 8, y: 8, width: 74, height: 74 }));
test('thin diagonal strap belongs to eight-connected garment', () => {
  const rgba = pixels(50, 50, [[15, 15, 20, 30, 255]]);
  for (let v = 0; v <= 15; v++) rgba[(v * 50 + v) * 4 + 3] = 255;
  assert.deepEqual(getAlphaBounds(rgba, 50, 50, { padding: 0 }), { x: 0, y: 0, width: 35, height: 45 });
});
test('wholly translucent image remains measurable, opacity not rewritten', () => {
  const rgba = pixels(20, 20, [[5, 5, 10, 10, 10]]), original = rgba.slice();
  assert.deepEqual(getAlphaBounds(rgba, 20, 20), { x: 3, y: 3, width: 14, height: 14 });
  assert.deepEqual(rgba, original);
});
test('real detached small component preserved without isolated single pixel', () => assert.deepEqual(getAlphaBounds(pixels(100, 100, [[30, 20, 40, 60, 255], [10, 10, 2, 4, 255]]), 100, 100), { x: 8, y: 8, width: 64, height: 74 }));
test('invalid pixel geometry rejects rather than silently crops', () => assert.throws(() => getAlphaBounds(new Uint8Array(4), 10, 10), /INVALID_PIXEL_DATA/));
test('fit preserves tall garment aspect inside assigned area', () => assert.deepEqual(fitBounds({ width: 100, height: 400 }, 200, 400), { width: 100, height: 400 }));
test('fit preserves shoe aspect inside narrow area', () => assert.deepEqual(fitBounds({ width: 500, height: 100 }, 200, 200), { width: 200, height: 40 }));
test('fit rejects invalid dimensions', () => assert.throws(() => fitBounds({ width: 0, height: 5 }, 200, 200), /INVALID_DISPLAY_BOUNDS/));
test('empty provider reference cannot accidentally become valid input', async () => assert.rejects(renderProviderReference({}, { items: [] }, {}), /EMPTY_OUTFIT/));
test('empty PNG export fails independently of saved composition', async () => assert.rejects(exportCard({ items: [] }, {}), /EMPTY_OUTFIT/));

// Canvas fixtures below verify error/race contracts only. Real pixels/PNG are browser QA.
async function withCanvasFixture(run, { onImageStart = () => {}, decodeFails = false, corsFails = false, blobFails = false } = {}) {
  const oldDocument = globalThis.document, oldImage = globalThis.Image;
  const all = [];
  function canvas() {
    const calls = [], c = { width: 1080, height: 1350, calls };
    const ctx = new Proxy({
      measureText: value => ({ width: String(value).length * 12 }),
      getImageData: () => { if (corsFails) throw Object.assign(new Error('tainted'), { name: 'SecurityError' }); return { data: pixels(4, 4, [[0, 0, 4, 4, 255]]) }; },
    }, { get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]) });
    c.getContext = () => ctx;
    c.toBlob = callback => callback(blobFails ? null : new Blob(['fixture'], { type: 'image/png' }));
    all.push(c); return c;
  }
  globalThis.document = { createElement: () => canvas() };
  globalThis.Image = class {
    naturalWidth = 4; naturalHeight = 4;
    decode() { return decodeFails ? Promise.reject(new Error('bad image')) : Promise.resolve(); }
    set src(value) { this.value = value; onImageStart(value); queueMicrotask(() => this.onload?.()); }
  };
  try { return await run({ canvas, all }); }
  finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldImage === undefined) delete globalThis.Image; else globalThis.Image = oldImage;
  }
}
function sample(assetId = 'one') {
  const item = { itemKey: '["owned","shirt"]', itemId: 'shirt', assetId, kind: 'owned', name: '선택한 블루 셔츠' };
  return { title: '블루 셔츠 중심 코디', background: 'transparent', items: [item], layout: [{ ...item, x: .5, y: .45, width: .6, height: .7, rotation: 0, z: 0 }] };
}
test('render fixture: missing image commits honest named placeholder with error', async () => {
  const { renderCard } = await import('../src/card-renderer.mjs');
  await withCanvasFixture(async ({ canvas, all }) => {
    const output = canvas(); let diagnostics;
    assert.equal(await renderCard(output, sample(), {}, { onDiagnostics: d => { diagnostics = d; } }), true);
    assert.equal(diagnostics[0].code, 'ASSET_MISSING');
    assert.ok(all.flatMap(c => c.calls).some(call => call[0] === 'fillText' && call[1] === '선택한 블루 셔츠'));
    assert.equal(output.calls.filter(c => c[0] === 'drawImage').length, 1);
  });
});
test('render fixture: delayed previous-profile image never draws into current canvas', async () => {
  const { renderCard } = await import('../src/card-renderer.mjs');
  let current = true;
  await withCanvasFixture(async ({ canvas }) => {
    const output = canvas();
    const result = await renderCard(output, sample('late'), { late: { path: '/late.png' } }, { isCurrent: () => current });
    assert.equal(result, false); assert.equal(output.calls.length, 0); assert.equal(output.flatlayDiagnostics, undefined);
  }, { onImageStart: () => { current = false; } });
});
test('render fixture: export refuses missing selected image', async () => withCanvasFixture(async () => {
  await assert.rejects(exportCard(sample('missing'), {}), e => e.code === 'CARD_EXPORT_INCOMPLETE' && e.diagnostics[0].code === 'ASSET_MISSING');
}));
test('render fixture: export reports image decode failure without substitution', async () => withCanvasFixture(async () => {
  await assert.rejects(exportCard(sample('decode'), { decode: { path: '/decode.png' } }), e => e.diagnostics[0].code === 'IMAGE_DECODE_FAILED');
}, { decodeFails: true }));
test('render fixture: export reports canvas CORS failure', async () => withCanvasFixture(async () => {
  await assert.rejects(exportCard(sample('cors'), { cors: { path: '/cors.png' } }), e => e.diagnostics[0].code === 'IMAGE_CORS_BLOCKED');
}, { corsFails: true }));
test('render fixture: PNG encoder failure is not save success', async () => withCanvasFixture(async () => {
  await assert.rejects(exportCard(sample('encode'), { encode: { path: '/encode.png' } }), /PNG_ENCODE_FAILED/);
}, { blobFails: true }));
test('render fixture: provider preparation requires explicit per-asset policy', async () => withCanvasFixture(async ({ canvas }) => {
  await assert.rejects(renderProviderReference(canvas(), sample(), {}), /PROVIDER_ASSET_POLICY_REQUIRED/);
  await assert.rejects(renderProviderReference(canvas(), sample(), {}, { assetPolicy: () => ({ approved: false }) }), /PROVIDER_ASSET_NOT_APPROVED/);
}));
test('render fixture: approved provider composition has no title, card background or shadows', async () => withCanvasFixture(async ({ canvas }) => {
  const output = canvas(); let checked = 0;
  assert.equal(await renderProviderReference(output, sample('provider'), { provider: { path: '/provider.png' } }, { assetPolicy: (_asset, item) => { checked++; assert.equal(item.itemId, 'shirt'); return { approved: true }; } }), true);
  const work = output.calls.find(c => c[0] === 'drawImage')[1];
  assert.equal(checked, 1); assert.equal(work.calls.filter(c => ['fillText', 'fillRect'].includes(c[0])).length, 0);
  assert.equal(work.calls.filter(c => c[0] === 'drawImage').length, 1);
}));
test('render fixture: layout cannot silently omit or add selected garments', async () => {
  const { renderCard } = await import('../src/card-renderer.mjs');
  const s = sample(); s.layout = [];
  await assert.rejects(renderCard({}, s, {}), /LAYOUT_ITEM_MISMATCH/);
});
