// Actual local app/API/DB/MinIO; delayed network responses still come from the real API.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
const out = process.env.RECOVERY_EVIDENCE ||
  "../docs/handoff/SMART_WARDROBE_CODEX_HANDOFF_2026-10-11/reports/evidence/stage-c";
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
      mutations = [],
      jobs = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/") && r.method() !== "GET")
        mutations.push({ method: r.method(), path: new URL(r.url()).pathname });
    });
    page.on("response", async (r) => {
      if (
        r.request().method() === "POST" &&
        r.url().endsWith("/integration/vton-jobs") &&
        r.status() === 202
      )
        jobs.push(await r.json().catch(() => null));
    });
    await page.goto(process.env.RECOVERY_ORIGIN || "http://127.0.0.1:5193");
    await page.getByRole("button", { name: "마이", exact: true }).click();
    const loginResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/integration/demo-login") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: name + " 프로필 선택", exact: true })
      .click();
    const login = await loginResponse;
    assert.equal(login.status(), 200, "Demo login failed");
    assert.equal((await login.json()).member.display_name, name);
    console.log(name + ": authenticated; waiting for profile state");
    await page.getByRole("button", { name: "홈", exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelector(".mx-home-name")?.textContent.includes(n),
      name,
    );
    await page.waitForFunction(
      () => document.querySelectorAll("[data-scene-item-id]").length === 87,
    );
    await page
      .locator("[data-scene-item-id] image")
      .evaluateAll(async (nodes) =>
        Promise.all(
          nodes.map(async (node) => {
            const image = new Image();
            image.src = node.getAttribute("href");
            await image.decode();
          }),
        ),
      );
    await page.screenshot({
      path: out + "/" + name + "-wardrobe-preserved.png",
    });
    if (process.env.RECOVERY_ORIGIN) {
      // Recovered demo has no fabricated saved outfits: use its actual owned selection.
      await page.getByRole("button", { name: "AI 입어보기", exact: true }).first().click();
    } else {
      await page.getByRole("button", { name: "코디", exact: true }).click();
      await page.locator("button[data-outfit-id]").first().click();
    }
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    const group = page.getByRole("group", { name: "Mock 피팅 입력" });
    await group.getByRole("checkbox", { name: /인물 사진 비공개 업로드/ }).check();
    await group
      .locator("input[type=file]")
      .setInputFiles(
        resolve("public/assets/wardrobe-pack/demo/LOOK01_sweats.png"),
      );
    await page.getByText("인물 사진 업로드 완료", { exact: true }).waitFor();
    const selector = (slot) =>
      group.getByRole("combobox", { name: slot + " 시착 의류", exact: true });
    const option = async (slot, kind, n = 0) =>
      selector(slot)
        .locator(`option[value^="${kind}:"]`)
        .nth(n)
        .getAttribute("value");
    for (const slot of ["OUTER", "DRESS", "SHOES", "ACCESSORY"])
      await selector(slot).selectOption("");
    const top = await option("TOP", "OWNED"),
      bottom = await option("BOTTOM", "OWNED");
    await selector("TOP").selectOption(top);
    await selector("BOTTOM").selectOption(bottom);
    assert.equal(jobs.length, 0, "Selection must not submit");
    const execute = page.getByRole("button", {
      name: "Mock VTON 실행",
      exact: true,
    });
    const waitResult = async () => {
      await group.waitFor({ state: "hidden", timeout: 45000 });
      await page
        .getByText("Mock 처리 완료 · 실제 시착 이미지가 아닙니다.", {
          exact: true,
        })
        .last()
        .waitFor({ timeout: 45000 });
      await page.waitForFunction(() => {
        const image = document.querySelector("[data-mock-receipt] img");
        return image?.complete && image.naturalWidth > 0;
      });
    };
    await execute.click();
    await waitResult();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].request_snapshot.contains_liked, false);
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    // Delay genuine POST response to allow changing the draft before admission/polling.
    let held, release, completed;
    const admitted = new Promise((r) => (held = r)),
      gate = new Promise((r) => (release = r)),
      handled = new Promise((r) => (completed = r));
    await page.route("**/api/v1/integration/vton-jobs", async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 202);
      held();
      await gate;
      await route.fulfill({ response });
      completed();
    });
    await selector("TOP").selectOption(await option("TOP", "LIKED"));
    await selector("BOTTOM").selectOption(await option("BOTTOM", "LIKED"));
    await execute.click();
    await admitted;
    assert.equal(await selector("TOP").isEnabled(), true);
    await selector("TOP").selectOption(top);
    await selector("BOTTOM").selectOption(bottom);
    assert.equal(
      await page
        .getByRole("button", { name: "작업 확인 중", exact: true })
        .isDisabled(),
      true,
    );
    release();
    await handled;
    await page.unroute("**/api/v1/integration/vton-jobs");
    await waitResult();
    await page.waitForFunction(
      () =>
        document.querySelector(".mc-server-fitting button")?.disabled === false,
    );
    assert.equal(jobs.length, 2);
    assert.equal(jobs[1].request_snapshot.contains_liked, true);
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    assert.equal(await selector("TOP").inputValue(), top);
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    const before = mutations.length;
    await page
      .getByRole("button", { name: "이 코디로 확정", exact: true })
      .click();
    await page
      .getByText(
        "관심 의류가 포함된 시착 결과는 착용 확정·코디카드 생성이 불가능합니다.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "비교 더 보기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "코디카드로 저장", exact: true })
      .click();
    assert.equal(mutations.length, before);
    await page
      .getByRole("button", { name: "비교 더 보기", exact: true })
      .click();
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    await selector("BOTTOM").selectOption(await option("BOTTOM", "LIKED"));
    await execute.click();
    await waitResult();
    await page.waitForFunction(
      () =>
        document.querySelector(".mc-server-fitting button")?.disabled === false,
    );
    assert.equal(jobs.length, 3);
    assert.deepEqual(
      jobs[2].request_snapshot.items.map((i) => i.kind),
      ["OWNED", "LIKED"],
    );
    await page.screenshot({ path: out + "/" + name + "-mixed-mock.png" });
    // Reverse case: owned displayed result remains authoritative when draft becomes LIKED.
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    await selector("BOTTOM").selectOption(bottom);
    await execute.click();
    await waitResult();
    assert.equal(jobs.length, 4);
    assert.equal(jobs[3].request_snapshot.contains_liked, false);
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    await selector("TOP").selectOption(await option("TOP", "LIKED"));
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    const handoffBefore = mutations.length;
    await page
      .getByRole("button", { name: "이 코디로 확정", exact: true })
      .click();
    await page
      .getByText(
        "표시된 결과의 보유 의류 Snapshot을 확인했습니다. 착용 확정은 D단계, 카드 생성은 F단계 연결 대기입니다.",
        { exact: true },
      )
      .waitFor();
    assert.equal(mutations.length, handoffBefore);
    // Delay a genuine accepted job across navigation and actual profile switch.
    let pendingHeld, pendingRelease, pendingDone, lateJob;
    const lateAdmitted = new Promise((r) => (pendingHeld = r)),
      lateGate = new Promise((r) => (pendingRelease = r)),
      lateDone = new Promise((r) => (pendingDone = r));
    await page.route("**/api/v1/integration/vton-jobs", async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 202);
      lateJob = await response.json();
      pendingHeld();
      await lateGate;
      await route.fulfill({ response });
      pendingDone();
    });
    await page.getByRole("button", { name: "Mock 피팅", exact: true }).click();
    await execute.click();
    await lateAdmitted;
    await page.getByRole("button", { name: "홈", exact: true }).click();
    assert.equal(await page.locator("[data-mock-receipt]").count(), 0);
    await page.getByRole("button", { name: "마이", exact: true }).click();
    const other = name === "김수진" ? "최휘재" : "김수진";
    const switchResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/integration/demo-login") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: other + " 프로필 선택", exact: true })
      .click();
    assert.equal((await switchResponse).status(), 200);
    await page.getByRole("button", { name: "홈", exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelector(".mx-home-name")?.textContent.includes(n),
      other,
    );
    pendingRelease();
    await lateDone;
    await page.unroute("**/api/v1/integration/vton-jobs");
    assert.equal(await page.locator("[data-mock-receipt]").count(), 0);
    assert.deepEqual(errors, []);
    const unexpected = mutations.filter((m) =>
      /\/(outfits|wear-events|outfit-cards|lighting|led)/.test(m.path),
    );
    assert.deepEqual(unexpected, []);
    results.push({
      profile: name,
      jobs: jobs.map((j) => ({
        job_id: j.job_id,
        request_snapshot: j.request_snapshot,
        is_mock: j.is_mock,
        result_semantics: j.result_semantics,
      })),
      errors,
      selectionDuringPending: true,
      currentDraftPreserved: true,
      likedFollowupSideEffects: 0,
      exitResultCleared: true,
      profileSwitchLatePostBlocked: true,
      lateAcceptedJob: {
        job_id: lateJob.job_id,
        request_snapshot: lateJob.request_snapshot,
      },
      ownedResultWithLikedDraftUsesOwnedSnapshot: true,
      unexpectedMutations: unexpected,
    });
    await context.close();
  }
  await writeFile(
    out + "/browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    "Two real profiles: owned/liked/mixed Mock, pending selection, snapshot guards and exit PASS",
  );
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) {
    await page
      .screenshot({ path: out + "/browser-failure.png" })
      .catch(() => undefined);
    await writeFile(
      out + "/browser-failure.txt",
      String(error) + "\n" + (await page.locator("body").innerText()),
    );
  }
  throw error;
} finally {
  await browser.close();
}
