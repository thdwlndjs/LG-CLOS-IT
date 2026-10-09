import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, query, assetUrl, safeLink, upload } from "../src/api.js";

test("query preserves false/zero and omits missing values", () =>
  assert.equal(
    query({ offset: 0, active: false, category: "", owner: null }),
    "offset=0&active=false",
  ));
test("asset relay accepts only fixed signed local bucket", () => {
  assert.equal(
    assetUrl("http://localhost:9000/wardrobe-assets/a.png?X-Amz-Signature=abc"),
    "/local-storage/wardrobe-assets/a.png?X-Amz-Signature=abc",
  );
  assert.equal(assetUrl("https://evil.example/photo.png"), null);
  assert.equal(assetUrl("http://localhost:9000/other-bucket/a"), null);
});
test("share links preserve local API path only", () =>
  assert.equal(
    assetUrl("http://localhost:8000/api/v1/card-shares/abc"),
    "/api/v1/card-shares/abc",
  ));
test("style links refuse script/data URLs", () => {
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("data:text/html,abc"), null);
  assert.equal(safeLink("https://example.com/"), "https://example.com/");
});
test("uncertain mutation retry keeps idempotency key; new successful action uses new key", async () => {
  const calls = [];
  let fail = true;
  const api = createClient("test-token", null, async (path, options) => {
    calls.push(options);
    if (fail) {
      fail = false;
      throw new Error("untrusted private detail");
    }
    return new Response("{}", { status: 201 });
  });
  await assert.rejects(
    () => api.send("/outfits", { title: "A" }),
    (e) => e.code === "NETWORK_ERROR" && !e.message.includes("private"),
  );
  await api.send("/outfits", { title: "A" });
  await api.send("/outfits", { title: "A" });
  assert.equal(
    calls[0].headers["Idempotency-Key"],
    calls[1].headers["Idempotency-Key"],
  );
  assert.notEqual(
    calls[1].headers["Idempotency-Key"],
    calls[2].headers["Idempotency-Key"],
  );
});
test("conflict is surfaced and preserves version header", async () => {
  let headers;
  const api = createClient("test", null, async (p, o) => {
    headers = o.headers;
    return new Response(
      JSON.stringify({ error: { code: "CONFLICT", message: "private" } }),
      { status: 409 },
    );
  });
  await assert.rejects(
    () => api.send("/garments/id", {}, "PATCH", 7),
    (e) =>
      e.status === 409 &&
      e.code === "CONFLICT" &&
      !e.message.includes("private"),
  );
  assert.equal(headers["If-Match"], "7");
});
test("unauthorized response clears user session", async () => {
  let expired = false;
  const api = createClient(
    "old",
    () => (expired = true),
    async () => new Response("{}", { status: 401 }),
  );
  await assert.rejects(() => api.get("/home"));
  assert.equal(expired, true);
});
test("read failures do not invent successful data", async () => {
  const api = createClient(
    null,
    null,
    async () => new Response("{}", { status: 503 }),
  );
  await assert.rejects(
    () => api.get("/home"),
    (e) => e.status === 503,
  );
});
test("204 deletion returns null without JSON parsing", async () => {
  const api = createClient(
    null,
    null,
    async () => new Response(null, { status: 204 }),
  );
  assert.equal(
    await api.send("/style-references/id", undefined, "DELETE"),
    null,
  );
});
test("upload rejects unsupported or oversize file before requesting intent", async () => {
  await assert.rejects(() =>
    upload({}, { type: "text/html", size: 100 }, "GARMENT"),
  );
  await assert.rejects(() =>
    upload({}, { type: "image/png", size: 10485761 }, "GARMENT"),
  );
});
