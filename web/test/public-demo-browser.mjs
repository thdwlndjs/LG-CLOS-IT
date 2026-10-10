// Public demo QA: existing demo wardrobe; no clothing mutation or paid API calls.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
const errors = [],
  failed = [],
  evidence = {};
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400)
    failed.push({
      host: new URL(r.url()).hostname,
      path: new URL(r.url()).pathname,
      status: r.status(),
    });
});
const account = async () => {
  await page.getByRole("button", { name: "마이", exact: true }).click();
  await page.getByRole("button", { name: "내 계정", exact: true }).click();
};
try {
  await page.goto(
    process.env.PUBLIC_WEB_ORIGIN || "https://lg-clos-it.vercel.app/",
  );
  await account();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/integration/demo-login") &&
      r.request().method() === "POST",
    { timeout: 90000 },
  );
  await page
    .getByRole("button", { name: "시연용 로그인", exact: true })
    .click();
  const r = await response;
  assert.equal(r.status(), 200);
  const login = await r.json();
  assert.equal(login.member.role, "MEMBER");
  await page.waitForFunction(
    (id) =>
      document
        .querySelector("[data-profile-id]")
        ?.getAttribute("data-profile-id") === id,
    login.member.id,
  );
  if (await page.getByRole("dialog").count())
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "닫기", exact: true })
      .click();
  await page.getByRole("button", { name: "옷장", exact: true }).click();
  await page.waitForFunction(() => {
    const n = [...document.querySelectorAll("[data-photo-state]")];
    return n.length === 6 && n.every((e) => e.dataset.photoState === "ready");
  });
  await page.screenshot({
    path: "test-results/public-demo-wardrobe-success.png",
  });
  evidence.login_status = 200;
  evidence.role = login.member.role;
  evidence.photos_ready = 6;
  await account();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document
        .querySelector("[data-profile-id]")
        ?.getAttribute("data-profile-id") !== id,
    login.member.id,
  );
  evidence.logout = true;
  const revoked = await page.request.get(
    new URL("/api/v1/integration/devices", r.url()).href,
    { headers: { Authorization: "Bearer " + login.access_token } },
  );
  assert.equal(revoked.status(), 401);
  evidence.revoked_status = 401;
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(JSON.stringify({ ...evidence, errors, failed }));
} finally {
  await writeFile(
    "test-results/public-demo-browser.json",
    JSON.stringify({ ...evidence, errors, failed }, null, 2),
  );
  await browser.close();
}
