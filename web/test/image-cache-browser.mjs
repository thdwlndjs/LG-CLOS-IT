import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
// Read-only local demo QA; deliberately exceeds the real 60-second signed URL TTL.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
const evidence = { requests: [], stages: [], errors: [], injectedExpiry: 0 };
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (
    url.pathname.startsWith("/local-storage/") ||
    /^\/api\/v1\/garments\/[^/]+$/.test(url.pathname)
  )
    evidence.requests.push({
      path: url.pathname,
      kind: url.pathname.startsWith("/local-storage/") ? "download" : "refresh",
    });
});
await page.route("**/local-storage/**", async (route) => {
  if (!evidence.injectedExpiry) {
    evidence.injectedExpiry++;
    await route.fulfill({
      status: 403,
      contentType: "application/xml",
      body: "<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>",
    });
  } else await route.continue();
});
const ready = async (stage, count) => {
  await page.waitForFunction((expected) => {
    const nodes = [...document.querySelectorAll("[data-photo-state]")];
    return (
      nodes.length === expected &&
      nodes.every((e) => e.dataset.photoState === "ready")
    );
  }, count);
  evidence.stages.push({ stage, ready: count });
};
const account = async () => {
  await page.getByRole("button", { name: "마이", exact: true }).click();
  await page.getByRole("button", { name: "내 계정", exact: true }).click();
};
const close = async () => {
  if (await page.getByRole("dialog").count())
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "닫기", exact: true })
      .click();
};
try {
  await page.goto(process.env.WEB_URL || "http://127.0.0.1:5181/");
  await account();
  await page
    .getByRole("button", { name: "시연용 로그인", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-profile-id]")
      ?.getAttribute("data-profile-id")
      ?.startsWith("20000000"),
  );
  await close();
  await page.getByRole("button", { name: "홈", exact: true }).click();
  await ready("home-after-injected-403", 3);
  assert.equal(evidence.requests.filter((r) => r.kind === "refresh").length, 1);
  console.log("Home ready; one injected expiry recovered. Waiting 65 seconds.");
  await page.waitForTimeout(65000);
  await page.getByRole("button", { name: "옷장", exact: true }).click();
  await ready("wardrobe-after-real-expiry", 6);
  assert.equal(
    evidence.requests.filter((r) => r.kind === "download").length,
    7,
  ); // Six assets + one failed attempt.
  assert.equal(evidence.requests.filter((r) => r.kind === "refresh").length, 4); // One retry + three expired cache misses.
  const checkpoint = evidence.requests.length;
  await page.getByRole("button", { name: "홈", exact: true }).click();
  await ready("cached-home", 3);
  await page.getByRole("button", { name: "옷장", exact: true }).click();
  await ready("cached-wardrobe", 6);
  assert.equal(
    evidence.requests.length,
    checkpoint,
    "tab revisits must issue no download or URL refresh",
  );
  await account();
  await page
    .getByRole("button", { name: "내 옷장 다시 불러오기", exact: true })
    .click();
  await page.waitForTimeout(1500);
  await close();
  await page.getByRole("button", { name: "옷장", exact: true }).click();
  await ready("cache-after-metadata-reload", 6);
  assert.equal(
    evidence.requests.length,
    checkpoint,
    "new signed URLs with unchanged asset IDs must reuse blobs",
  );
  const blobUrl = await page
    .locator("[data-photo-state] img")
    .first()
    .getAttribute("src");
  assert.match(blobUrl, /^blob:/);
  await account();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector("[data-profile-id]")
        ?.getAttribute("data-profile-id")
        ?.startsWith("20000000"),
  );
  assert.equal(
    await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return false;
      } catch {
        return true;
      }
    }, blobUrl),
    true,
    "logout revokes object URL",
  );
  assert.deepEqual(evidence.errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      downloads: 7,
      refreshes: 4,
      stages: evidence.stages,
      logoutRevoked: true,
    }),
  );
} catch (error) {
  console.log(JSON.stringify(await page.locator('[data-photo-state]').evaluateAll(nodes => nodes.map(n => ({state:n.dataset.photoState, name:n.getAttribute('aria-label'), hasImage:!!n.querySelector('img')})))));
  await page.screenshot({path:'test-results/photo-cache-failure.png'});
  throw error;
} finally {
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/photo-cache-browser.json",
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
}
