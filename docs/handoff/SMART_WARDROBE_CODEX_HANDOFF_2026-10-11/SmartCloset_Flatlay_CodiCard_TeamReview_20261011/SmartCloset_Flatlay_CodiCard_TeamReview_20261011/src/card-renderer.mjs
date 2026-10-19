/** Framework-independent card pixels only. No storage or provider requests. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const BITMAPS = new Map();
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

export class CardRenderError extends Error {
  constructor(code, diagnostics = []) {
    super(code);
    this.name = 'CardRenderError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

/**
 * Ignore very faint shadow and disconnected alpha dust without trimming substantial
 * detached garment parts (a pair of shoes, handles, straps). Pixel source is untouched.
 * Bounds are pixels; alpha-connected components are evaluated before padding.
 */
export function getAlphaBounds(rgba, width, height, { alphaThreshold = 24, minMassFraction = 0.0001, padding = 2 } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !rgba || rgba.length !== width * height * 4) throw new TypeError('INVALID_PIXEL_DATA');
  if (!(alphaThreshold >= 1 && alphaThreshold <= 255) || !(minMassFraction >= 0 && minMassFraction <= 1) || !Number.isInteger(padding) || padding < 0) throw new TypeError('INVALID_ALPHA_OPTIONS');
  const count = width * height;
  let maxAlpha = 0;
  for (let p = 3; p < rgba.length; p += 4) maxAlpha = Math.max(maxAlpha, rgba[p]);
  if (!maxAlpha) return null;
  // Unusually translucent source files remain visible; never change their opacity.
  const threshold = Math.min(alphaThreshold, maxAlpha);
  const seen = new Uint8Array(count);
  const queue = new Uint32Array(count);
  const components = [];
  for (let seed = 0; seed < count; seed++) {
    if (seen[seed] || rgba[seed * 4 + 3] < threshold) continue;
    let head = 0, tail = 1, mass = 0, pixels = 0;
    let left = width, top = height, right = -1, bottom = -1;
    queue[0] = seed; seen[seed] = 1;
    while (head < tail) {
      const at = queue[head++], x = at % width, y = Math.floor(at / width);
      mass += rgba[at * 4 + 3]; pixels++;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const next = yy * width + xx;
          if (!seen[next] && rgba[next * 4 + 3] >= threshold) { seen[next] = 1; queue[tail++] = next; }
        }
      }
    }
    components.push({ left, top, right, bottom, mass, pixels });
  }
  const largest = components.reduce((a, b) => a.mass >= b.mass ? a : b);
  const minMass = Math.max(2 * threshold, largest.mass * minMassFraction);
  // Keep the largest even for a legitimately tiny icon; isolated one-pixel dust is ignored.
  const kept = components.filter(c => c === largest || (c.pixels >= 2 && c.mass >= minMass));
  const union = kept.reduce((bounds, c) => ({ left: Math.min(bounds.left, c.left), top: Math.min(bounds.top, c.top), right: Math.max(bounds.right, c.right), bottom: Math.max(bounds.bottom, c.bottom) }), { left: width, top: height, right: -1, bottom: -1 });
  const left = Math.max(0, union.left - padding);
  const top = Math.max(0, union.top - padding);
  const right = Math.min(width - 1, union.right + padding);
  const bottom = Math.min(height - 1, union.bottom + padding);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function fitBounds(source, boxWidth, boxHeight) {
  if (!source || ![source.width, source.height, boxWidth, boxHeight].every(v => Number.isFinite(v) && v > 0)) throw new TypeError('INVALID_DISPLAY_BOUNDS');
  const scale = Math.min(boxWidth / source.width, boxHeight / source.height);
  return { width: source.width * scale, height: source.height * scale };
}

function surface(width = CARD_WIDTH, height = CARD_HEIGHT) {
  if (typeof document === 'undefined') throw new CardRenderError('BROWSER_CANVAS_REQUIRED');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return canvas;
}
function context(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CardRenderError('CANVAS_UNAVAILABLE');
  return ctx;
}
function diagnostic(code, item, message) {
  return { code, severity: 'error', itemKey: item?.itemKey ?? null, itemId: item?.itemId ?? item?.id ?? null, assetId: item?.assetId ?? null, message };
}
function itemFor(snapshot, placement) {
  return snapshot.items?.find(item => placement.itemKey ? item.itemKey === placement.itemKey : item.itemId === placement.itemId && item.kind === placement.kind) || placement;
}
function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.layout) || !Array.isArray(snapshot.items)) throw new CardRenderError('INVALID_SNAPSHOT');
  if (snapshot.layout.length !== snapshot.items.length) throw new CardRenderError('LAYOUT_ITEM_MISMATCH');
  const keys = new Set();
  for (const p of snapshot.layout) {
    if (![p.x, p.y, p.width, p.height, p.rotation, p.z].every(Number.isFinite) || p.width <= 0 || p.height <= 0) throw new CardRenderError('INVALID_LAYOUT_COORDINATES');
    const key = p.itemKey || JSON.stringify([p.kind, p.itemId]);
    if (keys.has(key)) throw new CardRenderError('DUPLICATE_LAYOUT_ITEM');
    keys.add(key);
    const found = snapshot.items.some(i => (i.itemKey || JSON.stringify([i.kind, i.itemId ?? i.id])) === key && i.assetId === p.assetId);
    if (!found) throw new CardRenderError('LAYOUT_ITEM_MISMATCH');
  }
}
async function loadBitmap(asset, placement) {
  const path = asset?.url || asset?.path || asset?.src;
  if (!path || placement.imageState === 'missing') throw new CardRenderError('ASSET_MISSING');
  if (placement.assetVersion !== undefined && asset.version !== undefined && placement.assetVersion !== asset.version) throw new CardRenderError('ASSET_VERSION_MISMATCH');
  const key = JSON.stringify([placement.assetId, placement.assetVersion, path]);
  if (!BITMAPS.has(key)) {
    const promise = new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => { img.onload = null; img.onerror = null; reject(new CardRenderError('IMAGE_LOAD_TIMEOUT')); }, 15000);
      img.onload = async () => {
        clearTimeout(timer);
        try {
          if (img.decode) await img.decode();
          if (!img.naturalWidth || !img.naturalHeight) throw new CardRenderError('IMAGE_DECODE_FAILED');
          const scratch = surface(img.naturalWidth, img.naturalHeight), ctx = context(scratch);
          ctx.drawImage(img, 0, 0);
          const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height);
          const bounds = getAlphaBounds(pixels.data, scratch.width, scratch.height);
          if (!bounds) throw new CardRenderError('IMAGE_EMPTY_ALPHA');
          resolve({ img, bounds });
        } catch (e) { reject(e.name === 'SecurityError' ? new CardRenderError('IMAGE_CORS_BLOCKED') : e); }
      };
      img.onerror = () => { clearTimeout(timer); reject(new CardRenderError('IMAGE_LOAD_OR_CORS_FAILED')); };
      img.src = path;
    });
    BITMAPS.set(key, promise);
    promise.catch(() => { if (BITMAPS.get(key) === promise) BITMAPS.delete(key); });
  }
  return BITMAPS.get(key);
}
async function fontsReady() {
  if (!document.fonts) return;
  let timer;
  try {
    await Promise.race([
      document.fonts.ready.then(() => document.fonts.load(`500 28px ${FONT}`, '코디 의류')),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new CardRenderError('FONT_LOAD_TIMEOUT')), 5000); }),
    ]);
    // Any explicitly requested failed web font makes export diagnostics truthful.
    if ([...document.fonts].some(font => font.status === 'error' && FONT.includes(font.family.replace(/["']/g, '')))) throw new CardRenderError('FONT_LOAD_FAILED');
  } finally { clearTimeout(timer); }
}
function lines(ctx, value, x, y, width, lineHeight, maxLines = 2) {
  const text = String(value || ''); let line = '', rows = [];
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > width && line) { rows.push(line); line = ch; }
    else line += ch;
  }
  if (line) rows.push(line);
  rows = rows.slice(0, maxLines);
  rows.forEach((row, i) => ctx.fillText(row, x, y + i * lineHeight));
}
function placeholder(ctx, item, placement) {
  const x = placement.x * CARD_WIDTH, y = placement.y * CARD_HEIGHT;
  const width = placement.width * CARD_WIDTH, height = placement.height * CARD_HEIGHT;
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#7f8173'; ctx.lineWidth = 1;
  ctx.setLineDash([5, 6]); ctx.strokeRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10); ctx.setLineDash([]);
  ctx.fillStyle = '#344338'; ctx.textAlign = 'center'; ctx.font = `500 22px ${FONT}`;
  lines(ctx, item?.name || '선택한 의류', 0, -12, Math.max(50, width - 25), 27);
  ctx.font = `400 18px ${FONT}`; ctx.fillText('사진 없음 · 선택은 유지', 0, Math.min(65, height / 2 - 12)); ctx.restore();
}
function drawGarment(ctx, loaded, placement, shadows) {
  const { img, bounds } = loaded;
  // sourceRect is advisory metadata; measured complete garment bounds prevent stale
  // crop metadata cutting a collar/hem. No extra crop is applied a second time.
  const fitted = fitBounds(bounds, placement.width * CARD_WIDTH, placement.height * CARD_HEIGHT);
  ctx.save(); ctx.translate(placement.x * CARD_WIDTH, placement.y * CARD_HEIGHT); ctx.rotate(placement.rotation * Math.PI / 180);
  if (shadows) { ctx.shadowColor = 'rgba(35,31,27,.10)'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 6; }
  ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height, -fitted.width / 2, -fitted.height / 2, fitted.width, fitted.height);
  ctx.restore();
}
function decorate(ctx, snapshot) {
  ctx.fillStyle = '#344338'; ctx.font = `500 15px ${FONT}`; ctx.fillText('CLOSET / OUTFIT', 74, 52);
  ctx.font = `500 28px ${FONT}`; lines(ctx, snapshot.title || '선택한 옷의 조합', 74, 1250, 932, 35);
  const external = snapshot.items.filter(i => i.kind === 'external').length;
  ctx.font = `400 16px ${FONT}`; ctx.fillStyle = '#535e54';
  ctx.fillText(`내 옷 ${snapshot.items.length - external}${external ? ` · 외부 후보 ${external}` : ''} / 구성형 코디카드`, 74, 1320);
}
async function render(canvas, snapshot, assets, options, provider = false) {
  const { isCurrent = () => true, exportMode = false, onDiagnostics = () => {} } = options;
  validateSnapshot(snapshot);
  if (!isCurrent()) return false;
  const diagnostics = [];
  if (provider) {
    if (typeof options.assetPolicy !== 'function') throw new CardRenderError('PROVIDER_ASSET_POLICY_REQUIRED');
    for (const placement of snapshot.layout) {
      const item = itemFor(snapshot, placement), asset = assets[placement.assetId];
      const policy = await options.assetPolicy(asset, item, snapshot);
      if (!policy || policy.approved !== true) diagnostics.push(diagnostic('PROVIDER_ASSET_NOT_APPROVED', item, '이번 실행에 승인된 자산인지 확인되지 않았어요.'));
    }
    if (diagnostics.length) throw new CardRenderError('PROVIDER_ASSET_NOT_APPROVED', diagnostics);
    if (!isCurrent()) return false;
  } else {
    try { await fontsReady(); } catch (e) { diagnostics.push(diagnostic(e.code || 'FONT_LOAD_FAILED', null, '문자 글꼴을 준비하지 못했어요.')); }
  }
  const loaded = await Promise.all(snapshot.layout.map(async placement => {
    const item = itemFor(snapshot, placement);
    try { return { placement, item, bitmap: await loadBitmap(assets[placement.assetId], placement) }; }
    catch (e) { diagnostics.push(diagnostic(e.code || 'IMAGE_DECODE_FAILED', item, '선택한 의류 사진을 읽지 못했어요. 다른 옷으로 대체하지 않아요.')); return { placement, item }; }
  }));
  if (!isCurrent()) return false;
  if ((exportMode || provider) && diagnostics.length) throw new CardRenderError('CARD_EXPORT_INCOMPLETE', diagnostics);
  const work = surface(), ctx = context(work);
  if (!provider && snapshot.background !== 'transparent') {
    ctx.fillStyle = snapshot.background === 'mist' ? '#e7e9e5' : '#ece6dc'; ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }
  for (const entry of loaded.sort((a, b) => a.placement.z - b.placement.z)) {
    if (entry.bitmap) drawGarment(ctx, entry.bitmap, entry.placement, !provider);
    else placeholder(ctx, entry.item, entry.placement);
  }
  if (!provider) decorate(ctx, snapshot);
  if (!isCurrent()) return false;
  const out = context(canvas);
  out.clearRect(0, 0, canvas.width, canvas.height); out.drawImage(work, 0, 0, canvas.width, canvas.height);
  canvas.flatlayDiagnostics = diagnostics;
  onDiagnostics(diagnostics);
  return true;
}

/** True means current render committed. False means obsolete; missing photos have diagnostics and named placeholders. */
export async function renderCard(canvas, snapshot, assets, options = {}) {
  return render(canvas, snapshot, assets, options, false);
}

/** Export never persists a second card. Missing/tainted/decode/font failures reject with diagnostics. */
export async function exportCard(snapshot, assets) {
  if (!snapshot?.items?.length) throw new CardRenderError('EMPTY_OUTFIT');
  const canvas = surface();
  await renderCard(canvas, snapshot, assets, { exportMode: true });
  const blob = await new Promise((resolve, reject) => {
    try { canvas.toBlob(value => value ? resolve(value) : reject(new CardRenderError('PNG_ENCODE_FAILED')), 'image/png'); }
    catch (e) { reject(new CardRenderError(e.name === 'SecurityError' ? 'IMAGE_CORS_BLOCKED' : 'PNG_ENCODE_FAILED')); }
  });
  return { blob, diagnostics: canvas.flatlayDiagnostics || [] };
}

/**
 * Clean composition preparation only: no provider call, text, card background or shadows.
 * Caller must supply assetPolicy(asset,item,snapshot) => {approved:true} from verified policy.
 * A composed reference is NOT proof of provider input compatibility or actual VTON success.
 */
export async function renderProviderReference(canvas, snapshot, assets, options = {}) {
  if (!snapshot?.items?.length) throw new CardRenderError('EMPTY_OUTFIT');
  return render(canvas, snapshot, assets, options, true);
}
