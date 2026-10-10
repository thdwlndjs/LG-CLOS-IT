import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => server.close());
const { winterHomeScenario, confirmedHomeUsage } = await server.ssrLoadModule(
  "/src/mirror/source/homeRecommendations.ts",
);
const garment = (id, category, ownerId = "me", photo = true) => ({
  id,
  category,
  ownerId,
  name: id,
  asset: photo ? { id: "asset-" + id, version: 2, url: "/image" } : null,
});

test("Mock recommendations only refer to supplied accessible photos and never mutate real data", () => {
  const garments = [
    garment("top", "top"),
    garment("bottom", "bottom"),
    garment("shared", "outer", "other"),
  ];
  const snapshot = structuredClone(garments);
  const demo = winterHomeScenario(garments, "me", "2026-10-10");
  assert.deepEqual(garments, snapshot);
  assert.deepEqual(demo.outfit.items, {
    top: "top",
    bottom: "bottom",
    outer: "shared",
  });
  assert.equal(demo.outfit.assetIds.shared, "asset-shared");
  assert.equal(demo.outfit.assetVersions.shared, 2);
  assert.equal(garments[2].ownerId, "other");
  assert.match(demo.outfit.id, /^home-demo:/);
});
test("Missing photos and incomplete looks do not generate a fake complete recommendation", () => {
  assert.equal(
    winterHomeScenario(
      [garment("top", "top"), garment("bottom", "bottom", "me", false)],
      "me",
      "2026-10-10",
    ).outfit,
    null,
  );
  const dress = winterHomeScenario(
    [garment("dress", "dress"), garment("outer", "outer")],
    "me",
    "2026-10-10",
  ).outfit;
  assert.deepEqual(dress.items, { dress: "dress", outer: "outer" });
});
test("Mock usage counts remain stable after a wardrobe reorder", () => {
  const garments = [garment("top", "top"), garment("bottom", "bottom")];
  const counts = (input) =>
    Object.fromEntries(
      winterHomeScenario(input, "me", "2026-10-10").usage.map((r) => [
        r.garmentId,
        r.count,
      ]),
    );
  assert.deepEqual(counts(garments), counts([...garments].reverse()));
});
test("Actual use counters exclude plans, selections, cancelled and scenario events", () => {
  const events = [
    {
      ownerId: "me",
      kind: "wear",
      garmentIds: ["top", "bottom"],
      inputSource: "user_confirmed",
    },
    {
      ownerId: "me",
      kind: "care",
      garmentId: "top",
      inputSource: "user_confirmed",
    },
    { ownerId: "me", kind: "plan" },
    { ownerId: "me", kind: "movement" },
    { ownerId: "me", kind: "wear", voided: true },
    { ownerId: "me", kind: "wear", inputSource: "scenario_fixture" },
    { ownerId: "other", kind: "wear" },
  ];
  const result = confirmedHomeUsage(events, "me", [
    garment("top", "top"),
    garment("bottom", "bottom"),
  ]);
  assert.equal(result.wearRecords, 1);
  assert.equal(result.careRecords, 1);
  assert.deepEqual(
    result.perGarment.map((r) => r.count),
    [1, 1],
  );
});
