import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { chromium } from "playwright";
import { preview } from "vite";

const results = resolve("../test-results");
await mkdir(results, { recursive: true });
const fixture = JSON.parse(
  execFileSync(
    "docker",
    [
      "exec",
      process.env.INTEGRATION_CONTAINER,
      "cat",
      "/tmp/integration-test-credentials.json",
    ],
    { encoding: "utf8" },
  ),
);
const base = process.env.INTEGRATION_API;
let token = "";
const checks = [];
const evidence = {
  checks,
  paid_api_called: false,
  hardware: "MOCK",
  ui_checks: [],
};
const save = () =>
  writeFile(
    resolve(results, "integration-browser-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
async function req(method, path, body, key = randomUUID(), auth = token) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
      ...(body
        ? { "Content-Type": "application/json", "Idempotency-Key": key }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${v.error?.code}`);
  return v;
}
async function step(name, action) {
  await action();
  checks.push({ name, status: "passed" });
  await save();
  console.log("PASS " + name);
}
const auth = async (station = 1, user = 1) =>
  req(
    "POST",
    "/integration/login",
    {
      login: `integration-${user}`,
      password: fixture.password,
      station_id: `90000000-0000-4000-8000-${String(station).padStart(12, "0")}`,
      station_credential: fixture.credential,
    },
    randomUUID(),
    "",
  );
const bytes = await readFile(resolve(results, "integration-fixture.png"));
async function upload(purpose) {
  const i = await req("POST", "/assets/upload-intents", {
    file_name: "synthetic-test.png",
    content_type: "image/png",
    size_bytes: bytes.length,
    purpose,
  });
  const r = await fetch(i.upload_url, {
    method: "PUT",
    headers: i.required_headers,
    body: bytes,
  });
  assert.ok(r.ok);
  return req("POST", `/assets/${i.asset_id}/finalize`, {
    checksum_sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
async function poll(path, authToken = token) {
  for (let i = 0; i < 180; i++) {
    const j = await req("GET", path, undefined, randomUUID(), authToken);
    if (["SUCCEEDED", "READY"].includes(j.status)) return j;
    assert.ok(
      !["FAILED", "TIMED_OUT", "CANCELLED"].includes(j.status),
      `Job ${j.status}: ${j.error?.code || j.error_code}`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Job timeout");
}
const count = () =>
  JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        process.env.INTEGRATION_CONTAINER,
        "python",
        "-c",
        `import asyncio,json
from sqlalchemy import text
from app.core.config import load_settings
from app.infrastructure.db.session import Database
async def run():
 d=Database(load_settings())
 try:
  async with d.sessions() as s:
   counts={t:await s.scalar(text('SELECT count(*) FROM wardrobe.'+t)) for t in ['garment','outfit','outfit_card','wear_event']}
   counts['plan_events']=await s.scalar(text("SELECT count(*) FROM wardrobe.outfit_session_event WHERE lower(event_type) LIKE '%plan%'"))
   print(json.dumps(counts))
 finally: await d.close()
asyncio.run(run())`,
      ],
      { encoding: "utf8" },
    ),
  );
let garments = [],
  person,
  outfit,
  session;
await step("1. personal login and device wardrobe", async () => {
  token = (await auth()).access_token;
  const d = await req("GET", "/integration/devices");
  assert.equal(d.items[0].id, fixture.device_id);
  const rows = await req("GET", "/garments?limit=100");
  assert.ok(rows.items.length >= 3);
  assert.ok(rows.items.every((g) => g.device_id === fixture.device_id));
});
await step("2. upload and register with real DB reread", async () => {
  const settings = await req("GET", "/settings");
  await req("PUT", "/settings", { ...settings, image_upload_consent: true });
  person = await upload("PERSON_VTON");
  for (const [i, category] of ["TOP", "BOTTOM"].entries()) {
    const asset = await upload("GARMENT");
    const g = await req("POST", "/garments", {
      owner_id: "20000000-0000-4000-8000-000000000001",
      device_id: fixture.device_id,
      name: `Integration ${category}`,
      category,
      color: "BLACK",
      image_asset_id: asset.asset_id,
      location_id: fixture.locations[i % fixture.locations.length],
    });
    await req("POST", "/garment-observations", {
      garment_id: g.id,
      location_id: fixture.locations[i % fixture.locations.length],
      sensor_type: "MANUAL",
      confidence: 1.0,
      observed_at: new Date().toISOString(),
      source_id: "integration-" + randomUUID(),
    });
    const read = await req("GET", "/garments/" + g.id);
    assert.equal(read.status, "UNKNOWN");
    assert.ok(read.image);
    garments.push(read);
  }
  assert.ok(count().garment >= 5);
});
await step(
  "3. locate actual slots, idempotent LED and automatic off",
  async () => {
    const g = garments[0];
    const located = await req("POST", "/garments/locate", { garment_id: g.id });
    assert.equal(located.items[0].status, "FOUND");
    const key = randomUUID();
    const body = {
      device_id: fixture.device_id,
      garment_ids: garments.map((g) => g.id),
    };
    const first = await req("POST", "/integration/led-commands", body, key);
    const replay = await req("POST", "/integration/led-commands", body, key);
    assert.equal(first.id, replay.id);
    assert.equal(first.anchor_ids.length, 2);
    await new Promise((r) => setTimeout(r, 2300));
    assert.deepEqual(
      (await req("GET", `/integration/devices/${fixture.device_id}/led-state`))
        .anchor_ids,
      [],
    );
  },
);
await step(
  "4. recommendation, Mock VTON, final selection and LEDs",
  async () => {
    for (const [i, category] of ["TOP", "BOTTOM"].entries()) {
      const id = "40000000-0000-4000-8000-" + String(i + 1).padStart(12, "0");
      const old = await req("GET", "/garments/" + id);
      const asset = await upload("GARMENT");
      const response = await fetch(base + "/api/v1/garments/" + id, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "If-Match": String(old.version),
        },
        body: JSON.stringify({
          owner_id: old.owner_id,
          device_id: fixture.device_id,
          category,
          color: old.color,
          image_asset_id: asset.asset_id,
          location_id: fixture.locations[i],
        }),
      });
      assert.ok(response.ok);
      garments[i] = await response.json();
      assert.equal(garments[i].status, "AVAILABLE");
    }
    const c = await req("POST", "/context-snapshots", {
      member_id: "20000000-0000-4000-8000-000000000001",
      timezone: "Asia/Seoul",
      mode: "MOCK",
    });
    const rec = await req("POST", "/outfit-recommendations", {
      member_id: "20000000-0000-4000-8000-000000000001",
      context_snapshot_id: c.id,
      limit: 5,
      constraints: {},
    });
    assert.ok(rec.candidates.length);
    outfit = await req("POST", "/outfits", {
      title: "Integration Look",
      status: "DRAFT",
      items: garments.map((g) => ({
        garment_id: g.id,
        slot: g.category,
        position: 0,
      })),
    });
    session = await req("POST", "/vton-sessions", {
      member_id: "20000000-0000-4000-8000-000000000001",
      source_screen: "OUTFIT_EDITOR",
      outfit_id: outfit.id,
      person_asset_id: person.asset_id,
    });
    const j = await req("POST", "/vton-jobs", {
      session_id: session.id,
      expected_revision: session.revision,
      person_asset_id: person.asset_id,
      outfit_id: session.outfit_id,
      provider: "MOCK",
    });
    const result = await poll("/jobs/" + j.job_id);
    assert.ok(result.result_asset);
    const image = await fetch(result.result_asset.read_url);
    assert.equal(image.headers.get("content-type"), "image/png");
    const before = count();
    await req("POST", `/vton-sessions/${session.id}/end`, {
      expected_revision: session.revision,
      final_outfit_id: session.outfit_id,
      save_outfit: false,
    });
    const after = count();
    assert.equal(after.wear_event, before.wear_event);
    await req("POST", "/integration/led-commands", {
      device_id: fixture.device_id,
      garment_ids: garments.map((g) => g.id),
    });
  },
);
await step("5. no implicit plan/wear events", async () => {
  assert.equal(count().wear_event, 0);
  assert.equal(count().plan_events, 0);
});
await step(
  "6. full purchase import and distinct-key duplicate prevention",
  async () => {
    const body = { device_id: fixture.device_id };
    const before = count().garment;
    const first = await req(
      "POST",
      "/integration/shopping/purchases/bulk-import",
      body,
    );
    assert.equal(first.counts.registered, 3);
    assert.equal(first.counts.needs_review, 2);
    assert.equal(first.counts.skipped, 2);
    const second = await req(
      "POST",
      "/integration/shopping/purchases/bulk-import",
      body,
    );
    assert.equal(second.counts.registered, 0);
    assert.equal(count().garment, before + 3);
  },
);
await step(
  "7. LIKED VTON without owned garment/outfit/card/wear creation",
  async () => {
    const before = count();
    const liked = await req("GET", "/integration/shopping/liked");
    const j = await req("POST", "/integration/shopping/liked/vton-jobs", {
      external_item_id: liked.items[0].id,
      person_asset_id: person.asset_id,
    });
    const r = await poll("/integration/shopping/liked/vton-jobs/" + j.job_id);
    assert.ok(r.result_asset);
    assert.deepEqual(count(), before);
  },
);
await step("8. rendered image card, save and public bearer share", async () => {
  const c = await req("POST", "/cards/drafts", {
    outfit_id: outfit.id,
    template_id: "minimal-v1",
  });
  const j = await req("POST", "/card-render-jobs", {
    card_id: c.id,
    output_format: "PNG",
    width: 1080,
    height: 1350,
  });
  await poll("/jobs/" + j.job_id);
  const saved = await req("POST", `/cards/${c.id}/save`, {
    title: "Integration Card",
    visibility: "SHAREABLE",
    reuse_outfit: false,
  });
  assert.ok(saved.is_saved && saved.image_asset && saved.share_url);
  const r = await fetch(new URL(saved.share_url, base));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.ok((await r.arrayBuffer()).byteLength > 1000);
});
await step(
  "9. another HOME station and family member access same wardrobe",
  async () => {
    for (const [station, user] of [
      [3, 1],
      [3, 2],
    ]) {
      const a = await auth(station, user);
      const rows = await req(
        "GET",
        "/garments?limit=100",
        undefined,
        randomUUID(),
        a.access_token,
      );
      assert.ok(rows.items.some((g) => g.id === garments[0].id));
      if (user === 2) {
        const body = {
          household_id: "10000000-0000-4000-8000-000000000001",
          member_id: "20000000-0000-4000-8000-000000000002",
          mode: "WEAR_PATTERN",
          dry_run: true,
          season: "ALL",
          analysis_window_days: 90,
          garment_ids: [garments[0].id],
        };
        const job = await req(
          "POST",
          "/storage-optimization-jobs",
          body,
          randomUUID(),
          a.access_token,
        );
        const done = await poll(`/jobs/${job.job_id}`, a.access_token);
        assert.ok(
          done.storage_result.blocked.some(
            (b) => b.garment_id === garments[0].id,
          ),
        );
        assert.deepEqual(done.storage_result.action_ids, []);
        const denied = await fetch(base + "/api/v1/storage-optimization-jobs", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + a.access_token,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ ...body, dry_run: false }),
        });
        assert.equal(denied.status, 404);
        const asFamily = (method, path, body) =>
          req(method, path, body, randomUUID(), a.access_token);
        const settings = await asFamily("GET", "/settings");
        await asFamily("PUT", "/settings", {
          ...settings,
          image_upload_consent: true,
        });
        const look = await asFamily("POST", "/outfits", {
          title: "Family device wardrobe card",
          status: "SAVED",
          items: garments.map((g) => ({
            garment_id: g.id,
            slot: g.category,
            position: 0,
          })),
        });
        const card = await asFamily("POST", "/cards/drafts", {
          outfit_id: look.id,
          template_id: "minimal-v1",
        });
        const render = await asFamily("POST", "/card-render-jobs", {
          card_id: card.id,
          output_format: "PNG",
          width: 1080,
          height: 1350,
        });
        await poll(`/jobs/${render.job_id}`, a.access_token);
        const saved = await asFamily("POST", `/cards/${card.id}/save`, {
          visibility: "SHAREABLE",
          reuse_outfit: false,
        });
        const shared = await fetch(new URL(saved.share_url, base));
        assert.equal(shared.status, 200);
        assert.equal(shared.headers.get("content-type"), "image/png");
      }
    }
  },
);
await step("10. STORE station cannot remotely control HOME LEDs", async () => {
  const a = await auth(2);
  const r = await fetch(base + "/api/v1/integration/led-commands", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + a.access_token,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      device_id: fixture.device_id,
      garment_ids: [garments[0].id],
    }),
  });
  assert.equal(r.status, 403);
});
await step(
  "security: unknown location, unbound station, bad credential, logout",
  async () => {
    const rows = await req("GET", "/garments?limit=100");
    const unlocated = rows.items.find((g) => !g.location_id);
    assert.ok(unlocated);
    const led = async (accessToken, garment) =>
      fetch(base + "/api/v1/integration/led-commands", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          device_id: fixture.device_id,
          garment_ids: [garment],
        }),
      });
    assert.equal((await led(token, unlocated.id)).status, 409);
    const free = await req("POST", "/integration/login", {
      login: "integration-1",
      password: fixture.password,
    });
    assert.equal((await led(free.access_token, garments[0].id)).status, 403);
    const bad = await fetch(base + "/api/v1/integration/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: "integration-1",
        password: fixture.password,
        station_id: "90000000-0000-4000-8000-000000000001",
        station_credential: "incorrect-credential",
      }),
    });
    assert.equal(bad.status, 401);
    await req(
      "POST",
      "/integration/logout",
      {},
      randomUUID(),
      free.access_token,
    );
    const revoked = await fetch(base + "/api/v1/integration/devices", {
      headers: { Authorization: "Bearer " + free.access_token },
    });
    assert.equal(revoked.status, 401);
  },
);

const server = await preview();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  const errors = [];
  const externalHosts = new Set();
  page.on("request", (request) => {
    const hostname = new URL(request.url()).hostname;
    if (hostname && !["localhost", "127.0.0.1"].includes(hostname))
      externalHosts.add(hostname);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (r) => {
    if (r.status() >= 400) {
      const body = await r.json().catch(() => null);
      console.log(
        "HTTP",
        r.status(),
        new URL(r.url()).pathname,
        body?.error?.code,
        body?.error?.message,
      );
    }
  });
  await page.goto(`http://127.0.0.1:${process.env.WEB_PORT || 5174}`);
  await page.getByRole("button", { name: "마이", exact: true }).click();
  await page.getByRole("button", { name: "내 계정", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("계정", { exact: true }).fill("integration-1");
  await dialog.getByLabel("비밀번호", { exact: true }).fill(fixture.password);
  await dialog
    .getByLabel("접속 기기 ID · 선택")
    .fill("90000000-0000-4000-8000-000000000001");
  await dialog.getByLabel("기기 인증 · 선택").fill(fixture.credential);
  await dialog.getByRole("button", { name: "내 계정으로 로그인" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".mx-source")
      ?.textContent?.includes("\ub0b4 \uacc4\uc815"),
  );
  await page.getByRole("button", { name: "\uc637\uc7a5", exact: true }).click();
  await page.locator(".mg-count").waitFor();
  await page.screenshot({
    path: resolve(results, "integration-mirror-1920.png"),
  });
  assert.deepEqual(errors, []);
  evidence.ui_checks.push({
    name: "real browser personal login + server wardrobe",
    status: "passed",
  });
  const uiCheck = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log(
        "UI failure:",
        name,
        await page.getByRole("status").allTextContents(),
      );
      await page.screenshot({
        path: resolve(results, "integration-ui-failure.png"),
      });
      throw e;
    }
    evidence.ui_checks.push({ name, status: "passed" });
    await save();
  };
  await uiCheck(
    "browser registration upload, DB reread and search",
    async () => {
      await page
        .getByRole("button", { name: "사진 등록", exact: true })
        .click();
      const registration = page.getByRole("region", { name: "의류 등록" });
      await registration.getByRole("checkbox").check();
      await registration
        .locator('input[type="file"]')
        .setInputFiles(resolve(results, "integration-fixture.png"));
      try {
        await registration
          .getByText("사진을 선택했어요. 옷 등록은 마지막 저장에서 확정해요.")
          .waitFor();
      } catch (e) {
        console.log(
          "Registration status:",
          await registration.getByRole("status").allTextContents(),
        );
        await page.screenshot({
          path: resolve(results, "integration-registration-failure.png"),
        });
        throw e;
      }
      await registration
        .getByRole("button", { name: "다음", exact: true })
        .click();
      await registration
        .getByLabel("옷 이름", { exact: true })
        .fill("Browser QA Top");
      await registration
        .getByLabel("색상 · 필수", { exact: true })
        .fill("BLACK");
      await registration
        .getByRole("button", { name: "다음", exact: true })
        .click();
      await registration
        .getByRole("button", { name: "다음", exact: true })
        .click();
      await registration
        .getByRole("button", { name: "의류 저장", exact: true })
        .click();
      await registration
        .getByRole("button", { name: "목록으로", exact: true })
        .waitFor();
      const rows = await req("GET", "/garments?limit=100");
      const g = rows.items.find((row) => row.name === "Browser QA Top");
      assert.ok(
        g?.image && g.device_id === fixture.device_id && g.location_id === null,
      );
      await registration
        .getByRole("button", { name: "목록으로", exact: true })
        .click();
      await page.getByRole("button", { name: "옷 검색", exact: true }).click();
      await page.getByPlaceholder("옷 이름").fill("Browser QA Top");
      await page
        .getByRole("button", { name: "Browser QA Top 선택", exact: true })
        .waitFor();
    },
  );
  const openPanel = async () => {
    await page.getByRole("button", { name: "마이", exact: true }).click();
    await page.getByRole("button", { name: "내 계정", exact: true }).click();
    return page.getByRole("region", { name: "통합 기능" });
  };
  // The original seed's shoes have no image; supply a synthetic test upload
  // through the real API before asking the browser to try the complete look.
  {
    const id = "40000000-0000-4000-8000-000000000003";
    const g = await req("GET", `/garments/${id}`);
    const image = await upload("GARMENT");
    const patched = await fetch(base + `/api/v1/garments/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "If-Match": '"' + g.version + '"',
      },
      body: JSON.stringify({
        owner_id: g.owner_id,
        category: g.category,
        color: g.color,
        image_asset_id: image.asset_id,
        location_id: fixture.locations[0],
      }),
    });
    assert.equal(patched.status, 200);
  }
  await uiCheck(
    "browser recommendation and explicit candidate selection",
    async () => {
      await page.getByRole("button", { name: "코디", exact: true }).click();
      await page
        .getByRole("button", { name: "+ 새 조합", exact: true })
        .click();
      await page
        .getByRole("button", { name: "작은 코디 도움", exact: true })
        .click();
      await page
        .getByRole("button", { name: "현재 조건으로 도움 요청", exact: true })
        .click();
      await page
        .getByRole("button", { name: "이 제안 선택", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "이 제안 선택", exact: true })
        .click();
    },
  );
  const panel = await openPanel();
  await uiCheck(
    "browser purchase replay, LIKED VTON and no ownership conversion",
    async () => {
      await panel
        .getByRole("button", { name: "구매 내역 전체 조회", exact: true })
        .click();
      await panel
        .getByRole("status")
        .filter({ hasText: "Synthetic Mock 구매 내역" })
        .waitFor();
      const before = count();
      await panel
        .getByRole("button", { name: "구매 내역 일괄 등록", exact: true })
        .click();
      await panel.getByRole("status").filter({ hasText: "등록 0건" }).waitFor();
      assert.equal(count().garment, before.garment);
      await panel
        .getByRole("checkbox", { name: "이미지 비공개 업로드 동의" })
        .check();
      await panel
        .getByLabel("인물 사진", { exact: true })
        .setInputFiles(resolve(results, "integration-fixture.png"));
      await panel
        .getByRole("status")
        .filter({ hasText: "인물 사진 업로드 완료" })
        .waitFor();
      await uiCheck(
        "browser owned VTON, finalization LEDs, rendered saved share card",
        async () => {
          await panel
            .getByRole("button", { name: "Mock VTON 실행", exact: true })
            .click();
          await panel
            .getByRole("status")
            .filter({ hasText: "Mock VTON 성공 · 실제 피팅 아님" })
            .waitFor({ timeout: 60000 });
          const beforeEnd = count();
          await panel
            .getByRole("button", { name: "코디 확정 · LED", exact: true })
            .click();
          await panel
            .getByRole("status")
            .filter({ hasText: "코디 확정 · 착용 예정/실제 착용 기록 없음" })
            .waitFor();
          assert.equal(count().wear_event, beforeEnd.wear_event);
          assert.equal(count().plan_events, beforeEnd.plan_events);
          await panel
            .getByRole("button", {
              name: "코디카드 생성·저장·공유",
              exact: true,
            })
            .click();
          await panel
            .getByRole("status")
            .filter({ hasText: "코디카드 이미지 생성·저장 완료" })
            .waitFor({ timeout: 60000 });
          const href = await panel
            .getByRole("link", { name: "코디카드 공유 이미지 열기" })
            .getAttribute("href");
          const shared = await page.request.get(new URL(href, page.url()).href);
          assert.equal(shared.status(), 200);
          assert.equal(shared.headers()["content-type"], "image/png");
        },
      );
      const beforeLiked = count();
      await panel
        .getByRole("button", { name: "LIKED 조회", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "이 상품 Mock VTON", exact: true })
        .click();
      await panel
        .getByRole("status")
        .filter({ hasText: "LIKED Mock VTON 성공" })
        .waitFor({ timeout: 60000 });
      await panel.getByRole("img", { name: "서버 생성 이미지 결과" }).waitFor();
      assert.deepEqual(count(), beforeLiked);
    },
  );
  assert.deepEqual(errors, []);
  await uiCheck(
    "browser edit, care guide, verified location LED and storage proposal",
    async () => {
      await panel
        .getByLabel("관리할 의류", { exact: true })
        .selectOption(garments[0].id);
      await panel
        .getByLabel("이름 · 선택", { exact: true })
        .fill("Browser Edited Shirt");
      await panel.getByLabel("색상", { exact: true }).fill("WHITE");
      await panel
        .getByRole("button", { name: "의류 정보 수정", exact: true })
        .click();
      await panel
        .getByRole("status")
        .filter({ hasText: "의류 수정 완료" })
        .waitFor();
      assert.equal(
        (await req("GET", `/garments/${garments[0].id}`)).name,
        "Browser Edited Shirt",
      );
      await panel
        .getByRole("button", { name: "특별 관리 가이드", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "보관 위치 조회", exact: true })
        .click();
      await panel
        .getByRole("status")
        .filter({ hasText: "등록된 보관 위치만 선택합니다." })
        .waitFor();
      await panel
        .getByLabel("확인한 보관 위치", { exact: true })
        .selectOption(fixture.locations[0]);
      await panel
        .getByRole("button", { name: "확인한 위치 저장", exact: true })
        .click();
      await panel
        .getByRole("status")
        .filter({ hasText: "명시적으로 확인한 위치 저장 완료" })
        .waitFor();
      await panel
        .getByRole("button", { name: "이 의류 위치 LED", exact: true })
        .click();
      await panel
        .getByRole("status")
        .filter({ hasText: "확인된 슬롯 LED 점등" })
        .waitFor();
      const leds = await req(
        "GET",
        `/integration/devices/${fixture.device_id}/led-state`,
      );
      assert.deepEqual(leds.anchor_ids, ["L1_RAIL_01"]);
      await panel
        .getByRole("button", { name: "보관·회수 추천", exact: true })
        .click();
      await panel
        .getByRole("status")
        .filter({ hasText: "이동은 실행하지 않았습니다." })
        .waitFor({ timeout: 60000 });
    },
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: resolve(results, "integration-actions-1920.png"),
  });
  await uiCheck("browser logout clears private wardrobe", async () => {
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.getByRole("button", { name: "옷장", exact: true }).click();
    await page.locator(".mg-count").filter({ hasText: "0벌" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Browser Edited Shirt 선택", exact: true })
        .count(),
      0,
    );
  });
  evidence.external_browser_hosts = [...externalHosts];
  assert.deepEqual(evidence.external_browser_hosts, []);
} finally {
  await browser.close();
  await server.close();
  await save();
}
