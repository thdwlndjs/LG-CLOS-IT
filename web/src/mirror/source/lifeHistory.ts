import type { DemoEvent, Outfit } from "./core/types";

export const LIFE_TIME_ZONE = "Asia/Seoul";
export interface LifeReadOptions {
  asOf?: string;
  timeZone?: string;
}
export type LifeAvailability =
  | "drying_unconfirmed"
  | "user_marked_laundry_pending"
  | "no_recorded_block_not_cleanliness_confirmation";
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
          .join(",")}}`
      : JSON.stringify(value);
const isoDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
/** Never apply the machine timezone to an unqualified timestamp. */
export function lifeTimestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !isoDate(value.slice(0, 10))
  )
    return null;
  const time = value.slice(11, 19).split(":").map(Number);
  if (time[0] > 23 || time[1] > 59 || time[2] > 59) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function lifeDate(
  value: unknown,
  timeZone = LIFE_TIME_ZONE,
): string | null {
  const n = lifeTimestamp(value);
  if (n === null) return null;
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (dateFormatters.size >= 16) dateFormatters.clear();
    dateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(n);
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join("-");
}
export function lifeEventDate(
  event: DemoEvent,
  timeZone = LIFE_TIME_ZONE,
): string | null {
  if (event.kind === "plan" && event.scheduledAt !== undefined)
    return lifeDate(event.scheduledAt, timeZone);
  if (event.occurredAt !== undefined)
    return lifeDate(event.occurredAt, timeZone);
  return isoDate(event.date) ? event.date : null;
}
const families: Record<string, DemoEvent["kind"]> = {
  wear_confirmed: "wear",
  outfit_planned: "plan",
  movement_confirmed: "movement",
  wash_completed: "care",
  dry_completed: "care",
  iron_completed: "care",
  air_completed: "care",
  airing_completed: "care",
  professional_clean_completed: "care",
  professional_cleaning_completed: "care",
  user_observation: "care",
};
export function lifeEventKind(event: DemoEvent): string {
  if (event.lifeKind !== undefined)
    return families[event.lifeKind] === event.kind
      ? event.lifeKind
      : "unmapped";
  if (event.kind === "wear") return "wear_confirmed";
  if (event.kind === "plan") return "outfit_planned";
  if (event.kind === "movement") return "movement_confirmed";
  return (
    (
      {
        "세탁 완료": "wash_completed",
        "건조 완료": "dry_completed",
        "다림질 완료": "iron_completed",
        "환기 완료": "air_completed",
        "전문 관리 완료": "professional_clean_completed",
      } as Record<string, string>
    )[event.value] ?? "unmapped"
  );
}
export function lifeEventSource(event: DemoEvent): string {
  const imported = event.details?._life_data;
  if (
    imported &&
    typeof imported === "object" &&
    !Array.isArray(imported) &&
    (imported as Record<string, unknown>).provenance === "synthetic_life_event"
  )
    return "scenario_fixture";
  return event.inputSource ?? "unconfirmed";
}
/** Read projection only. Corrections must already be authorized/persisted; this never writes them. */
export function effectiveLifeEvents(
  ownerId: string,
  events: readonly DemoEvent[],
  options: LifeReadOptions = {},
) {
  const groups = new Map<string, DemoEvent[]>(),
    issues: string[] = [];
  const input = events.filter((event) => event.ownerId === ownerId);
  for (const event of input) {
    const key = event.sourceEventKey || event.id;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const current: DemoEvent[] = [];
  const limit = options.asOf === undefined ? null : lifeTimestamp(options.asOf);
  if (options.asOf !== undefined && limit === null)
    throw Error("An explicit timezone-qualified asOf is required");
  for (const [key, group] of groups) {
    if (
      group.some(
        (event) =>
          event.revision !== undefined &&
          (!Number.isSafeInteger(event.revision) || event.revision < 1),
      )
    ) {
      issues.push("invalid_revision:" + key);
      continue;
    }
    const revision = Math.max(...group.map((event) => event.revision ?? 1)),
      latest = group.filter((event) => (event.revision ?? 1) === revision);
    const content = (event: DemoEvent) =>
      canonical({ ...event, id: undefined });
    if (new Set(latest.map(content)).size !== 1) {
      issues.push("conflicting_event:" + key);
      continue;
    }
    const event = latest[0];
    if (event.voided === true) continue;
    if (!lifeEventDate(event, options.timeZone)) {
      issues.push("invalid_event_date:" + key);
      continue;
    }
    if (event.occurredAt !== undefined) {
      const timestamp = lifeTimestamp(event.occurredAt);
      if (timestamp === null) {
        issues.push("invalid_occurred_at:" + key);
        continue;
      }
      if (
        limit !== null &&
        (event.timePrecision === "date"
          ? event.kind !== "plan" &&
            lifeDate(event.occurredAt, options.timeZone)! >
              lifeDate(options.asOf, options.timeZone)!
          : timestamp > limit)
      )
        continue;
    } else if (
      limit !== null &&
      event.kind !== "plan" &&
      event.date > lifeDate(options.asOf, options.timeZone)!
    )
      continue;
    current.push(event);
  }
  current.sort(
    (a, b) =>
      (a.occurredAt !== undefined && b.occurredAt !== undefined
        ? lifeTimestamp(a.occurredAt)! - lifeTimestamp(b.occurredAt)!
        : a.date.localeCompare(b.date)) || a.id.localeCompare(b.id),
  );
  // Includes voided, conflicting and changed source records, so downstream caches cannot retain old derivations.
  const revisionKey = canonical([
    ownerId,
    options.timeZone ?? LIFE_TIME_ZONE,
    options.asOf ?? null,
    input.map((event) => canonical(event)).sort(),
  ]);
  return { events: current, issues, revisionKey };
}
export interface GarmentLifeSummary {
  wearCount: number;
  wearDays: number;
  dates: string[];
  lastWornDate: string | null;
  lastWashAt: string | null;
  lastWashDate: string | null;
  wearsAfterLastWash: number | null;
  wearDaysAfterLastWash: number | null;
  datesAfterLastWash: string[];
  availability: LifeAvailability;
  cleanlinessConfirmed: false;
  unresolvedWearEvents: number;
  issues: string[];
  evidenceEventIds: string[];
  sourceKinds: string[];
  revisionKey: string;
  display: string;
}
/** A retained event garment snapshot wins over a subsequently edited outfit. */
export function garmentLifeSummary(
  garmentId: string,
  ownerId: string,
  outfits: readonly Outfit[],
  events: readonly DemoEvent[],
  options: LifeReadOptions = {},
): GarmentLifeSummary {
  const effective = effectiveLifeEvents(ownerId, events, options),
    ownedOutfits = new Map(
      outfits
        .filter((outfit) => outfit.ownerId === ownerId)
        .map((outfit) => [outfit.id, outfit]),
    );
  const unresolved = new Set<string>();
  const relevant = effective.events.filter((event) => {
    if (event.garmentIds !== undefined)
      return event.garmentIds.includes(garmentId);
    if (event.garmentId) return event.garmentId === garmentId;
    const outfit = event.outfitId
      ? ownedOutfits.get(event.outfitId)
      : undefined;
    if (!outfit) {
      if (lifeEventKind(event) === "wear_confirmed") unresolved.add(event.id);
      return false;
    }
    return Object.values(outfit.items).includes(garmentId);
  });
  const wears = relevant.filter(
      (event) => lifeEventKind(event) === "wear_confirmed",
    ),
    washes = relevant.filter(
      (event) => lifeEventKind(event) === "wash_completed",
    ),
    lastWash = washes.at(-1);
  const date = (event: DemoEvent) => lifeEventDate(event, options.timeZone)!;
  const dates = [...new Set(wears.map(date))].sort().reverse();
  // Legacy date-only records cannot establish ordering within the same day; do not guess noon.
  const after = (event: DemoEvent, baseline: DemoEvent): boolean | null =>
    event.occurredAt !== undefined &&
    baseline.occurredAt !== undefined &&
    event.timePrecision !== "date" &&
    baseline.timePrecision !== "date"
      ? lifeTimestamp(event.occurredAt)! > lifeTimestamp(baseline.occurredAt)!
      : date(event) === date(baseline)
        ? null
        : date(event) > date(baseline);
  const orderingUnknown =
    !!lastWash && wears.some((event) => after(event, lastWash) === null);
  const afterWears = lastWash
    ? wears.filter((event) => after(event, lastWash) === true)
    : [];
  const afterDates = [...new Set(afterWears.map(date))].sort().reverse();
  const dryingPending =
    !!lastWash &&
    !relevant.some(
      (event) =>
        lifeEventKind(event) === "dry_completed" &&
        after(event, lastWash) === true,
    );
  const laundryPending = relevant.some(
    (event) =>
      lifeEventKind(event) === "user_observation" &&
      event.details?.laundry_review_requested === true &&
      (!lastWash || after(event, lastWash) === true),
  );
  const availability: LifeAvailability = dryingPending
    ? "drying_unconfirmed"
    : laundryPending
      ? "user_marked_laundry_pending"
      : "no_recorded_block_not_cleanliness_confirmation";
  const issues = [
    ...effective.issues,
    ...(orderingUnknown ? ["wash_wear_order_unknown"] : []),
  ];
  const countKnown =
    !!lastWash && !orderingUnknown && effective.issues.length === 0;
  const display = effective.issues.length
    ? "일부 이력에 충돌·미확인 항목이 있어 확인이 필요해요."
    : !wears.length
      ? "확인된 착용 기록이 없어요."
      : countKnown
        ? `마지막 세탁 뒤 기록된 착용 ${afterWears.length}회 · ${afterDates.length}일`
        : lastWash
          ? "같은 날 세탁·착용의 순서를 확인해야 해요."
          : `기록된 착용 ${wears.length}회 · 마지막 세탁 기록은 없어요.`;
  return {
    wearCount: wears.length,
    wearDays: dates.length,
    dates,
    lastWornDate: dates[0] ?? null,
    lastWashAt:
      lastWash?.timePrecision === "date"
        ? null
        : (lastWash?.occurredAt ?? null),
    lastWashDate: lastWash ? date(lastWash) : null,
    wearsAfterLastWash: countKnown ? afterWears.length : null,
    wearDaysAfterLastWash: countKnown ? afterDates.length : null,
    datesAfterLastWash: countKnown ? afterDates : [],
    availability,
    cleanlinessConfirmed: false,
    unresolvedWearEvents: unresolved.size,
    issues,
    evidenceEventIds: relevant.map((event) => event.id),
    sourceKinds: [...new Set(relevant.map(lifeEventSource))].sort(),
    revisionKey: effective.revisionKey,
    display,
  };
}
