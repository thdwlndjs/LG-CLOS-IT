import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";

// This runner requires the disposable DB/container provisioned by verify_second_handoff.py.
const container = process.env.INTEGRATION_CONTAINER;
assert.match(
  container || "",
  /^smart-wardrobe-second-handoff-verify-[a-f0-9]{32}$/,
);
const fixture = JSON.parse(
  execFileSync(
    "docker",
    ["exec", container, "cat", "/tmp/integration-test-credentials.json"],
    { encoding: "utf8" },
  ),
);
const base = process.env.INTEGRATION_API;
assert.match(base || "", /^http:\/\/127\.0\.0\.1:\d+$/);
const results = resolve("../test-results"),
  checks = [],
  errors = [];
let token = "";
const owner = "20000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000002";
const image = await readFile(resolve(results, "integration-fixture.png"));
const save = async () => {
  const path = resolve(results, "second-handoff-browser-evidence.json");
  await writeFile(
    path + ".tmp",
    JSON.stringify(
      {
        checks,
        errors,
        paid_api_called: false,
        hardware: "MOCK",
        isolated: true,
        viewport: process.env.INTEGRATION_MOBILE === "1" ? "390x844" : "1672x941",
      },
      null,
      2,
    ),
  );
  await (await import("node:fs/promises")).rename(path + ".tmp", path);
};
async function req(method, path, body, key = randomUUID(), extra = {}) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body
        ? { "Content-Type": "application/json", "Idempotency-Key": key }
        : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${value.error?.code}`,
  );
  return value;
}
const auth = async (user = 1, station = 1) => {
  const r = await req("POST", "/integration/login", {
    login: `integration-${user}`,
    password: fixture.password,
    station_id: `90000000-0000-4000-8000-${String(station).padStart(12, "0")}`,
    station_credential: fixture.credential,
  });
  token = r.access_token;
  return r;
};
async function upload(purpose = "GARMENT") {
  const settings = await req("GET", "/settings");
  await req("PUT", "/settings", { ...settings, image_upload_consent: true });
  const intent = await req("POST", "/assets/upload-intents", {
    file_name: "synthetic.png",
    content_type: "image/png",
    size_bytes: image.length,
    purpose,
  });
  assert.ok(
    (
      await fetch(intent.upload_url, {
        method: "PUT",
        headers: intent.required_headers,
        body: image,
      })
    ).ok,
  );
  return req("POST", `/assets/${intent.asset_id}/finalize`, {
    checksum_sha256: createHash("sha256").update(image).digest("hex"),
  });
}
function db(code) {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        container,
        "python",
        "-c",
        `import asyncio,json\nfrom sqlalchemy import text\nfrom app.core.config import load_settings\nfrom app.infrastructure.db.session import Database\nasync def run():\n settings=load_settings()\n assert settings.app_env=='test' and settings.database_url.get_secret_value().rsplit('/',1)[-1].startswith('wardrobe_test_')\n database=Database(settings)\n try:\n  async with database.sessions.begin() as s:\n${code}\n finally: await database.close()\nasyncio.run(run())`,
      ],
      { encoding: "utf8" },
    ),
  );
}
const counts = () =>
  db(
    "   print(json.dumps({name:await s.scalar(text('SELECT count(*) FROM wardrobe.'+name)) for name in ['garment','outfit_card','wear_event','care_event']}))",
  );
let browser, server, page, ownTop, bottom, sharedOuter;
async function step(name, action) {
  try {
    await action();
    checks.push({ name, status: "passed" });
    console.log("PASS " + name);
  } catch (e) {
    checks.push({ name, status: "failed" });
    if (page)
      console.log(
        "UI_STATUS",
        await page.locator("[role=status]").allTextContents(),
      );
    if (page)
      await page.screenshot({
        path: resolve(results, "second-handoff-failure.png"),
      });
    throw e;
  } finally {
    await save();
  }
}
async function loginPage(station = 1, user = 1) {
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole("button", { name: "마이", exact: true }).click();
  await page.getByRole("button", { name: "내 계정", exact: true }).click();
  await page.getByLabel("계정", { exact: true }).fill(`integration-${user}`);
  await page.getByLabel("비밀번호", { exact: true }).fill(fixture.password);
  await page
    .getByLabel("접속 기기 ID · 선택", { exact: true })
    .fill(`90000000-0000-4000-8000-${String(station).padStart(12, "0")}`);
  await page
    .getByLabel("기기 인증 · 선택", { exact: true })
    .fill(fixture.credential);
  await page
    .getByRole("button", { name: "내 계정으로 로그인", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-profile-id]")
      ?.getAttribute("data-profile-id")
      ?.startsWith("20000000"),
  );
  if (await page.getByRole("dialog").count())
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "닫기", exact: true })
      .click();
}
try {
  await step(
    "isolated fixtures, shared device garments and private images",
    async () => {
      for (const [user, category, name] of [
        [1, "TOP", "QA Top"],
        [1, "BOTTOM", "QA Bottom"],
        [2, "OUTER", "QA Shared Outer"],
      ]) {
        await auth(user);
        const asset = await upload();
        const g = await req("POST", "/garments", {
          owner_id: user === 1 ? owner : other,
          device_id: fixture.device_id,
          name,
          category,
          color: "BLACK",
          image_asset_id: asset.asset_id,
          location_id: fixture.locations[0],
        });
        await req("POST", "/garment-observations", {
          garment_id: g.id,
          location_id: fixture.locations[0],
          sensor_type: "MANUAL",
          confidence: 1,
          observed_at: new Date().toISOString(),
          source_id: "second-handoff-" + randomUUID(),
        });
        if (category === "TOP") ownTop = g;
        else if (category === "BOTTOM") bottom = g;
        else sharedOuter = g;
      }
      const ids = [ownTop.id, bottom.id, sharedOuter.id];
      ids.forEach((id) => assert.match(id, /^[a-f0-9-]{36}$/));
      db(
        `   await s.execute(text("UPDATE wardrobe.garment_state SET status='AVAILABLE' WHERE garment_id IN (${ids.map((id) => "'" + id + "'").join(",")})"))\n   print('{}')`,
      );
      await auth();
      assert.ok(
        (await req("GET", "/garments?limit=100")).items.some(
          (g) => g.id === sharedOuter.id && g.owner_id === other,
        ),
      );
    },
  );
  server = await preview({
    preview: { host: "127.0.0.1", port: 5174, strictPort: true },
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: process.env.INTEGRATION_MOBILE === "1" ? { width: 390, height: 844 } : { width: 1672, height: 941 } });
  page.setDefaultTimeout(15000);
  page.on("response", async (response) => {
    if (response.status() >= 400 && response.url().includes("/care-schedules"))
      console.log(
        "CARE_ERROR",
        response.status(),
        new URL(response.url()).pathname,
        await response.text(),
      );
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/vton-jobs")) {
      const body = r.postDataJSON();
      assert.ok(!body.provider || body.provider === "MOCK");
    }
  });
  await step(
    "personal login, wardrobe image display and preserved mirror geometry",
    async () => {
      await loginPage();
      await page.getByRole("button", { name: "옷장", exact: true }).click();
      await page
        .locator(`button[data-garment-id="${sharedOuter.id}"]`)
        .waitFor();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll(".mirror-photo img")).some(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
      const geometry = await page.locator(".photo-mirror").evaluate((el) => ({
        left: el.style.left,
        top: el.style.top,
        width: el.style.width,
        height: el.style.height,
      }));
      if (process.env.INTEGRATION_MOBILE === "1") {
        assert.equal(geometry.left, "0px");
        assert.equal(geometry.top, "0px");
        assert.equal(geometry.width, "100%");
        assert.equal(geometry.height, "100%");
      } else assert.ok(
        geometry.left.startsWith("42.7033") &&
          geometry.top.startsWith("2.9755") &&
          geometry.width.startsWith("14.8325") &&
          geometry.height.startsWith("87.5664"),
      );
      await page.screenshot({
        path: resolve(results, "second-handoff-wardrobe.png"),
      });
    },
  );
  await step(
    "home winter Mock scenario, real API recommendation and storage dry-run",
    async () => {
      const before = counts();
      await page.getByRole("button", { name: "홈", exact: true }).click();
      await page
        .getByRole("heading", { name: "오늘의 코디 추천", exact: true })
        .waitFor();
      await page
        .getByRole("heading", { name: "계절·보관 관리 추천", exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator("[data-home-source]")
          .getAttribute("data-home-source"),
        "MOCK",
      );
      await page
        .getByText("두 번째 방을 보관 후보로 추천해요.", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "추천 코디 비교하기", exact: true })
        .click();
      await page.locator(".mc-heading").waitFor();
      await page.getByRole("button", { name: "홈", exact: true }).click();
      assert.deepEqual(counts(), before);
      await page
        .getByRole("button", { name: "실제 기록", exact: true })
        .click();
      assert.equal(
        await page
          .locator("[data-home-source]")
          .getAttribute("data-home-source"),
        "SERVER",
      );
      await page
        .getByRole("button", { name: "내 옷 추천 받기", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({
          hasText:
            /보유 의류와 실제 이력 기반 추천|추천 가능한 의류가 없습니다/,
        })
        .waitFor({ timeout: 60000 });
      await page
        .getByRole("button", { name: "실제 보관 추천 조회", exact: true })
        .click();
      await page
        .getByText("보관·회수 분석 완료 · 실제 이동은 실행하지 않았습니다.", {
          exact: true,
        })
        .waitFor({ timeout: 60000 });
      assert.deepEqual(counts(), before);
      await page
        .getByRole("button", { name: "겨울 전환 시연", exact: true })
        .click();
      await page.screenshot({ path: resolve(results, "home-winter-demo.png") });
      await page.getByRole("button", { name: "옷장", exact: true }).click();
    },
  );
  await step(
    "image upload and optional fields, DRESS registration through existing API",
    async () => {
      await page
        .getByRole("button", { name: "사진 등록", exact: true })
        .click();
      await page
        .getByLabel("이미지 비공개 업로드 동의", { exact: true })
        .check();
      await page.getByLabel("사진 선택", { exact: true }).setInputFiles({
        name: "qa.png",
        mimeType: "image/png",
        buffer: image,
      });
      await page.waitForFunction(() =>
        document.querySelector(".mg-register-photo img")?.getAttribute("src"),
      );
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page
        .getByLabel("옷 이름", { exact: true })
        .fill("QA Registered Dress");
      await page.getByLabel("종류", { exact: true }).selectOption("dress");
      await page.getByLabel("색상 · 필수", { exact: true }).fill("BLACK");
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page
        .getByRole("button", { name: "의류 저장", exact: true })
        .click();
      await page
        .getByText("의류를 내 계정에 저장했어요.", { exact: true })
        .waitFor();
      const stored = (await req("GET", "/garments?limit=100")).items.find(
        (g) => g.name === "QA Registered Dress",
      );
      assert.equal(stored.category, "DRESS");
      assert.ok(stored.image);
      assert.equal(stored.location_id, null);
      await page
        .getByRole("button", { name: "등록 닫기", exact: true })
        .click();
    },
  );
  await step(
    "library to builder, owned and shared selections, comparison and quick top picker",
    async () => {
      await page.getByRole("button", { name: "코디", exact: true }).click();
      await page
        .getByRole("button", { name: "+ 새 코디", exact: true })
        .click();
      await page.locator(`button[data-garment-id="${ownTop.id}"]`).click();
      await page
        .getByRole("button", { name: "하의 선택", exact: true })
        .click();
      await page.locator(`button[data-garment-id="${bottom.id}"]`).click();
      await page
        .getByRole("button", { name: "아우터 선택", exact: true })
        .click();
      await page.locator(`button[data-garment-id="${sharedOuter.id}"]`).click();
      await page
        .getByRole("button", { name: "미러로 비교", exact: true })
        .click();
      await page.locator('[data-outfit-view="compare"] .mc-heading').waitFor();
      await page
        .getByRole("button", { name: "상의 바꾸기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "전체에서 고르기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "코디 작업 뒤로", exact: true })
        .click();
      await page.locator(".mc-heading").waitFor();
      await page.screenshot({
        path: resolve(results, "second-handoff-compare.png"),
      });
    },
  );
  await step("Mock VTON job, result read and no paid call", async () => {
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    await page
      .getByLabel("인물 사진 비공개 업로드에 동의합니다.", { exact: true })
      .check();
    await page.getByLabel("인물 사진", { exact: true }).setInputFiles({
      name: "person.png",
      mimeType: "image/png",
      buffer: image,
    });
    await page.getByText("인물 사진 업로드 완료", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Mock VTON 실행", exact: true })
      .click();
    await page
      .locator(".mc-server-fitting")
      .getByText("Mock VTON 결과 · 실제 피팅 아님", { exact: true })
      .waitFor({ timeout: 60000 });
  });
  await step(
    "final selection retry, confirmed LED slots, automatic off and zero auto wear/plan",
    async () => {
      const before = counts();
      let lost = false;
      const initialLedResponse = page.waitForResponse(r => r.url().endsWith("/integration/led-commands") && r.request().method() === "POST" && r.ok());
      await page.route("**/api/v1/vton-sessions/*/end", async (route) => {
        const response = await route.fetch();
        if (!lost) {
          lost = true;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      await page
        .getByRole("button", { name: "이 코디로 확정", exact: true })
        .click();
      await page
        .getByRole("button", { name: "앞선 선택 기록 다시 확인", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "앞선 선택 기록 다시 확인", exact: true })
        .click();
      await page
        .getByText(/코디 확정 완료 · 착용 예정\/실제 착용 기록 없음/)
        .waitFor();
      assert.equal(counts().wear_event, before.wear_event);
      // Capture the actual LED command response: mobile scrolling can exceed the test's 2s TTL.
      const initialLedState = await (await initialLedResponse).json();
      assert.equal(initialLedState.status, "ON");
      assert.ok(initialLedState.anchor_ids.length > 0);
      await page.waitForTimeout(2300);
      assert.deepEqual(
        (
          await req(
            "GET",
            `/integration/devices/${fixture.device_id}/led-state`,
          )
        ).anchor_ids,
        [],
      );
      await page.unroute("**/api/v1/vton-sessions/*/end");
    },
  );
  await step(
    "server card render, image preview and explicit sharing",
    async () => {
      await page
        .getByRole("button", { name: "비교 더 보기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "코디카드로 저장", exact: true })
        .click();
      await page
        .getByText("코디카드를 저장했어요. 오늘 선택과는 별도예요.", {
          exact: true,
        })
        .waitFor({ timeout: 60000 });
      await page
        .getByRole("button", { name: "카드 탐색으로 돌아가기", exact: true })
        .click();
      await page.locator('[data-card-preview="server-image"]').waitFor();
      await page
        .getByRole("button", { name: "카드 이미지 공유", exact: true })
        .first()
        .click();
      const link = page
        .getByRole("link", { name: "공유 이미지 열기", exact: true })
        .first();
      await link.waitFor();
      const url = new URL(
        await link.getAttribute("href"),
        server.resolvedUrls.local[0],
      );
      const response = await fetch(url);
      assert.ok(response.ok);
      assert.match(response.headers.get("content-type"), /^image\/png/);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    },
  );
  await step(
    "explicit wear time and cancellation before submit, uncertain response recovery without duplication",
    async () => {
      const before = counts().wear_event;
      await page.getByRole("button", { name: "캘린더", exact: true }).click();
      await page
        .getByRole("button", { name: "실제 착용 기록", exact: true })
        .click();
      const select = page.getByLabel("실제로 입은 코디", { exact: true });
      const value = await select.locator("option").nth(1).getAttribute("value");
      await select.selectOption(value);
      await page.getByLabel("실제 착용 시간", { exact: true }).fill("10:15");
      await page
        .getByLabel("선택한 날짜·시간에 이 옷을 실제로 입었습니다.", {
          exact: true,
        })
        .check();
      await page.getByRole("button", { name: "취소", exact: true }).click();
      assert.equal(counts().wear_event, before);
      await page
        .getByRole("button", { name: "실제 착용 기록", exact: true })
        .click();
      let lost = false;
      await page.route("**/api/v1/wear-confirmations", async (route) => {
        const response = await route.fetch();
        if (!lost) {
          lost = true;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      await page
        .getByRole("button", { name: "실제 착용 확인", exact: true })
        .click();
      await page.getByText(/원래 입력으로 다시 확인할 수 있습니다/).waitFor();
      assert.equal(counts().wear_event, before + 1);
      await page.getByRole("button", { name: "홈", exact: true }).click();
      await page.getByRole("button", { name: "캘린더", exact: true }).click();
      await page
        .getByRole("button", { name: "실제 착용 확인", exact: true })
        .click();
      await page
        .getByText("직접 확인한 실제 착용을 기록했습니다.", { exact: true })
        .waitFor();
      assert.equal(counts().wear_event, before + 1);
      await page.locator('[data-event-kind="wear"]').waitFor();
      await page.unroute("**/api/v1/wear-confirmations");
      await page.getByRole("button", { name: "이전 달", exact: true }).click();
      await page.getByRole("button", { name: "오늘", exact: true }).click();
    },
  );
  await step(
    "care guide, explicit care completion and authorized location save",
    async () => {
      const careBefore = counts().care_event;
      await page.getByRole("button", { name: "옷장", exact: true }).click();
      await page.locator(`button[data-garment-id="${ownTop.id}"]`).click();
      await page
        .getByRole("button", { name: "실제 관리 또는 이동 기록", exact: true })
        .click();
      await page.getByText("새 관리 일정 등록", { exact: true }).click();
      const planned = new Date(Date.now() + 10 * 3600000).toISOString();
      await page
        .getByLabel("관리 예정 날짜", { exact: true })
        .fill(planned.slice(0, 10));
      await page
        .getByLabel("관리 예정 시간", { exact: true })
        .fill(planned.slice(11, 16));
      await page
        .getByRole("button", { name: "관리 일정 등록", exact: true })
        .click();
      await page
        .getByText(
          "관리 일정을 등록했습니다. 실제 완료 기록은 별도로 확인하세요.",
          { exact: true },
        )
        .waitFor();
      assert.equal(counts().care_event, careBefore);
      await page.getByText("새 관리 일정 등록", { exact: true }).click();
      await page.waitForTimeout(1100);
      const korea = new Date(Date.now() + 9 * 3600000).toISOString();
      await page
        .getByLabel("실제 완료 날짜", { exact: true })
        .fill(korea.slice(0, 10));
      await page
        .getByLabel("실제 완료 시간", { exact: true })
        .fill(korea.slice(11, 19));
      await page
        .getByRole("button", { name: "실제 완료한 관리 기록", exact: true })
        .click();
      await page
        .getByText("실제로 완료한 관리 기록을 저장했습니다.", { exact: true })
        .waitFor();
      assert.equal(counts().care_event, careBefore + 1);
      await page.getByRole("button", { name: "이동", exact: true }).click();
      await page
        .getByLabel("직접 확인한 새 위치", { exact: true })
        .selectOption(fixture.locations[1]);
      await page
        .getByRole("button", { name: "확인한 이동 기록", exact: true })
        .click();
      await page
        .getByText("직접 확인한 보관 위치를 저장했습니다.", { exact: true })
        .waitFor();
      assert.equal(
        (await req("GET", `/garments/${ownTop.id}`)).location_id,
        fixture.locations[1],
      );
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      await page.getByRole("tab", { name: "라벨·관리법", exact: true }).click();
      await page
        .getByText("검토된 관리 근거를 보완하면 도움을 요청할 수 있어요.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "관리 도움 요청", exact: true })
          .count(),
        0,
      );
    },
  );
  await step(
    "main-only integration tools, LIKED remains external and store LED access denied",
    async () => {
      const before = counts().garment;
      await page.getByRole("button", { name: "마이", exact: true }).click();
      await page.getByRole("button", { name: "내 계정", exact: true }).click();
      await page
        .getByRole("button", { name: "LIKED 조회", exact: true })
        .click();
      await page.getByText("LIKED · 보유 의류 아님", { exact: true }).waitFor();
      assert.equal(counts().garment, before);
      assert.ok(
        await page
          .getByRole("button", { name: "구매 내역 일괄 등록", exact: true })
          .count(),
      );
      assert.ok(
        await page
          .getByRole("button", { name: "보관·회수 추천", exact: true })
          .count(),
      );
      await auth(1, 2);
      const response = await fetch(base + "/api/v1/integration/led-commands", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          device_id: fixture.device_id,
          garment_ids: [ownTop.id],
        }),
      });
      assert.equal(response.status, 403);
      assert.deepEqual(errors, []);
    },
  );
} finally {
  await save();
  await browser?.close();
  await new Promise((r) => (server ? server.httpServer.close(r) : r()));
}
