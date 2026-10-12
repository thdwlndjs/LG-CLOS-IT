// Local UI/API/PostgreSQL/MinIO evidence. Any non-loopback request is blocked.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
const out =
  "../docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/c2-fitroom";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
let lastPage;
try {
  for (const name of ["김수진", "최휘재"]) {
    const context = await browser.newContext({
      viewport: { width: 1672, height: 941 },
    });
    const blocked = [],
      errors = [],
      submits = [];
    let providerAttempts = 0;
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "platform.fitroom.app") providerAttempts++;
      if (["127.0.0.1", "localhost"].includes(u.hostname))
        return route.continue();
      blocked.push(u.hostname);
      return route.abort();
    });
    const page = await context.newPage();
    lastPage = page;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/execute"))
        submits.push(r.url());
    });
    await page.goto("http://127.0.0.1:5195");
    await page.getByRole("button", { name: "마이", exact: true }).click();
    const loginResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/integration/demo-login") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: name + " 프로필 선택", exact: true })
      .click();
    assert.equal((await loginResponse).status(), 200);
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "홈", exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelector(".mx-home-name")?.textContent.includes(n),
      name,
    );
    await page.waitForFunction(
      () => document.querySelectorAll("[data-scene-item-id]").length === 87,
    );
    const sceneIds = await page
      .locator("[data-scene-item-id]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-scene-item-id")),
      );
    assert.equal(new Set(sceneIds).size, 87);
    await page.screenshot({ path: out + "/" + name + "-wardrobe.png" });
    await page.getByRole("button", { name: "코디", exact: true }).click();
    await page.locator("button[data-outfit-id]").first().click();
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    const group = page.getByRole("group", {
      name: "Mock 피팅 입력",
      exact: true,
    });
    await group.locator("input[type=checkbox]").first().check();
    await group
      .locator("input[type=file]")
      .setInputFiles(
        resolve("public/assets/wardrobe-pack/demo/LOOK01_sweats.png"),
      );
    await page.getByText("인물 사진 업로드 완료", { exact: true }).waitFor();
    const selector = (slot) =>
      group.getByRole("combobox", { name: slot + " 시착 의류", exact: true });
    for (const slot of ["OUTER", "DRESS", "SHOES", "ACCESSORY"])
      await selector(slot).selectOption("");
    for (const slot of ["TOP", "BOTTOM"])
      await selector(slot).selectOption(
        await selector(slot)
          .locator('option[value^="OWNED:"]')
          .first()
          .getAttribute("value"),
      );
    const panel = page.locator("[data-fitroom-review]");
    await panel
      .getByRole("button", { name: "입력·예상 비용 확인", exact: true })
      .click();
    await panel.getByText("프로필: " + name, { exact: false }).waitFor();
    await panel
      .getByText("프로필: " + name, { exact: false })
      .scrollIntoViewIfNeeded();
    await panel
      .locator("img")
      .evaluateAll(async (nodes) => Promise.all(nodes.map((n) => n.decode())));
    await page.screenshot({ path: out + "/" + name + "-fixture-review.png" });
    const confirmation = panel.getByRole("checkbox", {
      name: "표시된 프로필·인물·의류·비용을 확인했습니다.",
    });
    assert.equal(
      await panel
        .getByRole("button", { name: "무과금 Fixture 1회 실행" })
        .isEnabled(),
      false,
    );
    await confirmation.check();
    const completed = page.waitForResponse(
      (r) => r.url().endsWith("/execute") && r.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "무과금 Fixture 1회 실행" })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    const result = await (await completed).json();
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.mode, "FIXTURE");
    assert.equal(result.consumed, true);
    await page.locator(`[data-mock-receipt="${result.job_id}"] img`).waitFor();
    await page.screenshot({ path: out + "/" + name + "-fixture-result.png" });
    assert.equal(submits.length, 1);
    assert.equal(
      await panel
        .getByRole("button", {
          name: "무과金 Fixture 1회 실행".replace("金", "금"),
        })
        .isEnabled(),
      false,
    );
    await panel.getByRole("combobox").selectOption("LIVE");
    await panel
      .getByRole("button", { name: "입력·예상 비용 확인", exact: true })
      .click();
    await panel
      .getByText("서버 승인 또는 실행 환경 확인 필요 · 호출 차단", {
        exact: true,
      })
      .waitFor();
    await confirmation.check();
    assert.equal(
      await panel
        .getByRole("button", { name: "승인된 FitRoom 1회 실행" })
        .isEnabled(),
      false,
    );
    await page.screenshot({ path: out + "/" + name + "-live-blocked.png" });
    assert.equal(submits.length, 1);
    await page.reload();
    // Reload checks server persistence directly, without any provider endpoint.
    const stored = await page.request.get("http://127.0.0.1:18082/health/live");
    assert.equal(stored.status(), 200);
    assert.deepEqual(errors, []);
    assert.equal(providerAttempts, 0);
    results.push({
      profile: name,
      fixture_job_id: result.job_id,
      fixture_snapshot: result.request_snapshot,
      scene_unique_item_count: new Set(sceneIds).size,
      duplicate_submit_count: submits.length,
      live_button_blocked: true,
      browser_provider_request_attempts: providerAttempts,
      blocked_non_loopback_hosts: [...new Set(blocked)],
      errors,
    });
    await context.close();
  }
  await writeFile(out + "/browser.json", JSON.stringify(results, null, 2));
  console.log(
    "Two profiles: Fixture, snapshot, result display and LIVE block PASS; provider traffic zero",
  );
} catch (error) {
  if (lastPage) {
    await lastPage.screenshot({ path: out + "/failure.png" });
    console.log((await lastPage.locator("body").innerText()).slice(0, 1800));
    console.log(
      "panel",
      await lastPage
        .locator("[data-fitroom-review]")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await browser.close();
}
