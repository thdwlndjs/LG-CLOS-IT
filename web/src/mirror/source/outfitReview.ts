import type { Garment, OutfitDraft, Slot } from "./core/types";

export const REVIEW_SLOTS: readonly Slot[] = [
  "top",
  "bottom",
  "outer",
  "bag",
  "shoes",
  "hat",
  "accessory",
];
export const REVIEW_SLOT_LABELS: Record<Slot, string> = {
  top: "상의",
  bottom: "하의",
  outer: "겉옷",
  bag: "가방",
  shoes: "신발",
  hat: "모자",
  accessory: "액세서리",
};
export type ReviewAvailability = "unknown" | "available" | "laundry" | "repair";
export const REVIEW_AVAILABILITY_LABELS: Record<ReviewAvailability, string> = {
  unknown: "확인 전",
  available: "사용 가능",
  laundry: "세탁 중",
  repair: "수선 중",
};
export interface OutfitReviewState {
  ownerId: string;
  confirmations: Record<
    string,
    { identity: string; status: Exclude<ReviewAvailability, "unknown"> }
  >;
}
/** Explicit confirmations sent for this recommendation request, never stored as garment status. */
export interface AvailabilityConfirmation {
  garmentId: string;
  identity: string;
  status: Exclude<ReviewAvailability, "unknown">;
}
export function recommendationAvailability(
  review: OutfitReviewState,
  ownerId: string,
  garments: Garment[],
): AvailabilityConfirmation[] {
  const current = reconcileOutfitReviewState(review, ownerId, garments);
  return Object.entries(current.confirmations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([garmentId, confirmation]) => ({ garmentId, ...confirmation }));
}
export interface OutfitReviewInput {
  ownerId: string;
  garments: Garment[];
  draft: OutfitDraft;
  review: OutfitReviewState;
}
export interface ReviewedItem {
  slot: Slot;
  garmentId: string | null;
  garment: Garment | null;
  status: ReviewAvailability;
  issues: string[];
}
export interface ReplacementCandidate {
  garment: Garment;
  status: ReviewAvailability;
  reasons: string[];
  canReplace: boolean;
  restriction: string;
}

export function createOutfitReviewState(ownerId: string): OutfitReviewState {
  return { ownerId, confirmations: {} };
}
/** A review confirmation belongs to this exact owned item and asset version, never to a name or slot. */
export function reviewGarmentIdentity(garment: Garment): string {
  return JSON.stringify([
    garment.ownerId,
    garment.id,
    garment.revision,
    garment.category,
    garment.asset
      ? [
          garment.asset.id,
          garment.asset.version,
          garment.asset.source,
          !!garment.asset.needsReselection,
        ]
      : null,
  ]);
}
function validIdentity(garment: Garment) {
  return (
    !!garment.id &&
    Number.isSafeInteger(garment.revision) &&
    garment.revision > 0 &&
    REVIEW_SLOTS.includes(garment.category) &&
    (!garment.asset ||
      (!!garment.asset.id &&
        Number.isSafeInteger(garment.asset.version) &&
        garment.asset.version > 0))
  );
}
function ownedInventory(ownerId: string, garments: Garment[]) {
  const counts = new Map<string, number>();
  for (const garment of garments)
    counts.set(garment.id, (counts.get(garment.id) ?? 0) + 1);
  return new Map(
    garments
      .filter(
        (garment) =>
          garment.ownerId === ownerId &&
          counts.get(garment.id) === 1 &&
          validIdentity(garment),
      )
      .map((garment) => [garment.id, garment]),
  );
}
export function reconcileOutfitReviewState(
  state: OutfitReviewState,
  ownerId: string,
  garments: Garment[],
): OutfitReviewState {
  if (state.ownerId !== ownerId) return createOutfitReviewState(ownerId);
  const inventory = ownedInventory(ownerId, garments);
  const entries = Object.entries(state.confirmations).filter(
    ([id, confirmation]) => {
      const garment = inventory.get(id);
      return (
        !!garment &&
        confirmation.identity === reviewGarmentIdentity(garment) &&
        ["available", "laundry", "repair"].includes(confirmation.status)
      );
    },
  );
  return entries.length === Object.keys(state.confirmations).length
    ? state
    : { ownerId, confirmations: Object.fromEntries(entries) };
}
export function confirmReviewAvailability(
  state: OutfitReviewState,
  ownerId: string,
  garments: Garment[],
  garmentId: string,
  status: ReviewAvailability,
): OutfitReviewState {
  const current = reconcileOutfitReviewState(state, ownerId, garments),
    garment = ownedInventory(ownerId, garments).get(garmentId);
  if (
    !garment ||
    !["unknown", "available", "laundry", "repair"].includes(status)
  )
    return current;
  const confirmations = { ...current.confirmations };
  if (status === "unknown") delete confirmations[garmentId];
  else
    confirmations[garmentId] = {
      identity: reviewGarmentIdentity(garment),
      status,
    };
  return { ownerId, confirmations };
}
export function reviewAvailability(
  state: OutfitReviewState,
  ownerId: string,
  garment: Garment,
): ReviewAvailability {
  const confirmation = state.confirmations[garment.id];
  return state.ownerId === ownerId &&
    garment.ownerId === ownerId &&
    validIdentity(garment) &&
    confirmation?.identity === reviewGarmentIdentity(garment) &&
    ["available", "laundry", "repair"].includes(confirmation.status)
    ? confirmation.status
    : "unknown";
}
export function reviewCurrentOutfit(input: OutfitReviewInput): {
  items: ReviewedItem[];
  issues: string[];
} {
  const { ownerId, garments, draft, review } = input;
  if (draft.ownerId !== ownerId)
    return { items: [], issues: ["현재 계정의 코디를 먼저 선택해 주세요."] };
  const inventory = ownedInventory(ownerId, garments),
    selected = Object.values(draft.items);
  const issues = Object.keys(draft.items).some(
    (slot) => !REVIEW_SLOTS.includes(slot as Slot),
  )
    ? ["코디에 확인할 수 없는 종류가 포함되어 있어요."]
    : [];
  const items: ReviewedItem[] = REVIEW_SLOTS.filter(
    (slot) => !!draft.items[slot] || slot === "top" || slot === "bottom",
  ).map((slot) => {
    const garmentId = draft.items[slot] ?? null,
      garment = garmentId ? (inventory.get(garmentId) ?? null) : null,
      itemIssues: string[] = [];
    if (!garmentId)
      itemIssues.push(`${REVIEW_SLOT_LABELS[slot]}를 선택해 주세요.`);
    else if (!garment)
      itemIssues.push("현재 옷장에서 의류와 버전을 확인할 수 없어요.");
    else if (garment.category !== slot)
      itemIssues.push("선택한 종류와 의류의 등록 종류가 달라요.");
    if (garmentId && selected.filter((id) => id === garmentId).length > 1)
      itemIssues.push("같은 의류가 여러 종류에 중복 선택되어 있어요.");
    const valid = !!garment && !itemIssues.length,
      status = valid ? reviewAvailability(review, ownerId, garment) : "unknown";
    if (valid && status === "unknown")
      itemIssues.push("이번에 사용할 수 있는지 확인해 주세요.");
    if (valid && (status === "laundry" || status === "repair"))
      itemIssues.push(
        `${REVIEW_AVAILABILITY_LABELS[status]}으로 확인한 옷이 포함되어 있어요.`,
      );
    return {
      slot,
      garmentId,
      garment: valid ? garment : null,
      status,
      issues: itemIssues,
    };
  });
  return { items, issues };
}
export function replacementDecision(
  input: OutfitReviewInput,
  slot: Slot,
  garmentId: string,
): { allowed: boolean; reason: string } {
  if (input.draft.ownerId !== input.ownerId)
    return { allowed: false, reason: "현재 계정의 코디를 먼저 선택해 주세요." };
  if (!REVIEW_SLOTS.includes(slot))
    return { allowed: false, reason: "교체할 종류를 확인해 주세요." };
  const garment = ownedInventory(input.ownerId, input.garments).get(garmentId);
  if (!garment || garment.category !== slot)
    return {
      allowed: false,
      reason: "같은 종류의 내 옷장에서만 선택할 수 있어요.",
    };
  if (input.draft.items[slot] === garmentId)
    return { allowed: false, reason: "현재 선택한 옷이에요." };
  if (slot === "top" && input.draft.topLocked)
    return { allowed: false, reason: "상의 고정을 먼저 해제해 주세요." };
  if (Object.values(input.draft.items).includes(garmentId))
    return { allowed: false, reason: "이미 다른 위치에 선택한 옷이에요." };
  const status = reviewAvailability(input.review, input.ownerId, garment);
  if (status !== "available")
    return {
      allowed: false,
      reason:
        status === "unknown"
          ? "사용 가능 여부를 먼저 확인해 주세요."
          : `${REVIEW_AVAILABILITY_LABELS[status]}인 옷은 교체 후보로 제안하지 않아요.`,
    };
  return { allowed: true, reason: "" };
}
export function reviewReplacementCandidates(
  input: OutfitReviewInput,
  slot: Slot,
): ReplacementCandidate[] {
  if (input.draft.ownerId !== input.ownerId || !REVIEW_SLOTS.includes(slot))
    return [];
  const inventory = ownedInventory(input.ownerId, input.garments),
    current = inventory.get(input.draft.items[slot] ?? "");
  return Array.from(inventory.values())
    .filter(
      (garment) =>
        garment.category === slot &&
        !Object.values(input.draft.items).includes(garment.id),
    )
    .map((garment) => {
      const status = reviewAvailability(input.review, input.ownerId, garment),
        decision = replacementDecision(input, slot, garment.id);
      const reasons = [`내 옷장의 ${REVIEW_SLOT_LABELS[slot]}`];
      if (garment.color.trim())
        reasons.push(
          current?.category === slot &&
            current.color.trim() === garment.color.trim()
            ? `현재 옷과 같은 등록 색상 · ${garment.color.trim()}`
            : `등록 색상 · ${garment.color.trim()}`,
        );
      else reasons.push("색상 정보 확인 필요");
      return {
        garment,
        status,
        reasons,
        canReplace: decision.allowed,
        restriction: decision.reason,
      };
    })
    .sort(
      (a, b) =>
        Number(b.canReplace) - Number(a.canReplace) ||
        a.garment.name.localeCompare(b.garment.name, "ko") ||
        a.garment.id.localeCompare(b.garment.id),
    );
}
