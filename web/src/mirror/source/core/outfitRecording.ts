import { clone, DemoError, stable } from "./repository";
import type { DemoState, Outfit, OutfitRecordContext } from "./types";
/** UUID v5 only identifies a local operation; it grants no ownership or execution permission. */
export async function recordingIdentity(value: unknown): Promise<string> {
  const namespace = "8b05e5775e0c567baee78b5e6a46c478",
    name = new TextEncoder().encode(stable(value)),
    bytes = new Uint8Array(16 + name.length);
  bytes.set(namespace.match(/../g)!.map((x) => parseInt(x, 16)));
  bytes.set(name, 16);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", bytes),
  ).slice(0, 16);
  digest[6] = (digest[6] & 15) | 80;
  digest[8] = (digest[8] & 63) | 128;
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function recordContext(
  ownerId: string,
  kind: OutfitRecordContext["kind"],
  date: string,
  sourceDraftId: string,
  sourceRevision: number,
  intentKey?: string,
): Promise<OutfitRecordContext> {
  if (intentKey !== undefined && (!intentKey.trim() || intentKey.length > 160))
    throw new DemoError("VALIDATION", "원래 기록 요청 키를 확인해 주세요.");
  const intentId = await recordingIdentity([
    ownerId,
    kind,
    intentKey === undefined ? [sourceDraftId, sourceRevision, date] : intentKey,
  ]);
  return {
    kind,
    date,
    sourceDraftId,
    sourceRevision,
    ...(intentKey !== undefined ? { intentKey } : {}),
    intentId,
  };
}
/** Classify legacy technical records from durable operation identities, never their visible title. */
export function outfitPurpose(
  outfit: Outfit,
  state: Pick<DemoState, "receipts" | "intents">,
): NonNullable<Outfit["purpose"]> {
  if (outfit.purpose) return outfit.purpose;
  for (const receipt of state.receipts.filter(
    (r) =>
      r.ownerId === outfit.ownerId &&
      r.entityId === outfit.id &&
      r.operation === "saveOutfit",
  )) {
    for (const [kind, prefix] of [
      ["selection", "selection-snapshot-v1:"],
      ["wear", "wear-snapshot-v1:"],
    ] as const) {
      const intent =
        state.intents[
          stable([outfit.ownerId, "saveOutfit", prefix + receipt.draftId])
        ];
      if (intent?.receiptId === receipt.id) return kind;
    }
  }
  return "card";
}
export function withPurpose(
  outfit: Outfit,
  purpose: Outfit["purpose"],
): Outfit {
  return { ...clone(outfit), purpose };
}
