import { PACK_CATALOG, PACK_PROFILE_ID } from "./wardrobePack";
import { getLayoutCompartment } from "./layoutConfig";

export interface PackPlacementGroup {
  compartmentId: string;
  garmentIds: readonly string[];
  reason: string;
}
/** Only clothes with storage appropriate to this reference receive a screen-only placement. */
export const PACK_PLACEMENT_GROUPS: readonly PackPlacementGroup[] =
  Object.freeze(
    [
      {
        compartmentId: "left-hanger-b",
        garmentIds: Object.freeze(["O01", "O03"]),
        reason: "긴 코트 2벌 · 긴 옷 봉 시연",
      },
      {
        compartmentId: "left-hanger-a",
        garmentIds: Object.freeze([
          "T01",
          "T02",
          "T03",
          "T04",
          "O02",
          "O04",
          "O06",
          "O07",
          "O08",
        ]),
        reason: "셔츠·짧은 겉옷 · 상단 봉 시연",
      },
      {
        compartmentId: "left-hanger-d",
        garmentIds: Object.freeze(["B01", "B02", "B04", "B05"]),
        reason: "슬랙스·치노·와이드팬츠·스커트 · 하단 봉 시연",
      },
      {
        compartmentId: "right-shelf-c",
        garmentIds: Object.freeze(["T05"]),
        reason: "케이블 니트 · 접은 상의 시연",
      },
      {
        compartmentId: "right-shelf-f",
        garmentIds: Object.freeze(["T08", "T10", "T11", "T12"]),
        reason: "롱슬리브 등 상의 · 접은 상의 시연",
      },
      {
        compartmentId: "right-shelf-h",
        garmentIds: Object.freeze(["T07"]),
        reason: "맨투맨 · 접은 상의 시연",
      },
      {
        compartmentId: "right-shelf-j",
        garmentIds: Object.freeze(["O05"]),
        reason: "원본 확인한 니트 가디건 · 접은 니트 시연",
      },
      {
        compartmentId: "right-shelf-l",
        garmentIds: Object.freeze(["B03"]),
        reason: "데님 · 접은 하의 시연",
      },
      {
        compartmentId: "right-shelf-m",
        garmentIds: Object.freeze(["B06"]),
        reason: "카고팬츠 · 접은 하의 시연",
      },
      {
        compartmentId: "right-shelf-n",
        garmentIds: Object.freeze(["B07"]),
        reason: "조거팬츠 · 접은 하의 시연",
      },
      {
        compartmentId: "right-shelf-o",
        garmentIds: Object.freeze(["T06"]),
        reason: "티셔츠 · 접은 상의 시연",
      },
      {
        compartmentId: "right-shelf-p",
        garmentIds: Object.freeze(["T09"]),
        reason: "후드티 · 접은 상의 시연",
      },
      {
        compartmentId: "right-shelf-q",
        garmentIds: Object.freeze(["B08"]),
        reason: "데님 쇼츠 · 접은 하의 시연",
      },
      {
        compartmentId: "right-shelf-r",
        garmentIds: Object.freeze(["B09"]),
        reason: "트레이닝 쇼츠 · 접은 하의 시연",
      },
    ].map((group) => Object.freeze(group)),
  );

export function createPackDisplayPlacements(
  groups: readonly PackPlacementGroup[],
) {
  const byGarmentId: Record<string, string> = {};
  const compartmentByGarmentId: Record<string, string> = {};
  const catalogIds = new Set(PACK_CATALOG.map((row) => row.garment_id));
  const usedCompartments = new Set<string>();
  for (const group of groups) {
    const compartment = getLayoutCompartment(group.compartmentId);
    if (!compartment)
      throw new Error(
        "시연 배치의 수납 칸을 확인할 수 없습니다: " + group.compartmentId,
      );
    if (usedCompartments.has(compartment.id))
      throw new Error("시연 수납 칸 묶음이 중복되었습니다: " + compartment.id);
    usedCompartments.add(compartment.id);
    for (const id of group.garmentIds) {
      if (!catalogIds.has(id))
        throw new Error("시연 배치의 원본 의류 ID를 확인할 수 없습니다: " + id);
      if (Object.hasOwn(byGarmentId, id))
        throw new Error("시연 의류가 여러 칸에 중복 배치되었습니다: " + id);
      byGarmentId[id] = compartment.label;
      compartmentByGarmentId[id] = compartment.id;
    }
  }
  return Object.freeze({
    ownerId: PACK_PROFILE_ID,
    displayOnly: true as const,
    physicalStatus: "unconfirmed" as const,
    byGarmentId: Object.freeze(byGarmentId),
    compartmentByGarmentId: Object.freeze(compartmentByGarmentId),
  });
}
/** Derived labels preserve source garment IDs; no Garment.location or movement event is written. */
export const PACK_DEMO_PLACEMENTS = createPackDisplayPlacements(
  PACK_PLACEMENT_GROUPS,
);
export const PACK_PENDING_PLACEMENTS = Object.freeze(
  PACK_CATALOG.filter(
    (row) => !Object.hasOwn(PACK_DEMO_PLACEMENTS.byGarmentId, row.garment_id),
  ).map((row) =>
    Object.freeze({
      garmentId: row.garment_id,
      reason:
        row.category === "shoes"
          ? "신발 전용 칸 미확인 · LED 안내 대기"
          : row.category === "dress"
            ? "원피스는 원본 미리보기 유지 · 코디 슬롯과 위치 미확인"
            : "이 구조의 보관 위치 미확인 · 전체 목록에서 확인",
    }),
  ),
);
