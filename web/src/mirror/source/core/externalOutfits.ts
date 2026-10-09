import type {
  ExternalItem,
  ExternalOutfitItems,
  OutfitDraft,
  Slot,
} from "./types";
import { DemoError, stable } from "./repository";
export const OUTFIT_SLOT_NAMES: Record<Slot, string> = {
  top: "상의",
  bottom: "하의",
  outer: "아우터",
  shoes: "신발",
  bag: "가방",
  hat: "모자",
  accessory: "액세서리",
};
export const OUTFIT_SLOT_KEYS = Object.keys(OUTFIT_SLOT_NAMES) as Slot[];
export const hasExternalItems = (
  outfit: { externalItems?: ExternalOutfitItems } | null | undefined,
) => Object.keys(outfit?.externalItems ?? {}).length > 0;
export const completeOutfit = (
  outfit: Pick<OutfitDraft, "items" | "externalItems">,
) =>
  !!(outfit.items.top || outfit.externalItems?.top) &&
  !!(outfit.items.bottom || outfit.externalItems?.bottom);
export const slotIsLocked = (draft: OutfitDraft, slot: Slot) =>
  Boolean(draft.lockedSlots?.[slot] || (slot === "top" && draft.topLocked));
export function validateExternalSelections(
  draft: Pick<OutfitDraft, "ownerId" | "items" | "externalItems">,
  records?: readonly ExternalItem[],
): ExternalOutfitItems {
  const result = draft.externalItems ?? {};
  for (const [slot, selection] of Object.entries(result)) {
    if (
      !OUTFIT_SLOT_KEYS.includes(slot as Slot) ||
      draft.items[slot as Slot] ||
      !selection ||
      !selection.externalItemId ||
      !selection.name?.trim() ||
      !selection.sourceLabel?.trim() ||
      !(
        selection.sourceUrl === null ||
        (typeof selection.sourceUrl === "string" &&
          /^https:\/\//.test(selection.sourceUrl))
      ) ||
      !(
        (selection.assetId === null && selection.assetVersion === null) ||
        (typeof selection.assetId === "string" &&
          !!selection.assetId &&
          Number.isSafeInteger(selection.assetVersion) &&
          selection.assetVersion! > 0)
      )
    )
      throw new DemoError(
        "VALIDATION",
        "구매 후보의 원본 참조와 코디 위치를 확인해 주세요.",
      );
    if (records) {
      const rows = records.filter(
        (item) =>
          item.id === selection.externalItemId &&
          item.ownerId === draft.ownerId,
      );
      const item = rows[0];
      if (
        rows.length !== 1 ||
        (item.category && item.category !== slot) ||
        item.asset?.id !== (selection.assetId ?? undefined) ||
        item.asset?.version !== (selection.assetVersion ?? undefined) ||
        item.sourceLabel !== selection.sourceLabel ||
        item.sourceUrl !== selection.sourceUrl
      )
        throw new DemoError(
          "VALIDATION",
          "현재 프로필에 허용된 같은 구매 후보를 다시 선택해 주세요.",
        );
    }
  }
  return result;
}
export const sameOutfitComposition = (
  a: Pick<OutfitDraft, "items" | "externalItems">,
  b: Pick<OutfitDraft, "items" | "externalItems">,
) =>
  stable(a.items) === stable(b.items) &&
  stable(a.externalItems ?? {}) === stable(b.externalItems ?? {});
