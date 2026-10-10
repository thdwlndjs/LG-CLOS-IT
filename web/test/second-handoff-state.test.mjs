import assert from "node:assert/strict";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});
after(() => server.close());
const { DemoApp, emptyUI } = await server.ssrLoadModule(
  "/src/mirror/source/core/app.ts",
);
const { outfitAssetRefs } = await server.ssrLoadModule(
  "/src/mirror/source/core/outfitAssets.ts",
);
const { describeOutfitCard } = await server.ssrLoadModule(
  "/src/mirror/source/outfitCardPresentation.ts",
);
const { confirmedTimestamp } = await server.ssrLoadModule(
  "/src/mirror/source/secondHandoffActions.ts",
);
const asset = (id) => ({
  id,
  version: 1,
  source: "packaged",
  url: `/assets/${id}.png`,
});
const garment = (id, category, ownerId = "me") => ({
  id,
  category,
  ownerId,
  name: id,
  color: "BLACK",
  features: [],
  material: "",
  size: "",
  location: "",
  careNotes: "",
  revision: 1,
  provenance: {
    location: "unconfirmed",
    size: "unconfirmed",
    care: "unconfirmed",
  },
  asset: asset(id),
});
const initial = () => ({
  schemaVersion: 1,
  activeProfileId: "me",
  profiles: [{ id: "me", name: "Me" }],
  garments: [
    garment("top", "top"),
    garment("bottom", "bottom"),
    garment("shared", "outer", "another-device-member"),
    garment("dress", "dress"),
  ],
  outfits: [],
  events: [],
  registrationDrafts: {},
  outfitDrafts: {},
  ui: { me: emptyUI() },
  receipts: [],
  intents: {},
  revisionReceipts: {},
});
async function remoteApp() {
  let snapshot = initial(),
    saveCalls = 0;
  const drafts = {};
  const remote = {
    mode: "mock",
    state: async () => ({
      ...structuredClone(snapshot),
      outfitDrafts: structuredClone(drafts),
    }),
    putDraft: async (d) => {
      drafts[d.ownerId] = structuredClone(d);
    },
    discardDraft: async () => {},
    saveOutfit: async () => {
      saveCalls++;
      throw Error("must not reach server for stale images");
    },
  };
  const app = new DemoApp(undefined, () => initial());
  await app.configureRemote(remote);
  return {
    app,
    replace: (value) => {
      snapshot = value;
    },
    calls: () => saveCalls,
  };
}
test("device-scoped selection retains actual owner and exact shared image metadata", async () => {
  const { app } = await remoteApp();
  app.startBlankOutfit();
  app.setOutfitItem("top", "top");
  app.setOutfitItem("bottom", "bottom");
  app.setOutfitItem("outer", "shared");
  assert.equal(app.garment("shared").ownerId, "another-device-member");
  const draft = app.outfitDraft();
  assert.equal(draft.assetIds.shared, "shared");
  assert.equal(draft.assetVersions.shared, 1);
  const view = describeOutfitCard({
    outfit: draft,
    ownerId: "me",
    garments: app.garments(),
    deviceScoped: true,
  });
  assert.equal(view.reuseStatus, "ready");
  assert.ok(view.slots.find((row) => row.garmentId === "shared").asset);
  assert.throws(() => outfitAssetRefs(draft, app.garments()), /허용된/);
  assert.doesNotThrow(() => outfitAssetRefs(draft, app.garments(), true));
});
test("changed photo ID with unchanged version rejects stale remote save before any mutation", async () => {
  const { app, replace, calls } = await remoteApp();
  app.startBlankOutfit();
  app.setOutfitItem("top", "top");
  app.setOutfitItem("bottom", "bottom");
  const revision = app.outfitDraft().revision,
    updated = initial();
  updated.garments[0].asset = asset("replacement");
  replace(updated);
  const repository = app.repository;
  await app.reloadRemote();
  assert.equal(app.repository, repository);
  await assert.rejects(app.saveOutfit("same-command"), /사진이 바뀌/);
  assert.equal(calls(), 0);
  assert.equal(app.outfitDraft().revision, revision);
});
test("selecting the same exact photo does not invalidate a comparison draft", async () => {
  const { app } = await remoteApp();
  app.startBlankOutfit();
  app.setOutfitItem("top", "top");
  const before = structuredClone(app.outfitDraft());
  app.setOutfitItem("top", "top");
  assert.deepEqual(app.outfitDraft(), before);
});
test("DRESS is supported by current remote contract and explicitly excludes separates", async () => {
  const { app } = await remoteApp();
  app.startBlankOutfit();
  app.setOutfitItem("dress", "dress");
  assert.throws(() => app.setOutfitItem("top", "top"), /원피스/);
  app.removeOutfitItem("dress");
  app.setOutfitItem("top", "top");
  assert.throws(() => app.setOutfitItem("dress", "dress"), /상의·하의/);
});
test("actual timestamps require user time and reject rolled-over dates", () => {
  assert.equal(
    confirmedTimestamp("2026-10-10", "10:15"),
    "2026-10-10T10:15:00+09:00",
  );
  assert.throws(() => confirmedTimestamp("2026-02-31", "10:15"));
  assert.throws(() => confirmedTimestamp("2026-10-10", ""));
  assert.throws(() => confirmedTimestamp("2026-10-10", "24:00"));
  assert.equal(
    confirmedTimestamp("2026-10-10", "10:15:32"),
    "2026-10-10T10:15:32+09:00",
  );
  assert.throws(() => confirmedTimestamp("2026-10-10", "10:15:99"));
});
