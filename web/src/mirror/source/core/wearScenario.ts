import { DemoError, isISODate, stable } from "./repository";
import type { DemoEvent, Outfit, OutfitDraft, OutfitItems } from "./types";

export interface WearCurrentOutfitResult {
  event: DemoEvent;
  savedOutfit: Outfit;
  garmentIds: string[];
  replayed: boolean;
  source: { ownerId: string; draftId: string; revision: number };
}

/** One outfit composition and day has one durable identity, independent of UI edits/reloads. */
export async function wearSnapshotDraft(
  ownerId: string,
  date: string,
  items: OutfitItems,
): Promise<OutfitDraft> {
  if (!isISODate(date))
    throw new DemoError("VALIDATION", "유효한 착용 날짜를 선택해 주세요.");
  const name = new TextEncoder().encode(stable([ownerId, date, items]));
  // UUID v5 namespace for SmartCloset's internal wear snapshots; no random per-session key.
  const namespace = "b391f09a0c6251b9aa680f960317a232";
  const input = new Uint8Array(16 + name.length);
  input.set(namespace.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
  input.set(name, 16);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", input),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const draftId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return {
    draftId,
    ownerId,
    revision: 1,
    name: `오늘의 착용 · ${date}`,
    items: JSON.parse(JSON.stringify(items)),
    topLocked: false,
  };
}

export const wearSnapshotIntent = (draftId: string) =>
  `wear-snapshot-v1:${draftId}`;
export const wearEventIntent = (draftId: string) => `wear-event-v1:${draftId}`;

/** Verify the reserved snapshot identity as well as its name, including a interrupted save without a receipt. */
export async function isWearSnapshotDraft(
  draft: OutfitDraft,
): Promise<boolean> {
  const prefix = "오늘의 착용 · ";
  if (
    !draft.name?.startsWith(prefix) ||
    draft.revision !== 1 ||
    draft.topLocked !== false
  )
    return false;
  const date = draft.name.slice(prefix.length);
  return (
    isISODate(date) &&
    draft.draftId ===
      (await wearSnapshotDraft(draft.ownerId, date, draft.items)).draftId
  );
}

export interface GarmentWearSummary {
  wearDays: number;
  lastWornDate: string | null;
  dates: string[];
  unresolvedWearEvents: number;
}

/** Read-only: plans, selection, fitting, saving and care never count as wear. */
export function garmentWearSummary(
  garmentId: string,
  ownerId: string,
  outfits: readonly Outfit[],
  events: readonly DemoEvent[],
): GarmentWearSummary {
  const dates = new Set<string>();
  const unknown = new Set<string>();
  const ownedOutfits = new Map(
    outfits
      .filter((outfit) => outfit.ownerId === ownerId)
      .map((outfit) => [outfit.id, outfit]),
  );
  for (const event of events) {
    if (
      event.ownerId !== ownerId ||
      event.kind !== "wear" ||
      !isISODate(event.date)
    )
      continue;
    const outfit = event.outfitId
      ? ownedOutfits.get(event.outfitId)
      : undefined;
    if (!outfit) {
      unknown.add(event.id);
      continue;
    }
    if (Object.values(outfit.items).includes(garmentId)) dates.add(event.date);
  }
  const sortedDates = [...dates].sort().reverse();
  return {
    wearDays: dates.size,
    lastWornDate: sortedDates[0] ?? null,
    dates: sortedDates,
    unresolvedWearEvents: unknown.size,
  };
}
