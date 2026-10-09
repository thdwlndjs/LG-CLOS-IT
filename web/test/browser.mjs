import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";

const results = resolve("../test-results");
await mkdir(results, { recursive: true });
const server = await preview();
const base = `http://127.0.0.1:${process.env.WEB_PORT || 5173}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", () => errors.push("Uncaught browser error"));
const steps = [];
const evidence = {
  checks: steps,
  uncaught_errors: errors,
  backend: process.env.WEB_API_TARGET
    ? "isolated real API/DB/Celery/MinIO"
    : "local API",
  paid_live_verification_performed: false,
  external_browser_requests: [],
};
const fixture = resolve("../test-results/frontend-fixture.png");
context.on("request", (request) => {
  if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname))
    evidence.external_browser_requests.push("External browser request");
});
const click = async (name) =>
  page.getByRole("button", { name, exact: true }).click();
const visible = async (text) =>
  page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 45000 });
const nav = async (name) =>
  page
    .getByRole("navigation", { name: "主 메뉴".replace("主", "주") })
    .getByRole("button", { name, exact: true })
    .click();
const dialog = () => page.getByRole("dialog");
const response = async (path, action) => {
  const waiting = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/v1${path}` &&
      r.request().method() !== "GET",
    { timeout: 30000 },
  );
  await action();
  const r = await waiting;
  assert.ok(r.ok(), `API mutation ${path} status ${r.status()}`);
  return r.json();
};
const step = async (name, action) => {
  await action();
  steps.push({ name, status: "passed" });
  await writeFile(
    resolve(results, "frontend-browser-progress.json"),
    JSON.stringify({ checks: steps }, null, 2),
  );
  console.log(`PASS ${name}`);
};
try {
  await page.goto(base);
  await step("01 profile/home/read-only Context states", async () => {
    await click("내 옷장 들어가기 →");
    await visible("오늘, 무엇을 입을까요?");
    await visible("오늘의 추천을 기다리고 있어요");
    await page.screenshot({
      path: resolve(results, "frontend-home-empty.png"),
      fullPage: true,
    });
  });
  await step("02 settings consent/history", async () => {
    await nav("마이");
    await page.getByLabel("사진 업로드 및 사용 동의").check();
    await response("/settings", () => click("설정 저장"));
    await visible("동의 · 정책");
    await visible("실제 Decart 미연동");
  });
  await step("03 garment images via signed PUT/checksum/finalize", async () => {
    for (const title of ["화이트 상의", "블랙 하의", "화이트 신발"]) {
      await nav("옷장");
      await page.getByRole("button", { name: new RegExp(title) }).click();
      await dialog()
        .getByRole("button", { name: "정보 수정", exact: true })
        .click();
      await dialog().getByLabel("의류 사진 (선택)").setInputFiles(fixture);
      await dialog()
        .getByLabel(
          "마이에서 사진 동의를 설정했으며 이 사진 업로드에 동의합니다.",
        )
        .check();
      await dialog()
        .getByRole("button", { name: "옷 저장", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "정보 수정", exact: true })
        .waitFor();
      await dialog().getByRole("button", { name: "닫기", exact: true }).click();
    }
    assert.equal(await page.locator(".garment-card img").count(), 3);
    await page.screenshot({
      path: resolve(results, "frontend-wardrobe.png"),
      fullPage: true,
    });
  });
  await step(
    "04 garment CRUD/unknown location/Mock observation/filter",
    async () => {
      await click("＋ 옷 등록");
      await dialog().getByLabel("종류", { exact: true }).selectOption("OUTER");
      await dialog().getByLabel("색상", { exact: true }).selectOption("BLUE");
      await dialog()
        .getByRole("button", { name: "옷 저장", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await page.getByRole("button", { name: /블루 아우터/ }).click();
      await dialog()
        .getByRole("button", { name: "현재 위치 찾기", exact: true })
        .click();
      await dialog()
        .getByText(/위치 미확인/)
        .first()
        .waitFor();
      await dialog()
        .getByRole("button", { name: "현재 위치 Mock 관측", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "옷 삭제", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "삭제 확인", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await page.getByLabel("종류", { exact: true }).selectOption("OUTER");
      await visible("조건에 맞는 옷이 없어요");
      await page.getByLabel("종류", { exact: true }).selectOption("");
    },
  );
  await step("05 Context/recommendations reasons", async () => {
    await nav("홈");
    await click("오늘의 코디 추천 ↗");
    await visible("오늘의 추천을 준비했어요.");
    await page.locator(".look-card").first().waitFor();
    await page.screenshot({
      path: resolve(results, "frontend-home.png"),
      fullPage: true,
    });
  });
  await step("06 manual outfit slot composition", async () => {
    await nav("코디");
    await click("＋ 코디 만들기");
    await dialog().getByLabel("코디 이름").fill("QA 오늘의 코디");
    for (const s of ["상의", "하의", "신발"])
      await dialog()
        .getByLabel(`${s} 선택`, { exact: true })
        .selectOption({ index: 1 });
    await dialog()
      .getByRole("button", { name: "코디 저장", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    await visible("QA 오늘의 코디");
  });
  await step(
    "07 style source filter/reference/manual entry/delete",
    async () => {
      await click("스타일 보관함");
      await click("＋ 스타일 추가");
      await dialog().getByLabel("제목", { exact: true }).fill("QA 인스타 참고");
      await dialog()
        .getByLabel("출처", { exact: true })
        .selectOption("INSTAGRAM");
      await dialog().getByLabel("참고 링크").fill("https://example.com/look");
      await dialog()
        .getByRole("button", { name: "스타일 저장", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await page.getByLabel("스타일 출처").selectOption("INSTAGRAM");
      await visible("QA 인스타 참고");
      await click("참고해서 코디 만들기");
      await dialog().getByLabel("코디 이름").waitFor();
      assert.equal(
        await dialog().getByLabel("코디 이름").inputValue(),
        "QA 인스타 참고",
      );
      await dialog().getByRole("button", { name: "취소", exact: true }).click();
      await click("삭제");
      await dialog()
        .getByRole("button", { name: "삭제 확인", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await visible("모아둔 스타일이 없어요");
      await click("내 코디");
    },
  );
  await step(
    "08 common try-on upload/real Celery Mock/result/selection not wear",
    async () => {
      const card = page.locator(".look-card").filter({
        has: page.getByRole("heading", {
          name: "QA 오늘의 코디",
          exact: true,
        }),
      });
      await card.getByRole("button", { name: "입어보기", exact: true }).click();
      await click("입어보기 시작");
      await page
        .getByLabel("인물 사진 (PNG·JPEG·WebP, 10MB 이하)")
        .setInputFiles(fixture);
      await visible("인물 사진 준비됨");
      await click("Mock 입어보기 실행");
      await visible("작업 성공");
      await page.getByAltText("Mock 가상 착용 안내 결과").waitFor();
      await page.screenshot({
        path: resolve(results, "frontend-tryon.png"),
        fullPage: true,
      });
      await click("최종 코디 선택 · 세션 종료");
      await visible("실제 착용은 아직 기록하지 않았습니다.");
    },
  );
  await step(
    "09 actual wear confirmation distinct from selection",
    async () => {
      page.once("dialog", (d) => d.accept());
      await click("별도 실제 착용 확인");
      await visible("실제 착용 기록됨");
    },
  );
  await step(
    "10 card Chromium render/private save/share/revoke/reuse",
    async () => {
      await click("코디카드 만들기");
      await click("선택 코디로 카드 초안 만들기");
      await click("카드 이미지 생성");
      await visible("작업 성공");
      await page.getByAltText("생성된 코디카드").waitFor();
      await page.getByLabel("카드 제목").fill("QA 코디카드");
      await page.getByLabel("저장 코디로 연결해 다시 사용하기").check();
      await click("비공개 저장 · 기존 공유 폐기");
      await visible("카드를 비공개로 저장했어요.");
      await page
        .getByLabel("카드의 제목·의류·날씨 등 표시 정보 공유에 동의")
        .check();
      const shareResponse = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.startsWith("/api/v1/cards/") &&
          new URL(r.url()).pathname.endsWith("/save"),
      );
      await click("24시간 공유 링크 생성");
      const shared = await (await shareResponse).json();
      const sharePath = new URL(shared.share_url, base).pathname;
      assert.equal((await page.request.get(base + sharePath)).status(), 200);
      await visible("공유 링크 복사");
      await click("비공개 저장 · 기존 공유 폐기");
      await page
        .getByRole("button", { name: "공유 링크 복사", exact: true })
        .waitFor({ state: "hidden" });
      assert.equal((await page.request.get(base + sharePath)).status(), 404);
      await page.screenshot({
        path: resolve(results, "frontend-card.png"),
        fullPage: true,
      });
      await click("저장 코디 다시 입어보기 →");
      await visible("공통 입어보기");
    },
  );
  await step("11 history selection/wear separation/cancel", async () => {
    await nav("캘린더");
    await page.getByLabel("캘린더 월").waitFor();
    assert.ok((await page.locator(".calendar-grid button").count()) >= 28);
    await visible("실제 착용");
    await page.getByLabel("이력 종류").selectOption("WEAR");
    await page.locator(".timeline-item").first().waitFor();
    await click("착용 취소");
    await dialog().getByLabel("취소 사유").fill("QA 기록 취소");
    await dialog()
      .getByRole("button", { name: "취소 확인", exact: true })
      .click();
    await dialog().waitFor({ state: "hidden" });
    await visible("취소");
  });
  await step(
    "12 care guide/profile/schedule/complete/cancel history",
    async () => {
      await nav("케어");
      await page.getByLabel("관리 가이드 대상").selectOption({ index: 1 });
      await dialog()
        .getByRole("button", { name: "관리 프로필 수정", exact: true })
        .click();
      await dialog().getByLabel("관리 그룹").fill("QA 기본 관리");
      await dialog()
        .getByLabel("관리 지침 (줄마다 한 항목)")
        .fill("케어라벨을 확인해주세요.");
      await dialog()
        .getByRole("button", { name: "관리 프로필 저장", exact: true })
        .click();
      await visible("QA 기본 관리");
      await dialog().getByRole("button", { name: "닫기", exact: true }).click();
      await click("＋ 케어 일정");
      await dialog()
        .getByRole("button", { name: "일정 저장", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await click("수행 완료");
      await dialog()
        .getByRole("button", { name: "기록 확인", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await click("완료 취소");
      await dialog().getByLabel("취소 사유").fill("QA 잘못된 완료");
      await dialog()
        .getByRole("button", { name: "기록 확인", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await visible("취소");
    },
  );
  await step(
    "13 storage dry-run/proposal/approval/actual confirmation",
    async () => {
      await click("보관 최적화");
      await page.getByLabel("계절", { exact: true }).selectOption("SUMMER");
      await click("보관 분석 실행");
      await visible("작업 성공");
      await visible("미리보기");
      await page
        .getByLabel("미리 분석만 하기 (이동 제안 저장 안 함)")
        .uncheck();
      await click("보관 분석 실행");
      await visible("저장");
      await page
        .getByRole("button", { name: "제안 상세 · 이동 확인", exact: true })
        .first()
        .waitFor({ timeout: 45000 });
      await page
        .getByRole("button", { name: "제안 상세 · 이동 확인", exact: true })
        .first()
        .click();
      await dialog()
        .getByRole("button", { name: "이동 제안 승인", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "결정 확인", exact: true })
        .click();
      await dialog().getByLabel("실제 이동 결과").first().waitFor();
      await dialog()
        .getByLabel("실제 이동 결과")
        .first()
        .selectOption("success");
      await dialog()
        .getByRole("button", { name: "선택 항목 실제 이동 확인", exact: true })
        .click();
      await dialog().getByText("완료", { exact: true }).first().waitFor();
      await dialog().getByRole("button", { name: "닫기", exact: true }).click();
    },
  );
  await step(
    "14 mobile navigation/dialog keyboard/no horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await nav("홈");
      await visible("오늘, 무엇을 입을까요?");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: resolve(results, "frontend-mobile.png"),
        fullPage: true,
      });
      await nav("옷장");
      await click("＋ 옷 등록");
      await dialog().waitFor();
      await page.keyboard.press("Escape");
      await dialog().waitFor({ state: "hidden" });
    },
  );
  await step(
    "15 failed home request/retry/401 lock/profile isolation",
    async () => {
      await page.route("**/api/v1/home", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "UNAVAILABLE" } }),
        }),
      );
      await nav("홈");
      await visible("서비스 또는 외부 연동이 준비되지 않았습니다.");
      await page.unroute("**/api/v1/home");
      await click("다시 시도");
      await visible("오늘의 추천 코디");
      await page.route("**/api/v1/home", (route) =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: "{}",
        }),
      );
      await click("새로고침");
      await visible("어느 옷장으로 들어갈까요?");
      await page.unroute("**/api/v1/home");
      await page.getByRole("button", { name: /가족의 옷장/ }).click();
      await click("내 옷장 들어가기 →");
      await nav("옷장");
      await visible("조건에 맞는 옷이 없어요");
    },
  );
  await step(
    "16 injected version conflict preserves edits and blocks overwrite",
    async () => {
      await click("잠금");
      await click("내 옷장 들어가기 →");
      await nav("옷장");
      await page.getByRole("button", { name: /화이트 상의/ }).click();
      await dialog()
        .getByRole("button", { name: "정보 수정", exact: true })
        .click();
      await page.route("**/api/v1/garments/*", (route) =>
        route.request().method() === "PATCH"
          ? route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ error: { code: "CONFLICT" } }),
            })
          : route.continue(),
      );
      await dialog().getByLabel("색상", { exact: true }).selectOption("GRAY");
      await dialog()
        .getByRole("button", { name: "옷 저장", exact: true })
        .click();
      await visible(
        "다른 변경이 반영되었습니다. 새로고침 후 다시 시도해주세요.",
      );
      assert.equal(
        await dialog().getByLabel("색상", { exact: true }).inputValue(),
        "GRAY",
      );
      await page.unroute("**/api/v1/garments/*");
      await dialog().getByRole("button", { name: "취소", exact: true }).click();
      await dialog().getByRole("button", { name: "닫기", exact: true }).click();
    },
  );
  await step(
    "17 injected paginated garment responses use offset and disable final next",
    async () => {
      const sample = Array.from({ length: 27 }, (_, i) => ({
        id: `40000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`,
        owner_id: "20000000-0000-4000-8000-000000000001",
        category: "TOP",
        color: "WHITE",
        season_tags: [],
        status: "AVAILABLE",
        image: null,
        location_label: null,
        version: 1,
      }));
      await page.route("**/api/v1/garments?**", (route) => {
        const q = new URL(route.request().url()).searchParams;
        const offset = Number(q.get("offset") || 0),
          limit = Number(q.get("limit") || 12);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: sample.slice(offset, offset + limit),
            page: { total: 27, offset, limit },
          }),
        });
      });
      await click("새로고침");
      await visible("총 27벌");
      assert.equal(await page.locator(".garment-card").count(), 12);
      await click("다음");
      await visible("13–24 / 27");
      await click("다음");
      await visible("25–27 / 27");
      assert.equal(
        await page
          .getByRole("button", { name: "다음", exact: true })
          .isDisabled(),
        true,
      );
      await page.unroute("**/api/v1/garments?**");
    },
  );
  await step(
    "18 injected rate limit/navigation history/reload clears credentials",
    async () => {
      await page.route("**/api/v1/home", (route) =>
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "RATE_LIMITED" } }),
        }),
      );
      await nav("홈");
      await visible("요청이 많습니다. 잠시 후 다시 시도해주세요.");
      await page.unroute("**/api/v1/home");
      await click("다시 시도");
      await visible("오늘의 추천 코디");
      await nav("마이");
      await page.goBack();
      await visible("오늘, 무엇을 입을까요?");
      await page.reload();
      await visible("어느 옷장으로 들어갈까요?");
      assert.equal(
        await page.evaluate(
          () =>
            Object.keys(localStorage).length +
            Object.keys(sessionStorage).length,
        ),
        0,
      );
    },
  );
  assert.equal(errors.length, 0, "Uncaught browser errors");
  assert.equal(
    evidence.external_browser_requests.length,
    0,
    "Unexpected external browser requests",
  );
  evidence.verified_at_utc = new Date().toISOString();
} catch (error) {
  evidence.failed = error.message;
  await page.screenshot({
    path: resolve(results, "frontend-browser-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await writeFile(
    resolve(results, "frontend-browser-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
