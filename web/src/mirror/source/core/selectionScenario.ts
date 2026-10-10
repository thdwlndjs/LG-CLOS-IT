import { clone, DemoError, isISODate, stable } from "./repository";
import { recordContext } from "./outfitRecording";
import { outfitAssetRefs } from "./outfitAssets";
import {
  completeOutfit,
  hasExternalItems,
  validateExternalSelections,
} from "./externalOutfits";
import type {
  DemoEvent,
  Garment,
  Outfit,
  OutfitDraft,
  OutfitItems,
} from "./types";

/** The selected look, captured on the explicit B5 action; it is not evidence of actual wear. */
export interface SelectionSnapshot {
  ownerId: string;
  date: string;
  sourceDraftId?: string;
  intentKey?: string;
  assetIds?: Record<string, string | null>;
  items: OutfitItems;
  externalItems?: OutfitDraft["externalItems"];
  assetVersions: Record<string, number>;
  lookRevision: number;
}
export interface SelectionSubmission {
  source: { ownerId: string; draftId: string; revision: number };
  submittedSnapshot: SelectionSnapshot;
}
export interface CommitCurrentSelectionResult extends SelectionSubmission {
  event: DemoEvent;
  savedOutfit: Outfit;
  garmentIds: string[];
  replayed: boolean;
}

export function captureSelectionSnapshot(
  draft: OutfitDraft,
  date: string,
  garments: readonly Garment[],
  intentKey?: string,
): SelectionSnapshot {
  if (!isISODate(date))
    throw new DemoError("VALIDATION", "유효한 선택 날짜를 확인해 주세요.");
  if (
    !completeOutfit(draft) ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 1
  )
    throw new DemoError(
      "VALIDATION",
      "기록할 코디의 상의·하의와 버전을 확인해 주세요.",
    );
  validateExternalSelections(draft);
  if (!Object.keys(draft.items).length)
    throw new DemoError(
      "VALIDATION",
      "오늘 선택 기록에는 실제 보유 의류가 한 품목 이상 필요해요. 구매 후보 코디카드는 별도로 저장할 수 있어요.",
    );
  const assetVersions: Record<string, number> = {};
  for (const [slot, garmentId] of Object.entries(draft.items)) {
    const matches = garments.filter(
      (garment) =>
        garment.id === garmentId && garment.ownerId === draft.ownerId,
    );
    if (matches.length !== 1 || matches[0].category !== slot)
      throw new DemoError(
        "VALIDATION",
        "현재 사용자의 같은 종류 의류로 구성된 코디를 선택해 주세요.",
      );
    assetVersions[garmentId] = matches[0].asset?.version ?? 0;
  }
  const refs = outfitAssetRefs(draft, garments);
  return {
    ownerId: draft.ownerId,
    date,
    sourceDraftId: draft.draftId,
    ...(intentKey !== undefined ? { intentKey } : {}),
    assetIds: refs.assetIds,
    items: clone(draft.items),
    ...(hasExternalItems(draft)
      ? { externalItems: clone(draft.externalItems) }
      : {}),
    assetVersions,
    lookRevision: draft.revision,
  };
}

/** Keep this detached submission if a failed request must be retried after further editing. */
export function captureSelectionSubmission(
  draft: OutfitDraft,
  date: string,
  garments: readonly Garment[],
  intentKey?: string,
): SelectionSubmission {
  return {
    source: {
      ownerId: draft.ownerId,
      draftId: draft.draftId,
      revision: draft.revision,
    },
    submittedSnapshot: captureSelectionSnapshot(
      draft,
      date,
      garments,
      intentKey,
    ),
  };
}

/** A separate UUID v5 namespace prevents plan selections from aliasing actual-wear intents. */
export async function selectionSnapshotDraft(
  snapshot: SelectionSnapshot,
): Promise<OutfitDraft> {
  const namespace = "c86f16e0e6b8503bb2ca3bdd039ba217";
  const name = new TextEncoder().encode(stable(snapshot));
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
  const context = snapshot.sourceDraftId
    ? await recordContext(
        snapshot.ownerId,
        "selection",
        snapshot.date,
        snapshot.sourceDraftId,
        snapshot.lookRevision,
        snapshot.intentKey,
      )
    : undefined;
  return {
    draftId,
    ownerId: snapshot.ownerId,
    ...(context
      ? {
          purpose: "selection" as const,
          recordContext: context,
          ...(snapshot.assetIds ? { assetIds: clone(snapshot.assetIds) } : {}),
          assetVersions: clone(snapshot.assetVersions),
        }
      : {}),
    revision: snapshot.lookRevision,
    name: `오늘의 코디 · ${snapshot.date}`,
    items: clone(snapshot.items),
    ...(hasExternalItems(snapshot)
      ? { externalItems: clone(snapshot.externalItems) }
      : {}),
    topLocked: false,
  };
}
export const selectionSnapshotIntent = (draftId: string, intentId?: string) =>
  intentId
    ? `selection-snapshot-v2:${intentId}`
    : `selection-snapshot-v1:${draftId}`;
export const selectionEventIntent = (draftId: string, intentId?: string) =>
  intentId ? `selection-plan-v2:${intentId}` : `selection-plan-v1:${draftId}`;

/** Identify only our content-addressed internal snapshot, never a user draft with a similar name. */
export async function isSelectionSnapshotDraft(
  draft: OutfitDraft,
  assetVersions: Record<string, number>,
): Promise<boolean> {
  const prefix = "오늘의 코디 · ",
    date = draft.name?.startsWith(prefix)
      ? draft.name.slice(prefix.length)
      : "";
  if (
    !isISODate(date) ||
    draft.topLocked !== false ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 1
  )
    return false;
  const context = draft.recordContext;
  const expected = await selectionSnapshotDraft({
    ownerId: draft.ownerId,
    date,
    ...(context
      ? {
          sourceDraftId: context.sourceDraftId,
          ...(context.intentKey !== undefined
            ? { intentKey: context.intentKey }
            : {}),
          ...(draft.assetIds ? { assetIds: draft.assetIds } : {}),
        }
      : {}),
    items: draft.items,
    ...(hasExternalItems(draft) ? { externalItems: draft.externalItems } : {}),
    assetVersions,
    lookRevision: draft.revision,
  });
  return (
    expected.draftId === draft.draftId &&
    (!context ||
      (context.kind === "selection" &&
        context.date === date &&
        stable(expected.recordContext) === stable(context)))
  );
}
