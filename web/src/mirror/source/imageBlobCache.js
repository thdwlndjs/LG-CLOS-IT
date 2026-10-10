const entries = new Map();
const bindings = new Map();
let generation = 0;
let revision = 0;
const listeners = new Set();
export const imageCacheRevision = () => revision;
export const subscribeImageCache = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = () => {
  revision++;
  for (const listener of listeners) listener();
};
export const imageCacheKey = (asset) => `${asset.id}:${asset.version}`;
export function invalidateImage(id) {
  for (const [key, entry] of entries)
    if (entry.id === id) {
      entry.controller.abort();
      if (entry.url) URL.revokeObjectURL(entry.url);
      entries.delete(key);
      notify();
    }
}
export function clearImageCache() {
  generation++;
  for (const id of new Set([...entries.values()].map((e) => e.id)))
    invalidateImage(id);
  bindings.clear();
}
export function bindGarmentImage(garmentId, asset, refresh) {
  const previous = bindings.get(garmentId);
  if (previous && previous.assetId !== asset?.id)
    invalidateImage(previous.assetId);
  if (asset) bindings.set(garmentId, { assetId: asset.id, refresh });
  else bindings.delete(garmentId);
}
export function reconcileGarmentImages(ids) {
  for (const [id, binding] of bindings)
    if (!ids.has(id)) {
      invalidateImage(binding.assetId);
      bindings.delete(id);
    }
}
export function cachedImage(asset) {
  return entries.get(imageCacheKey(asset))?.url || null;
}
export function loadCachedImage(asset) {
  const key = imageCacheKey(asset),
    existing = entries.get(key);
  if (existing) return existing.promise;
  const epoch = generation,
    controller = new AbortController();
  const entry = { id: asset.id, controller, url: null, promise: null };
  entries.set(key, entry);
  const assertActive = () => {
    if (
      epoch !== generation ||
      controller.signal.aborted ||
      entries.get(key) !== entry
    )
      throw new Error("Image cache invalidated");
  };
  entry.promise = (async () => {
    const refresh = [...bindings.values()].find(
      (b) => b.assetId === asset.id,
    )?.refresh;
    const fresh = async () => {
      assertActive();
      const next = await refresh();
      assertActive();
      if (next.id !== asset.id)
        throw new Error("Image identity changed; reload garment");
      return next;
    };
    let current = asset;
    if (
      refresh &&
      (!current.url || Date.parse(current.expiresAt || "") <= Date.now())
    )
      current = await fresh();
    for (let attempt = 0; attempt < 2; attempt++) {
      assertActive();
      const response = await fetch(current.url, { signal: controller.signal });
      assertActive();
      if (!response.ok) {
        if (
          attempt === 0 &&
          refresh &&
          (response.status === 403 || response.status === 401)
        ) {
          current = await fresh();
          continue;
        }
        throw new Error(`Image download failed (${response.status})`);
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("image/"))
        throw new Error("Invalid image content type");
      assertActive();
      entry.url = URL.createObjectURL(blob);
      return entry.url;
    }
    throw new Error("Image download failed");
  })().catch((error) => {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  });
  return entry.promise;
}
