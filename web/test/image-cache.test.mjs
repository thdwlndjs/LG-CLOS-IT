import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  clearImageCache,
  loadCachedImage,
  bindGarmentImage,
  reconcileGarmentImages,
  cachedImage,
  invalidateImage,
} from "../src/mirror/source/imageBlobCache.js";
const original = globalThis.fetch;
afterEach(() => {
  clearImageCache();
  globalThis.fetch = original;
});
const asset = {
  id: "a",
  version: 1,
  url: "/signed",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
const ok = () => new Response(new Blob(["photo"], { type: "image/png" }));
test("cache hit and concurrent consumers download once without URL reissue", async () => {
  let downloads = 0,
    refreshes = 0;
  globalThis.fetch = async () => {
    downloads++;
    return ok();
  };
  bindGarmentImage("g", asset, async () => {
    refreshes++;
    return asset;
  });
  const [a, b] = await Promise.all([
    loadCachedImage(asset),
    loadCachedImage(asset),
  ]);
  assert.equal(a, b);
  assert.equal(await loadCachedImage({ ...asset, url: "/expired" }), a);
  assert.equal(downloads, 1);
  assert.equal(refreshes, 0);
});
test("expired cache miss refreshes once before download", async () => {
  let refreshes = 0,
    downloads = 0;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/new");
    downloads++;
    return ok();
  };
  bindGarmentImage("g", asset, async () => {
    refreshes++;
    return { ...asset, url: "/new" };
  });
  await loadCachedImage({ ...asset, expiresAt: "2000-01-01" });
  assert.equal(refreshes, 1);
  assert.equal(downloads, 1);
});
test("403 refresh and retry is bounded at one, failed cache is evicted", async () => {
  let downloads = 0,
    refreshes = 0;
  globalThis.fetch = async () => {
    downloads++;
    return new Response("", { status: 403 });
  };
  bindGarmentImage("g", asset, async () => {
    refreshes++;
    return asset;
  });
  await assert.rejects(loadCachedImage(asset));
  assert.equal(downloads, 2);
  assert.equal(refreshes, 1);
  assert.equal(cachedImage(asset), null);
});
test("replacement, deletion and logout revoke object URLs", async () => {
  globalThis.fetch = async () => ok();
  const revoked = [],
    originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    originalRevoke(url);
  };
  try {
    bindGarmentImage("g", asset, async () => asset);
    const first = await loadCachedImage(asset);
    bindGarmentImage("g", { id: "b" }, async () => asset);
    assert.equal(cachedImage(asset), null);
    assert.ok(revoked.includes(first));
    const second = await loadCachedImage({ ...asset, id: "b" });
    reconcileGarmentImages(new Set());
    assert.ok(revoked.includes(second));
    const third = await loadCachedImage(asset);
    clearImageCache();
    assert.ok(revoked.includes(third));
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }
});
test("logout during an in-flight download cannot repopulate cache", async () => {
  let finish;
  globalThis.fetch = () => new Promise((resolve) => (finish = resolve));
  const pending = loadCachedImage(asset);
  clearImageCache();
  finish(ok());
  await assert.rejects(pending);
  assert.equal(cachedImage(asset), null);
});
test("changed server identity and non-expiry errors do not retry old image", async () => {
  let downloads = 0;
  globalThis.fetch = async () => {
    downloads++;
    return new Response("", { status: 404 });
  };
  bindGarmentImage("g", asset, async () => ({ ...asset, id: "different" }));
  await assert.rejects(loadCachedImage(asset));
  assert.equal(downloads, 1);
  await assert.rejects(
    loadCachedImage({ ...asset, expiresAt: "2000-01-01" }),
    /identity/,
  );
  assert.equal(downloads, 1);
});

test("individual invalidation during response cannot refresh or resurrect old cache", async () => {
  let finish,
    refreshes = 0;
  globalThis.fetch = () => new Promise((resolve) => (finish = resolve));
  bindGarmentImage("g", asset, async () => {
    refreshes++;
    return asset;
  });
  const pending = loadCachedImage(asset);
  invalidateImage(asset.id);
  finish(new Response("", { status: 403 }));
  await assert.rejects(pending);
  assert.equal(refreshes, 0);
  assert.equal(cachedImage(asset), null);
});
test("distinct asset versions never reuse another version blob", async () => {
  let downloads = 0;
  globalThis.fetch = async () => {
    downloads++;
    return ok();
  };
  const first = await loadCachedImage(asset),
    second = await loadCachedImage({ ...asset, version: 2 });
  assert.notEqual(first, second);
  assert.equal(downloads, 2);
});
