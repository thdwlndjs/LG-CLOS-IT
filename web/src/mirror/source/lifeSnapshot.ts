import type { DemoState, OutfitConditions } from "./core/types";
import { parseCareEvidence, type CareEvidenceItem } from "./careEvidence";
import type { AvailabilityConfirmation } from "./outfitReview";
import { stable } from "./core/repository";
import {
  effectiveLifeEvents,
  garmentLifeSummary,
  lifeDate,
  lifeTimestamp,
} from "./lifeHistory";

export type LifeProvenance = "scenario_fixture" | "user_confirmed";
export interface LifePreference {
  id: string;
  ownerId: string;
  kind: "explicit_preference" | "like";
  key?: string;
  value?: string[];
  context?: string;
  outfitId?: string;
  sourceRef: string;
  provenance: LifeProvenance;
}
export interface LifeWeather {
  status: "available" | "unavailable" | "not_used";
  kind?: "forecast" | "observation";
  sourceRef?: string;
  provenance:
    "scenario_fixture" | "provider" | "user_confirmed" | "unavailable";
  issuedAt?: string;
  validFrom?: string;
  validTo?: string;
  precipitation?: "rain" | "none" | "snow";
  temperatureC?: number;
}
export interface LifeContext {
  id: string;
  ownerId: string;
  asOf: string;
  timeZone: string;
  purpose: string;
  sourceRef: string;
  provenance: LifeProvenance;
  weather: LifeWeather;
}
export interface LifeProfileData {
  ownerId: string;
  namespace: string;
  provenance: LifeProvenance;
  revision: number;
  activeContextId?: string;
  preferences: LifePreference[];
  contexts: LifeContext[];
}
export interface LifeSnapshotOptions {
  contextId?: string;
  date?: string;
  conditions?: Record<string, unknown> | OutfitConditions;
  availabilityConfirmations?: AvailabilityConfirmation[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 300): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const instant = (v: unknown): v is string =>
  text(v, 60) &&
  /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
const provenance = (v: unknown): v is LifeProvenance =>
  v === "scenario_fixture" || v === "user_confirmed";
const optionalText = (v: unknown, max = 300) => v === undefined || text(v, max);
const unique = (items: { id: string }[]) =>
  new Set(items.map((v) => v.id)).size === items.length;
function validWeather(v: unknown): v is LifeWeather {
  if (
    !record(v) ||
    !["available", "unavailable", "not_used"].includes(String(v.status)) ||
    !["scenario_fixture", "provider", "user_confirmed", "unavailable"].includes(
      String(v.provenance),
    )
  )
    return false;
  if (v.status !== "available")
    return (
      v.kind === undefined &&
      v.temperatureC === undefined &&
      v.precipitation === undefined
    );
  return (
    ["forecast", "observation"].includes(String(v.kind)) &&
    v.provenance !== "unavailable" &&
    text(v.sourceRef, 1000) &&
    instant(v.issuedAt) &&
    instant(v.validFrom) &&
    instant(v.validTo) &&
    Date.parse(v.validFrom) <= Date.parse(v.validTo) &&
    Date.parse(v.issuedAt) <= Date.parse(v.validTo) &&
    (v.precipitation === undefined ||
      ["rain", "none", "snow"].includes(String(v.precipitation))) &&
    (v.temperatureC === undefined ||
      (typeof v.temperatureC === "number" &&
        Number.isFinite(v.temperatureC) &&
        v.temperatureC >= -100 &&
        v.temperatureC <= 70))
  );
}
/** Parse the existing profile settings field. Malformed/cross-owner records never become context. */
export function parseLifeProfileData(
  raw: unknown,
  ownerId: string,
): LifeProfileData | null {
  if (
    !record(raw) ||
    raw.ownerId !== ownerId ||
    !text(raw.namespace, 160) ||
    !provenance(raw.provenance) ||
    !Number.isSafeInteger(raw.revision) ||
    Number(raw.revision) < 1 ||
    !Array.isArray(raw.preferences) ||
    raw.preferences.length > 100 ||
    !Array.isArray(raw.contexts) ||
    raw.contexts.length > 50
  )
    return null;
  const preferences: LifePreference[] = [],
    contexts: LifeContext[] = [];
  for (const p of raw.preferences) {
    if (
      !record(p) ||
      !text(p.id, 200) ||
      p.ownerId !== ownerId ||
      !provenance(p.provenance) ||
      !text(p.sourceRef, 1000) ||
      !optionalText(p.context) ||
      !["explicit_preference", "like"].includes(String(p.kind))
    )
      return null;
    if (
      p.kind === "explicit_preference" &&
      (!text(p.key) ||
        !Array.isArray(p.value) ||
        !p.value.length ||
        p.value.length > 30 ||
        !p.value.every((v) => text(v)))
    )
      return null;
    if (p.kind === "like" && !text(p.outfitId, 200)) return null;
    preferences.push({
      id: p.id,
      ownerId,
      kind: p.kind as LifePreference["kind"],
      sourceRef: p.sourceRef,
      provenance: p.provenance,
      ...(p.kind === "explicit_preference"
        ? { key: p.key as string, value: [...(p.value as string[])] }
        : { outfitId: p.outfitId as string }),
      ...(p.context ? { context: p.context as string } : {}),
    });
  }
  for (const c of raw.contexts) {
    if (
      !record(c) ||
      !text(c.id, 200) ||
      c.ownerId !== ownerId ||
      !instant(c.asOf) ||
      !text(c.timeZone, 80) ||
      !text(c.purpose, 300) ||
      !text(c.sourceRef, 1000) ||
      !provenance(c.provenance) ||
      !validWeather(c.weather)
    )
      return null;
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: c.timeZone }).format(
        new Date(c.asOf),
      );
    } catch {
      return null;
    }
    const w = c.weather;
    contexts.push({
      id: c.id,
      ownerId,
      asOf: c.asOf,
      timeZone: c.timeZone,
      purpose: c.purpose,
      sourceRef: c.sourceRef,
      provenance: c.provenance,
      weather: {
        status: w.status,
        provenance: w.provenance,
        ...(w.status === "available"
          ? {
              kind: w.kind,
              sourceRef: w.sourceRef,
              issuedAt: w.issuedAt,
              validFrom: w.validFrom,
              validTo: w.validTo,
              ...(w.precipitation ? { precipitation: w.precipitation } : {}),
              ...(w.temperatureC !== undefined
                ? { temperatureC: w.temperatureC }
                : {}),
            }
          : {}),
      },
    });
  }
  if (
    !unique(preferences) ||
    !unique(contexts) ||
    (raw.activeContextId !== undefined &&
      (!text(raw.activeContextId, 200) ||
        !contexts.some((c) => c.id === raw.activeContextId)))
  )
    return null;
  return {
    ownerId,
    namespace: raw.namespace,
    provenance: raw.provenance,
    revision: Number(raw.revision),
    preferences,
    contexts,
    ...(raw.activeContextId
      ? { activeContextId: raw.activeContextId as string }
      : {}),
  };
}
export function lifeContextDate(context: LifeContext): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: context.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(context.asOf));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function readHistoryAt(
  state: DemoState,
  ownerId: string,
  context: LifeContext | null | undefined,
) {
  const now = Date.now();
  if (context?.provenance !== "scenario_fixture")
    return { asOf: new Date(now).toISOString(), timeZone: "Asia/Seoul" };
  let asOf = Date.parse(context.asOf);
  // The scenario baseline stays fixed. New explicitly confirmed, non-future runtime actions
  // can advance its read window; scheduled dates and authored fixtures cannot move the clock.
  for (const event of effectiveLifeEvents(ownerId, state.events ?? [], {
    asOf: new Date(now).toISOString(),
    timeZone: context.timeZone,
  }).events) {
    if (event.inputSource !== "user_confirmed") continue;
    if (event.timePrecision === "date") {
      // A legacy plan's synthetic noon is its target date, not when it was recorded.
      // Same-day care/wear already passes the date-aware reader. A later confirmed
      // calendar day resumes the current read window without inventing an event time.
      const day = lifeDate(event.occurredAt, context.timeZone),
        today = lifeDate(new Date(now).toISOString(), context.timeZone);
      if (
        event.kind !== "plan" &&
        day &&
        today &&
        day > lifeContextDate(context) &&
        day <= today
      )
        asOf = Math.max(asOf, now);
      continue;
    }
    const occurred = lifeTimestamp(event.occurredAt);
    if (occurred !== null && occurred <= now) asOf = Math.max(asOf, occurred);
  }
  return {
    asOf:
      asOf === Date.parse(context.asOf)
        ? context.asOf
        : new Date(asOf).toISOString(),
    timeZone: context.timeZone,
  };
}
export function lifeHistoryReadOptions(state: DemoState, ownerId: string) {
  const data = parseLifeProfileData(state.lifeData?.[ownerId], ownerId),
    context = data?.contexts.find((c) => c.id === data.activeContextId);
  return readHistoryAt(state, ownerId, context);
}
function weatherFor(context: LifeContext | null) {
  if (!context) return null;
  const w = context.weather;
  if (
    w.status !== "available" ||
    !w.validFrom ||
    !w.validTo ||
    !w.issuedAt ||
    Date.parse(context.asOf) < Date.parse(w.validFrom) ||
    Date.parse(context.asOf) > Date.parse(w.validTo) ||
    Date.parse(w.issuedAt) > Date.parse(context.asOf)
  )
    return null;
  const sourceLabel =
    w.provenance === "scenario_fixture"
      ? "시연 날씨"
      : w.provenance === "provider"
        ? "제공처 날씨"
        : "직접 입력 날씨";
  const kind = w.kind === "forecast" ? "예보" : "관측";
  const precipitation =
    w.precipitation === "rain"
      ? "비"
      : w.precipitation === "snow"
        ? "눈"
        : w.precipitation === "none"
          ? "강수 없음"
          : "강수 미확인";
  return {
    ...w,
    summary: `${kind} · ${precipitation}${w.temperatureC === undefined ? "" : ` · ${w.temperatureC}°C`}`,
    sourceLabel,
  };
}
/** Conditions describe requested styling; they never manufacture observed weather or authority. */
function requestedConditions(raw: LifeSnapshotOptions["conditions"]) {
  if (!raw) return null;
  return {
    provenance: "user_requested" as const,
    weather: typeof raw.weather === "string" ? raw.weather.slice(0, 100) : null,
    temperatureC:
      typeof raw.temperatureC === "number" && Number.isFinite(raw.temperatureC)
        ? raw.temperatureC
        : null,
    occasion:
      typeof raw.occasion === "string" ? raw.occasion.slice(0, 300) : null,
  };
}
function evidenceFor(
  state: DemoState,
  ownerId: string,
  ids: Set<string>,
): CareEvidenceItem[] {
  const input = Array.isArray(state.careEvidence) ? state.careEvidence : [],
    output: CareEvidenceItem[] = [];
  for (const item of input) {
    if (
      !item ||
      item.ownerId !== ownerId ||
      !ids.has(item.garmentId) ||
      input.filter((e) => e?.id === item.id).length !== 1
    )
      continue;
    try {
      parseCareEvidence(
        { ownerId, garmentId: item.garmentId, evidence: [item] },
        ownerId,
        item.garmentId,
      );
      const {
        id,
        garmentId,
        kind,
        originalText,
        sourceRef,
        observedAt,
        asset,
      } = item;
      output.push({
        id,
        ownerId,
        garmentId,
        kind,
        originalText,
        sourceRef,
        observedAt,
        asset: asset
          ? {
              id: asset.id,
              version: asset.version,
              url: asset.url,
              mimeType: asset.mimeType,
            }
          : null,
      });
    } catch {
      /* Corrupt local evidence cannot become model input. */
    }
  }
  return structuredClone(output).sort((a, b) => a.id.localeCompare(b.id));
}
/** Pure, profile-scoped snapshot. No clock tick, network request, mutation, inference of availability, or fallback profile. */
export function buildLifeSnapshot(
  state: DemoState,
  ownerId: string,
  options: LifeSnapshotOptions = {},
) {
  const data = (state.profiles ?? []).some((p) => p.id === ownerId)
    ? parseLifeProfileData(state.lifeData?.[ownerId], ownerId)
    : null;
  const selected = data?.contexts.find(
    (c) => c.id === (options.contextId ?? data.activeContextId),
  );
  const context =
    selected && (!options.date || lifeContextDate(selected) === options.date)
      ? selected
      : null;
  const owned = state.garments
      .filter((g) => g.ownerId === ownerId)
      .sort((a, b) => a.id.localeCompare(b.id)),
    ids = new Set(owned.map((g) => g.id));
  const outfits = (state.outfits ?? [])
    .filter(
      (o) =>
        o.ownerId === ownerId &&
        Object.values(o.items).every((id) => ids.has(id)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const eventSources = (state.events ?? [])
    .filter(
      (e) =>
        e.ownerId === ownerId &&
        (!e.garmentId || ids.has(e.garmentId)) &&
        (!e.outfitId || outfits.some((o) => o.id === e.outfitId)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const preferences = (data?.preferences ?? [])
    .filter(
      (p) => p.kind !== "like" || outfits.some((o) => o.id === p.outfitId),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const evidence = evidenceFor(state, ownerId, ids);
  const readOptions = readHistoryAt(state, ownerId, context),
    events = effectiveLifeEvents(ownerId, eventSources, readOptions).events;
  const garments = owned.map((g) => {
    const { revisionKey: _historyRevision, ...history } = garmentLifeSummary(
      g.id,
      ownerId,
      outfits,
      eventSources,
      readOptions,
    );
    return {
      id: g.id,
      ownerId: g.ownerId,
      name: g.name,
      category: g.category,
      color: g.color,
      features: [...g.features],
      material: g.material,
      revision: g.revision,
      asset: g.asset ? { id: g.asset.id, version: g.asset.version } : null,
      careNotes: g.careNotes,
      provenance: g.provenance,
      history,
    };
  });
  const confirmations = (options.availabilityConfirmations ?? [])
    .filter((c) => ids.has(c.garmentId))
    .sort((a, b) => a.garmentId.localeCompare(b.garmentId));
  const weather = weatherFor(context),
    explicit = preferences.filter((p) => p.kind === "explicit_preference");
  const shortFact = [
    weather ? `${weather.sourceLabel} ${weather.summary}.` : "",
    explicit.length ? `명시한 취향 ${explicit.length}개를 함께 확인해요.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const facts = {
    ownerId,
    namespace: data?.namespace ?? null,
    provenance: data?.provenance ?? null,
    profileRevision: data?.revision ?? null,
    context,
    weather,
    preferences,
    garments,
    events,
    evidence,
    conditions: requestedConditions(options.conditions),
    availabilityConfirmations: confirmations,
  };
  // Canonical content, not a security token. The server hashes it before placing it in provider context.
  return {
    ...structuredClone(facts),
    shortFact,
    revisionKey: stable({ ...facts, eventSources }),
  };
}
export type LifeSnapshot = ReturnType<typeof buildLifeSnapshot>;

/** A request checkbox is not a recorded resolution of an outstanding care observation. */
export function lifeAvailabilityBlock(history: { availability: string }) {
  return history.availability === "drying_unconfirmed" ||
    history.availability === "user_marked_laundry_pending"
    ? history.availability
    : null;
}
