import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

test("profile lookup distinguishes failure, retry, retained data, empty and timeout", async () => {
  const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let mode = "error";
    let delayed;
    let calls = 0;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      if (!route.request().url().endsWith("/integration/demo-profiles")) {
        await route.abort();
        return;
      }
      calls++;
      if (mode === "pending") { delayed = route; return; }
      await route.fulfill({
        status: mode === "error" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(mode === "error" ? { error: { message: "Request limiter unavailable" } } : {
          items: mode === "empty" ? [] : [
            { profile: "mother", display_name: "김수진", age: 42, relationship: "엄마" },
            { profile: "son", display_name: "최휘재", age: 27, relationship: "아들" },
          ],
        }),
      });
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole("button", { name: "마이", exact: true }).click();
    const panel = page.locator(".mx-profile-panel");
    const status = value => panel.locator(`xpath=self::*[@data-profile-status='${value}']`).waitFor();
    await status("error");
    assert.equal(await panel.getByRole("alert").innerText(), "프로필을 불러오지 못했습니다");
    mode = "success";
    await panel.getByRole("button", { name: "재시도", exact: true }).click();
    await status("success");
    assert.equal(await panel.locator("[data-profile-id^='saved-demo-']").count(), 2);
    mode = "error";
    await panel.getByRole("button", { name: "프로필 다시 조회", exact: true }).click();
    await status("error");
    assert.equal(await panel.locator("[data-profile-id^='saved-demo-']").count(), 2);
    mode = "empty";
    await panel.getByRole("button", { name: "재시도", exact: true }).click();
    await status("empty");
    assert.equal(await panel.locator("[data-profile-id^='saved-demo-']").count(), 0);
    mode = "pending";
    await panel.getByRole("button", { name: "프로필 다시 조회", exact: true }).click();
    await status("loading");
    const before = calls;
    assert.equal(await panel.getByRole("button", { name: "프로필 다시 조회", exact: true }).isDisabled(), true);
    await status("error");
    assert.equal(calls, before);
    mode = "success";
    await panel.getByRole("button", { name: "재시도", exact: true }).click();
    await status("success");
    await delayed.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' });
    await page.waitForTimeout(100);
    assert.equal(await panel.getAttribute("data-profile-status"), "success");
    assert.equal(await panel.locator("[data-profile-id^='saved-demo-']").count(), 2);
    mode = "pending";
    await panel.getByRole("button", { name: "프로필 다시 조회", exact: true }).click();
    await status("loading");
    await page.getByRole("button", { name: "홈", exact: true }).click();
    await delayed.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' });
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".mx-profile-panel").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
