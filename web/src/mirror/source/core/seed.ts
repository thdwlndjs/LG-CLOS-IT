import type { Asset, Category, DemoState, Garment, ProfileUI } from "./types";

export const STORAGE_KEY = "smartcloset.stage1.demo.v1";
export const DEMO_PROFILE = "demo-profile";
export const DEMO_DATE = "2026-10-13";
export const DEMO_TIME = "09:24";
export const REGISTRATION_ASSET: Asset = {
  id: "asset-burgundy-knit",
  version: 1,
  source: "packaged",
  url: "/assets/burgundy-knit.png",
};
export const DEMO_CONDITIONS = {
  weather: "sunny",
  temperatureC: 11,
  occasion: "work",
};
export function emptyUI(): ProfileUI {
  return {
    query: "",
    category: "all",
    searchResultIds: [],
    selectedGarmentId: null,
    selectedOutfitId: null,
    screen: "home",
    calendarDate: DEMO_DATE,
    operations: {
      search: { status: "idle" },
      analysis: { status: "idle" },
      recommendation: { status: "idle" },
      saveGarment: { status: "idle" },
      saveOutfit: { status: "idle" },
      careGuide: { status: "idle" },
      tryOn: { status: "idle" },
    },
  };
}
export function createSeed(): DemoState {
  const entries: [string, string, Category, string, string, string][] = [
    [
      "g-trench",
      "베이지 트렌치 코트",
      "outer",
      "베이지",
      "trench",
      "행거 B · 오른쪽 1번째",
    ],
    [
      "g-jacket",
      "블랙 라이더 재킷",
      "outer",
      "블랙",
      "black-jacket",
      "행거 B · 오른쪽 2번째",
    ],
    [
      "g-knit",
      "그레이 스웨트셔츠",
      "top",
      "그레이",
      "gray-sweatshirt",
      "선반 C",
    ],
    ["g-slacks", "차콜 슬랙스", "bottom", "차콜", "slacks", "행거 D"],
    ["g-jeans", "블루 데님", "bottom", "블루", "jeans", "행거 D"],
    ["g-bag", "블랙 백팩", "bag", "블랙", "bag", "선반 F"],
    ["g-shoes", "블랙 부츠", "shoes", "블랙", "shoes", "신발장"],
  ];
  const garments: Garment[] = entries.map(
    ([id, name, category, color, file, location]) => ({
      id,
      ownerId: DEMO_PROFILE,
      name,
      category,
      color,
      features: [color, "개발용 시연 샘플"],
      material: "",
      size: "",
      location,
      asset: {
        id: `asset-${file}`,
        version: 1,
        source: "packaged",
        url: ["trench", "slacks"].includes(file) ? null : `/assets/${file}.png`,
      },
      revision: 1,
      provenance: {
        location: "demo",
        size: "unconfirmed",
        care: id === "g-trench" ? "demo" : "unconfirmed",
      },
      careNotes:
        id === "g-trench"
          ? "시연용 장기 미착용 예시입니다. 실제 소재·세탁 라벨은 확인되지 않았습니다."
          : "",
    }),
  );
  const items = {
    top: "g-knit",
    bottom: "g-slacks",
    outer: "g-trench",
    bag: "g-bag",
    shoes: "g-shoes",
  };
  const ui = emptyUI();
  ui.searchResultIds = garments.map((g) => g.id);
  return {
    schemaVersion: 1,
    activeProfileId: DEMO_PROFILE,
    profiles: [{ id: DEMO_PROFILE, name: "시연 사용자" }],
    garments,
    outfits: [
      {
        id: "outfit-prepared",
        ownerId: DEMO_PROFILE,
        name: "맑은 날 출근 코디 · 준비 예시",
        items,
        revision: 1,
        assetVersions: Object.fromEntries(
          Object.values(items).map((id) => [id, 1]),
        ),
      },
    ],
    events: [],
    registrationDrafts: {},
    outfitDrafts: {
      [DEMO_PROFILE]: {
        draftId: "outfit-draft-initial",
        ownerId: DEMO_PROFILE,
        revision: 1,
        name: "나의 출근 코디",
        items,
        topLocked: false,
      },
    },
    ui: { [DEMO_PROFILE]: ui },
    receipts: [],
    intents: {},
    revisionReceipts: {},
  };
}
