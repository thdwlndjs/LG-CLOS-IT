import { chromium } from "../node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.RECOVERY_EVIDENCE ||
  "../docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/stage-b";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const name of ["김수진", "최휘재"]) {
    const context = await browser.newContext({
      viewport: { width: 1672, height: 941 },
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    let scene = null,
      liked = null;
    page.on("response", async (r) => {
      if (r.status() === 200 && r.url().includes("/api/v1/")) {
        if (r.url().endsWith("/scene")) scene = await r.json();
        if (r.url().endsWith("/integration/shopping/liked"))
          liked = await r.json();
      }
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/"))
        requests.push({ method: r.method(), path: new URL(r.url()).pathname });
    });
    await page.goto(process.env.RECOVERY_ORIGIN || "http://127.0.0.1:5193");
    await page.getByRole("button", { name: "마이", exact: true }).click();
    const login = page.waitForResponse((r) =>
      r.url().endsWith("/integration/demo-login"),
    );
    await page
      .getByRole("button", { name: name + " 프로필 선택", exact: true })
      .click();
    if ((await login).status() !== 200) throw Error("Login failed");
    await page.getByRole("button", { name: "홈", exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelector(".mx-home-name")?.textContent.includes(n),
      name,
    );
    await page.waitForFunction(
      () => document.querySelectorAll("[data-scene-item-id]").length === 87,
    );
    await page.locator("[data-scene-item-id] image").evaluateAll(async (ns) => {
      await Promise.all(
        ns.map(async (n) => {
          const i = new Image();
          i.src = n.getAttribute("href");
          await i.decode();
        }),
      );
    });
    await page.screenshot({ path: out + "/" + name + "-wardrobe.png" });
    const ids = await page
      .locator("[data-scene-item-id]")
      .evaluateAll((ns) => ns.map((n) => n.getAttribute("data-scene-item-id")));
    if (!scene || !liked) throw Error("Missing actual API responses");
    const actual = {
      ids,
      scene: scene.items.map((i) => ({
        garment_id: i.garment_id,
        location_id: i.location_id,
        anchor_id: i.anchor_id,
        geometry: i.geometry,
      })),
      liked: liked.items.map((i) => ({
        id: i.id,
        category: i.category,
        image_asset_id: i.image_asset.asset_id,
      })),
    };
    if (
      new Set(actual.ids).size !== 87 ||
      actual.liked.length !== 3 ||
      errors.length
    )
      throw Error("Stage B browser assertions failed");
    const unexpected = requests.filter(
      (r) => r.method !== "GET" && !r.path.endsWith("/integration/demo-login"),
    );
    if (unexpected.length)
      throw Error("Unexpected mutation " + JSON.stringify(unexpected));
    results.push({
      profile: name,
      ...actual,
      errors,
      unexpectedMutations: unexpected,
    });
    await context.close();
  }
  await writeFile(out + "/browser.json", JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      results.map((r) => ({
        profile: r.profile,
        scene: r.ids.length,
        unique: new Set(r.ids).size,
        liked: r.liked.length,
        errors: r.errors,
      })),
    ),
  );
} finally {
  await browser.close();
}
