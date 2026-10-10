import type { StorageLike } from "./core/types";
import { isISODate } from "./core/repository";

export interface PendingWearConfirmation {
  ownerId: string;
  date: string;
  planId: string;
  outfitId: string;
  intentKey: string;
}
export type WearRepositoryScope = "local" | "supabase";
export const pendingWearStorageKey = (
  scope: WearRepositoryScope,
  ownerId: string,
) =>
  `smartcloset.actual-wear.pending.v1:${scope}:${encodeURIComponent(ownerId)}`;
const fields = ["ownerId", "date", "planId", "outfitId", "intentKey"] as const;
const identity = (value: Omit<PendingWearConfirmation, "intentKey">) =>
  JSON.stringify([value.ownerId, value.date, value.planId, value.outfitId]);
const valid = (value: unknown): value is PendingWearConfirmation =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every(
    (key) =>
      typeof (value as any)[key] === "string" &&
      (value as any)[key].length > 0 &&
      (value as any)[key].length <= 200,
  ) &&
  isISODate((value as any).date) &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (value as any).intentKey,
  );
const unavailable = () =>
  new Error(
    "확인 요청을 안전하게 보존하지 못했어요. 새 착용 기록을 보내지 않았어요. 브라우저 저장 공간을 확인해 주세요.",
  );
function read(
  storage: StorageLike,
  scope: WearRepositoryScope,
  ownerId: string,
): PendingWearConfirmation[] {
  try {
    const raw = storage.getItem(pendingWearStorageKey(scope, ownerId));
    if (raw === null) return [];
    const rows: unknown = JSON.parse(raw);
    if (
      !Array.isArray(rows) ||
      rows.length > 100 ||
      rows.some((row) => !valid(row) || row.ownerId !== ownerId) ||
      new Set(rows.map(identity)).size !== rows.length
    )
      throw new Error();
    return rows.map((row) => ({ ...row }));
  } catch {
    throw unavailable();
  }
}
/** Same-origin session storage holds only an already confirmed, unresolved intent. Never stores names or media. */
export function readPendingWear(
  storage: StorageLike,
  scope: WearRepositoryScope,
  target: Omit<PendingWearConfirmation, "intentKey">,
): PendingWearConfirmation | null {
  return (
    read(storage, scope, target.ownerId).find(
      (row) => identity(row) === identity(target),
    ) ?? null
  );
}
export function rememberPendingWear(
  storage: StorageLike,
  scope: WearRepositoryScope,
  value: PendingWearConfirmation,
): void {
  const safe = Object.fromEntries(
    fields.map((key) => [key, value[key]]),
  ) as unknown as PendingWearConfirmation;
  if (!valid(safe)) throw unavailable();
  const rows = read(storage, scope, safe.ownerId),
    existing = rows.find((row) => identity(row) === identity(safe));
  if (existing && existing.intentKey !== safe.intentKey)
    throw new Error(
      "앞서 확인한 착용 요청의 결과를 먼저 확인해 주세요. 새 요청은 보내지 않았어요.",
    );
  if (!existing) rows.push(safe);
  if (rows.length > 100) throw unavailable();
  try {
    const key = pendingWearStorageKey(scope, safe.ownerId),
      serialized = JSON.stringify(rows);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) throw new Error();
  } catch {
    throw unavailable();
  }
}
/** Remove only the exact confirmed receipt's intent; a later explicit wear remains separate. */
export function forgetPendingWear(
  storage: StorageLike,
  scope: WearRepositoryScope,
  value: PendingWearConfirmation,
): void {
  const rows = read(storage, scope, value.ownerId),
    remaining = rows.filter(
      (row) =>
        identity(row) !== identity(value) || row.intentKey !== value.intentKey,
    ),
    key = pendingWearStorageKey(scope, value.ownerId);
  try {
    if (remaining.length) {
      const serialized = JSON.stringify(remaining);
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) throw new Error();
    } else {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw new Error();
    }
  } catch {
    throw new Error(
      "실제 착용 기록은 확인했지만 요청 보관 정리를 마치지 못했어요. 같은 확인으로 결과를 다시 확인해 주세요.",
    );
  }
}
