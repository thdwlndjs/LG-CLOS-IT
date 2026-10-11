import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => server.close());
const { captureRequest, PocVtonFlow, followup } = await server.ssrLoadModule(
  "/src/mirror/source/pocVton.ts",
);
const sources = [
  { id: "top", category: "top", revision: 2, asset: { id: "a" } },
  { id: "bottom", category: "bottom", revision: 3, asset: { id: "b" } },
];
const liked = sources.map((g) => ({ ...g, ownerId: "member" }));
const draft = () => ({
  draftId: "draft",
  revision: 1,
  ownerId: "member",
  items: { top: "top", bottom: "bottom" },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function setup() {
  const posts = [],
    gate = deferred();
  let active = true,
    fail = false;
  const flow = new PocVtonFlow(
    {
      request: async (path, options) => {
        posts.push({ path, ...options });
        if (path.endsWith("/cancel")) return {};
        if (fail) {
          fail = false;
          throw Object.assign(Error("network"), { status: 0 });
        }
        await gate.promise;
        return { job_id: "job" };
      },
      get: async () => ({
        job_id: "job",
        status: "SUCCEEDED",
        is_mock: true,
        result_semantics: "MOCK_RECEIPT_NOT_REAL_TRY_ON",
        result_asset: {},
        request_snapshot: {
          request_id: "job",
          member_id: "member",
          client_context_id: flow.context,
          draft_revision: posts.find((p) => !p.path.endsWith("/cancel")).body
            .draft_revision,
          contains_liked: false,
          items: [],
        },
      }),
    },
    "member",
    () => active,
    async () => "blob:receipt",
  );
  return {
    flow,
    posts,
    gate,
    deactivate: () => {
      active = false;
    },
    fail: () => {
      fail = true;
    },
  };
}
test("selection alone submits nothing; immutable kind/id request", () => {
  const { flow, posts } = setup(),
    d = draft();
  const body = captureRequest(d, sources, liked, "person", flow.context);
  for (let n = 0; n < 10; n++) {
    d.items.top = `other-${n}`;
    d.revision++;
  }
  assert.equal(body.items[0].id, "top");
  assert.throws(() => {
    body.items[0].id = "mutate";
  });
  assert.equal(posts.length, 0);
});
test("OWNED/LIKED/mixed identities; six-slot and DRESS conflicts", () => {
  const d = draft();
  d.externalItems = { bottom: { externalItemId: "bottom" } };
  delete d.items.bottom;
  assert.deepEqual(
    captureRequest(d, sources, liked, "p", "c").items.map((i) => i.kind),
    ["OWNED", "LIKED"],
  );
  d.externalItems.top = { externalItemId: "top" };
  delete d.items.top;
  assert.equal(
    captureRequest(d, sources, liked, "p", "c").items.every(
      (i) => i.kind === "LIKED",
    ),
    true,
  );
  d.items.bag = "top";
  assert.throws(() => captureRequest(d, sources, liked, "p", "c"));
  delete d.items.bag;
  d.items.dress = "top";
  assert.throws(() => captureRequest(d, sources, liked, "p", "c"));
});
test("pending selection changes are retained and double execution is blocked", async () => {
  const { flow, posts, gate } = setup(),
    d = draft();
  const a = captureRequest(d, sources, liked, "p", flow.context);
  const work = flow.execute(a);
  d.revision = 7;
  assert.equal(await flow.execute({ ...a, draft_revision: 7 }), null);
  gate.resolve();
  const result = await work;
  assert.equal(posts.length, 1);
  assert.equal(result.request_snapshot.draft_revision, 1);
  assert.equal(d.revision, 7);
});
test("late POST after exit is cancelled through original captured client", async () => {
  const { flow, posts, gate } = setup();
  const work = flow.execute(
    captureRequest(draft(), sources, liked, "p", flow.context),
  );
  flow.close();
  gate.resolve();
  assert.equal(await work, null);
  assert.equal(flow.displayed, null);
  assert.equal(posts.at(-1).path, "/integration/vton-jobs/job/cancel");
});
test("ambiguous network retry retains intent body/key despite changed draft", async () => {
  const { flow, posts, gate, fail } = setup();
  fail();
  const body = captureRequest(draft(), sources, liked, "p", flow.context);
  await assert.rejects(flow.execute(body));
  gate.resolve();
  await flow.execute({ ...body, draft_revision: 99 });
  assert.equal(posts[0].key, posts[1].key);
  assert.equal(posts[1].body.draft_revision, 1);
});
test("failed B retains previously displayed A", async () => {
  const { flow, gate } = setup();
  gate.resolve();
  const body = captureRequest(draft(), sources, liked, "p", flow.context);
  await flow.execute(body);
  const a = flow.displayed;
  flow.client.get = async () => ({
    status: "FAILED",
    error: { code: "fixture" },
  });
  await assert.rejects(flow.execute({ ...body, draft_revision: 2 }));
  assert.equal(flow.displayed, a);
});
test("result authority never falls back to draft and LIKED is blocked", () => {
  assert.equal(followup(null).allowed, false);
  const result = { job_id: "j", request_snapshot: { contains_liked: true } };
  assert.equal(followup(result).allowed, false);
  result.request_snapshot.contains_liked = false;
  assert.equal(followup(result).jobId, "j");
  assert.equal(followup(result).snapshot, result.request_snapshot);
});
test("image decode failure retains A and does not create another generation job", async () => {
  const { flow, gate, posts } = setup();
  gate.resolve();
  const body = captureRequest(draft(), sources, liked, "p", flow.context);
  await flow.execute(body);
  const a = flow.displayed;
  flow.loadImage = async () => {
    throw Error("decode");
  };
  await assert.rejects(flow.execute({ ...body, draft_revision: 2 }));
  assert.equal(flow.displayed, a);
  assert.equal(posts.length, 2);
});
test("profile switch rejects an old result even without a draft revision change", async () => {
  const { flow, gate, deactivate } = setup();
  const work = flow.execute(
    captureRequest(draft(), sources, liked, "p", flow.context),
  );
  deactivate();
  gate.resolve();
  assert.equal(await work, null);
  assert.equal(flow.displayed, null);
});
