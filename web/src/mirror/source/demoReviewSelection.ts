import type { Garment, OutfitDraft } from "./core/types";
import { PACK_CATALOG } from "./wardrobePack";

/** LOOK01~03, REGISTER01 and one long coat needed to demonstrate the new hanging column. */
export const REVIEW_GARMENT_IDS: readonly string[] = Object.freeze([
  "T04",
  "T05",
  "T07",
  "B01",
  "B03",
  "B07",
  "S03",
  "S04",
  "O01",
]);
export const REVIEW_SELECTION_REASON =
  "LOOK01~03·등록 확인 8품목과 긴 옷 봉 확인용 트렌치코트 1벌";
/** 19 clothes cover each reference shelf plus long / upper / lower rails; drawer fronts remain empty. */
export const STRUCTURE_GARMENT_IDS: readonly string[] = Object.freeze([
  "O01",
  "O03",
  "T01",
  "T03",
  "T04",
  "B01",
  "B02",
  "B04",
  "T05",
  "T08",
  "T07",
  "O05",
  "B03",
  "B06",
  "B07",
  "T06",
  "T09",
  "B08",
  "B09",
]);
export const STRUCTURE_SELECTION_REASON =
  "긴 옷 2벌·상의 봉 3벌·하의 봉 3벌·접은 의류 11벌로 참고 구조를 확인하는 화면 전용 선별";
const catalogIds = new Set(PACK_CATALOG.map((row) => row.garment_id));

/** Pure filtering only: caller offers explicit full-inventory browsing separately. */
export function selectReviewGarments(
  garments: readonly Garment[],
  draft: Pick<OutfitDraft, "items">,
  selectedId: string | null,
): Garment[] {
  const required = new Set([
    ...REVIEW_GARMENT_IDS,
    ...Object.values(draft.items),
    ...(selectedId ? [selectedId] : []),
  ]);
  return garments.filter((g) => required.has(g.id) || !catalogIds.has(g.id));
}
/** A garment revealed by a card or inspection stays in the cabinet without changing stored inventory. */
export function selectStructureGarments(
  garments: readonly Garment[],
  draft: Pick<OutfitDraft, "items">,
  selectedId: string | null,
): Garment[] {
  const required = new Set([
    ...STRUCTURE_GARMENT_IDS,
    ...Object.values(draft.items),
    ...(selectedId ? [selectedId] : []),
  ]);
  return garments.filter((g) => required.has(g.id) || !catalogIds.has(g.id));
}
