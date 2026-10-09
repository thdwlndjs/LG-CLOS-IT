import { completeOutfit } from "./core/externalOutfits";
import type { Garment, Outfit, OutfitDraft, Slot } from "./core/types";

/** Scene geometry and confirmed location bindings are supplied by the scene, never guessed here. */
export interface CompartmentDefinition {
  id: string;
  label: string;
  side: "left" | "right";
}
export interface LocationBinding {
  locationRef: string;
  compartmentId: string;
  ownerId?: string;
}
export type LocationGuide =
  | { kind: "none" }
  | { kind: "garment"; garmentId: string }
  | { kind: "outfit" };
export type LocationStatus =
  | "mapped"
  | "no-selection"
  | "not-found"
  | "other-owner"
  | "unknown"
  | "unmapped"
  | "ambiguous";
export interface LocationResolution {
  status: LocationStatus;
  garmentId: string | null;
  garmentName: string | null;
  locationRef: string | null;
  compartmentId: string | null;
  message: string;
}
export interface LocationContext {
  ownerId: string;
  garments: readonly Garment[];
  compartments: readonly CompartmentDefinition[];
  bindings: readonly LocationBinding[];
  /** Explicitly approved display-only placement; never a physical location or movement record. */
  demoLocations?: { ownerId: string; byGarmentId: Record<string, string> };
}
export interface SceneOutfitItem {
  slot: Slot;
  garmentId: string;
  garment: Garment;
  location: LocationResolution;
}
export interface SceneCompartment extends CompartmentDefinition {
  garments: Garment[];
  inspectedGarmentId: string | null;
  outfitGarmentIds: string[];
  guidedGarmentIds: string[];
  ledOn: boolean;
  ledLabel: string;
}
export const MIRROR_LED_LABEL = "옷장 LED 시뮬레이션";
export const OUTFIT_SLOTS: readonly Slot[] = [
  "top",
  "bottom",
  "outer",
  "bag",
  "shoes",
  "hat",
  "accessory",
];
export type SceneOutfit = Outfit | OutfitDraft;

const isPositiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value > 0;
const isNonempty = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;
const unknownLocations = new Set([
  "",
  "미확인",
  "위치미확인",
  "알수없음",
  "unknown",
]);

export function resolveGarmentLocation(
  context: LocationContext & { garmentId: string | null },
): LocationResolution {
  const { garmentId } = context;
  const base = {
    garmentId,
    garmentName: null,
    locationRef: null,
    compartmentId: null,
  };
  if (!garmentId)
    return {
      ...base,
      status: "no-selection",
      message: "위치를 안내할 의류를 선택하세요.",
    };
  const owned = context.garments.filter(
    (item) => item.id === garmentId && item.ownerId === context.ownerId,
  );
  if (owned.length === 0)
    return context.garments.some((item) => item.id === garmentId)
      ? {
          ...base,
          status: "other-owner",
          message: "다른 소유자의 의류 위치는 안내하지 않습니다.",
        }
      : {
          ...base,
          status: "not-found",
          message: "선택한 의류를 찾을 수 없습니다.",
        };
  if (owned.length !== 1)
    return {
      ...base,
      status: "ambiguous",
      message: "의류 참조가 중복되어 위치를 확정할 수 없습니다.",
    };
  const garment = owned[0];
  const fixtureLocation =
    garment.provenance.location === "unconfirmed" &&
    context.demoLocations?.ownerId === context.ownerId
      ? context.demoLocations.byGarmentId[garment.id]
      : undefined;
  const locationRef = (fixtureLocation ?? garment.location).trim();
  const known = { ...base, garmentName: garment.name, locationRef };
  if (
    !fixtureLocation &&
    (garment.provenance.location === "unconfirmed" ||
      unknownLocations.has(locationRef.replace(/\s/g, "").toLowerCase()))
  ) {
    return {
      ...known,
      status: "unknown",
      message: "보관 위치 미확인 · LED를 켜지 않습니다.",
    };
  }
  const matching = context.bindings.filter(
    (binding) =>
      binding.locationRef.trim() === locationRef &&
      (binding.ownerId === undefined || binding.ownerId === context.ownerId),
  );
  const targets = [
    ...new Set(matching.map((binding) => binding.compartmentId)),
  ];
  if (targets.length > 1)
    return {
      ...known,
      status: "ambiguous",
      message: "위치가 여러 칸에 연결되어 LED를 켜지 않습니다.",
    };
  const compartments = context.compartments.filter(
    (compartment) => compartment.id === targets[0],
  );
  if (compartments.length > 1)
    return {
      ...known,
      status: "ambiguous",
      message: "수납 칸 참조가 중복되어 LED를 켜지 않습니다.",
    };
  if (targets.length === 0 || compartments.length === 0) {
    return {
      ...known,
      status: "unmapped",
      message: `${garment.location} · 대응하는 수납 칸이 확인되지 않았습니다.`,
    };
  }
  return {
    ...known,
    status: "mapped",
    compartmentId: compartments[0].id,
    message: `${garment.name} · ${fixtureLocation ? `시연 배치 ${locationRef} · 실제 위치 미확인` : garment.location}`,
  };
}

/** Inspection and guidance are independent inputs: neither mutates the outfit, garments, or event history. */
export function selectMirrorScene(
  input: LocationContext & {
    inspectedGarmentId: string | null;
    outfit: SceneOutfit | null;
    locationGuide: LocationGuide;
  },
) {
  const inspected = resolveGarmentLocation({
    ...input,
    garmentId: input.inspectedGarmentId,
  });
  const outfitItems: SceneOutfitItem[] = [];
  const outfitIssues: string[] = [];
  if (input.outfit?.ownerId === input.ownerId) {
    for (const slot of OUTFIT_SLOTS) {
      const garmentId = input.outfit.items[slot];
      if (!garmentId) continue;
      const candidates = input.garments.filter(
        (item) => item.id === garmentId && item.ownerId === input.ownerId,
      );
      if (candidates.length !== 1 || candidates[0].category !== slot) {
        outfitIssues.push(`${slot} 슬롯의 의류 참조를 확인할 수 없습니다.`);
        continue;
      }
      outfitItems.push({
        slot,
        garmentId,
        garment: candidates[0],
        location: resolveGarmentLocation({ ...input, garmentId }),
      });
    }
  } else if (input.outfit)
    outfitIssues.push("다른 소유자의 코디는 표시하지 않습니다.");
  const locationGuides =
    input.locationGuide.kind === "none"
      ? []
      : input.locationGuide.kind === "garment"
        ? [
            resolveGarmentLocation({
              ...input,
              garmentId: input.locationGuide.garmentId,
            }),
          ]
        : outfitItems.map((item) => item.location);
  const guidedCompartmentIds = [
    ...new Set(
      locationGuides.flatMap((guide) =>
        guide.compartmentId ? [guide.compartmentId] : [],
      ),
    ),
  ];
  const compartments: SceneCompartment[] = input.compartments.map(
    (definition) => {
      const garments = input.garments.filter(
        (garment) =>
          garment.ownerId === input.ownerId &&
          resolveGarmentLocation({ ...input, garmentId: garment.id })
            .compartmentId === definition.id,
      );
      const guidedGarmentIds = [
        ...new Set(
          locationGuides
            .filter((guide) => guide.compartmentId === definition.id)
            .flatMap((guide) => (guide.garmentId ? [guide.garmentId] : [])),
        ),
      ];
      return {
        ...definition,
        garments,
        inspectedGarmentId:
          inspected.compartmentId === definition.id
            ? inspected.garmentId
            : null,
        outfitGarmentIds: outfitItems
          .filter((item) => item.location.compartmentId === definition.id)
          .map((item) => item.garmentId),
        guidedGarmentIds,
        ledOn: guidedGarmentIds.length > 0,
        ledLabel: MIRROR_LED_LABEL,
      };
    },
  );
  return {
    inspected,
    outfitItems,
    outfitIssues,
    locationGuides,
    guidedCompartmentIds,
    compartments,
    ledLabel: MIRROR_LED_LABEL,
  };
}

/** A verified reference to the selected photograph. A missing attachment remains url:null. */
export interface MirrorPerson {
  id: string;
  referenceAssetId?: string;
  version: number;
  url: string | null;
  ownerId?: string;
}
export interface FittingSnapshot {
  ownerId: string;
  person: { assetId: string; assetVersion: number };
  outfit: {
    draftId: string | null;
    outfitId: string | null;
    revision: number;
    items: {
      slot: Slot;
      garmentId: string;
      assetId: string;
      assetVersion: number;
    }[];
    externalItems?: {
      slot: Slot;
      externalItemId: string;
      assetId: string;
      assetVersion: number;
    }[];
  };
  /** Increase on every request, selection change, stop, and session invalidation; never reuse a stopped request. */
  requestVersion: number;
}
export type FittingIssueCode =
  | "missing-person-photo"
  | "invalid-person"
  | "other-owner-person"
  | "missing-outfit"
  | "other-owner-outfit"
  | "invalid-outfit"
  | "incomplete-outfit"
  | "invalid-request-version"
  | "missing-garment"
  | "invalid-slot"
  | "missing-garment-asset"
  | "stale-outfit-asset";
export interface FittingIssue {
  code: FittingIssueCode;
  message: string;
  slot?: Slot;
  garmentId?: string;
}

export function buildFittingSnapshot(input: {
  ownerId: string;
  person: MirrorPerson | null;
  outfit: SceneOutfit | null;
  garments: readonly Garment[];
  requestVersion: number;
}): { snapshot: FittingSnapshot | null; issues: FittingIssue[] } {
  const issues: FittingIssue[] = [];
  const { person, outfit } = input;
  if (!person || !isNonempty(person.url))
    issues.push({
      code: "missing-person-photo",
      message: "선택한 인물의 원본 사진이 연결되지 않았습니다.",
    });
  if (person && (!isNonempty(person.id) || !isPositiveInteger(person.version)))
    issues.push({
      code: "invalid-person",
      message: "인물 자산 참조 또는 버전을 확인할 수 없습니다.",
    });
  if (person?.ownerId && person.ownerId !== input.ownerId)
    issues.push({
      code: "other-owner-person",
      message: "다른 소유자의 인물 자산은 적용하지 않습니다.",
    });
  if (!isPositiveInteger(input.requestVersion))
    issues.push({
      code: "invalid-request-version",
      message: "피팅 요청 버전을 확인할 수 없습니다.",
    });
  if (!outfit)
    issues.push({ code: "missing-outfit", message: "선택한 코디가 없습니다." });
  if (outfit && outfit.ownerId !== input.ownerId)
    issues.push({
      code: "other-owner-outfit",
      message: "다른 소유자의 코디는 적용하지 않습니다.",
    });
  const items: FittingSnapshot["outfit"]["items"] = [];
  const externalItems: NonNullable<FittingSnapshot["outfit"]["externalItems"]> =
    [];
  if (outfit) {
    for (const [slot, item] of Object.entries(outfit.externalItems ?? {})) {
      if (
        !OUTFIT_SLOTS.includes(slot as Slot) ||
        outfit.items[slot as Slot] ||
        !item.externalItemId ||
        !item.assetId ||
        !isPositiveInteger(item.assetVersion ?? 0)
      ) {
        issues.push({
          code: "missing-garment-asset",
          message: "구매 후보의 피팅 자산 참조와 버전을 확인해 주세요.",
        });
        continue;
      }
      externalItems.push({
        slot: slot as Slot,
        externalItemId: item.externalItemId,
        assetId: item.assetId,
        assetVersion: item.assetVersion!,
      });
    }
    const identity = "draftId" in outfit ? outfit.draftId : outfit.id;
    if (!isNonempty(identity) || !isPositiveInteger(outfit.revision))
      issues.push({
        code: "invalid-outfit",
        message: "코디 참조 또는 버전을 확인할 수 없습니다.",
      });
    if (!completeOutfit(outfit))
      issues.push({
        code: "incomplete-outfit",
        message: "상의와 하의를 포함한 현재 전체 코디가 필요합니다.",
      });
    if (
      Object.keys(outfit.items).some(
        (slot) => !OUTFIT_SLOTS.includes(slot as Slot),
      )
    )
      issues.push({
        code: "invalid-slot",
        message: "확인되지 않은 코디 슬롯이 있습니다.",
      });
    for (const slot of OUTFIT_SLOTS) {
      const garmentId = outfit.items[slot];
      if (!garmentId) continue;
      const candidates = input.garments.filter(
        (garment) =>
          garment.id === garmentId && garment.ownerId === input.ownerId,
      );
      if (candidates.length !== 1) {
        issues.push({
          code: "missing-garment",
          slot,
          garmentId,
          message: "현재 소유자의 의류 참조를 확인할 수 없습니다.",
        });
        continue;
      }
      const garment = candidates[0];
      if (garment.category !== slot)
        issues.push({
          code: "invalid-slot",
          slot,
          garmentId,
          message: "의류 종류와 코디 슬롯이 일치하지 않습니다.",
        });
      // Private storage assets intentionally have no public URL; their server-owned ID/version is the reference.
      // Packaged/uploaded images must actually be connected, not just carry a placeholder identity.
      if (
        !garment.asset ||
        !isNonempty(garment.asset.id) ||
        !isPositiveInteger(garment.asset.version) ||
        garment.asset.needsReselection ||
        (garment.asset.source !== "storage" && !isNonempty(garment.asset.url))
      ) {
        issues.push({
          code: "missing-garment-asset",
          slot,
          garmentId,
          message: "선택 의류의 자산 참조를 확인하거나 다시 선택해야 합니다.",
        });
        continue;
      }
      if (
        "assetVersions" in outfit &&
        outfit.assetVersions[garmentId] !== garment.asset.version
      ) {
        issues.push({
          code: "stale-outfit-asset",
          slot,
          garmentId,
          message: "저장 코디의 의류 자산 버전이 현재 자산과 다릅니다.",
        });
      }
      items.push({
        slot,
        garmentId,
        assetId: garment.asset.id,
        assetVersion: garment.asset.version,
      });
    }
  }
  if (issues.length || !person || !outfit) return { snapshot: null, issues };
  return {
    snapshot: {
      ownerId: input.ownerId,
      person: {
        assetId: person.referenceAssetId ?? person.id,
        assetVersion: person.version,
      },
      outfit: {
        draftId: "draftId" in outfit ? outfit.draftId : null,
        outfitId: "id" in outfit ? outfit.id : null,
        revision: outfit.revision,
        items,
        ...(externalItems.length ? { externalItems } : {}),
      },
      requestVersion: input.requestVersion,
    },
    issues,
  };
}

/** Comparison includes every slot and stable asset identity, independently of object/array insertion order. */
export function fittingSnapshotsMatch(
  a: FittingSnapshot | null,
  b: FittingSnapshot | null,
): boolean {
  if (
    !a ||
    !b ||
    a.ownerId !== b.ownerId ||
    a.requestVersion !== b.requestVersion ||
    a.person.assetId !== b.person.assetId ||
    a.person.assetVersion !== b.person.assetVersion ||
    a.outfit.draftId !== b.outfit.draftId ||
    a.outfit.outfitId !== b.outfit.outfitId ||
    a.outfit.revision !== b.outfit.revision ||
    a.outfit.items.length !== b.outfit.items.length
  )
    return false;
  const slots = new Set(a.outfit.items.map((item) => item.slot));
  if (
    slots.size !== a.outfit.items.length ||
    new Set(b.outfit.items.map((item) => item.slot)).size !==
      b.outfit.items.length
  )
    return false;
  const externalA = a.outfit.externalItems ?? [],
    externalB = b.outfit.externalItems ?? [];
  if (
    externalA.length !== externalB.length ||
    new Set(externalA.map((item) => item.slot)).size !== externalA.length ||
    new Set(externalB.map((item) => item.slot)).size !== externalB.length ||
    externalA.some(
      (item) =>
        !externalB.some(
          (other) =>
            item.slot === other.slot &&
            item.externalItemId === other.externalItemId &&
            item.assetId === other.assetId &&
            item.assetVersion === other.assetVersion,
        ),
    )
  )
    return false;
  return a.outfit.items.every((item) =>
    b.outfit.items.some(
      (other) =>
        item.slot === other.slot &&
        item.garmentId === other.garmentId &&
        item.assetId === other.assetId &&
        item.assetVersion === other.assetVersion,
    ),
  );
}

export function fittingDraftMatches(
  snapshot: FittingSnapshot,
  draft: OutfitDraft,
): boolean {
  const owned = Object.entries(draft.items),
    external = Object.entries(draft.externalItems ?? {}),
    requested = snapshot.outfit.externalItems ?? [];
  return (
    draft.ownerId === snapshot.ownerId &&
    draft.draftId === snapshot.outfit.draftId &&
    draft.revision === snapshot.outfit.revision &&
    owned.length === snapshot.outfit.items.length &&
    new Set(snapshot.outfit.items.map((row) => row.slot)).size ===
      owned.length &&
    owned.every(([slot, id]) =>
      snapshot.outfit.items.some(
        (row) => row.slot === slot && row.garmentId === id,
      ),
    ) &&
    external.length === requested.length &&
    new Set(requested.map((row) => row.slot)).size === external.length &&
    external.every(
      ([slot, item]) =>
        !draft.items[slot as Slot] &&
        requested.some(
          (row) =>
            row.slot === slot &&
            row.externalItemId === item.externalItemId &&
            row.assetId === item.assetId &&
            row.assetVersion === item.assetVersion,
        ),
    )
  );
}
export type FittingMedia =
  | { kind: "image" | "video"; url: string }
  | { kind: "stream"; streamId: string };
export interface FittingRequest {
  snapshot: FittingSnapshot;
  status: "processing" | "completed" | "failed" | "unavailable" | "canceled";
}
/** Construct only after the adapter has verified result ownership and its submitted snapshot. Never attach the current snapshot to an unrelated old result. */
export interface FittingCandidate {
  snapshot: FittingSnapshot;
  origin: "saved" | "prepared-static" | "provider-batch" | "provider-realtime";
  content: "fitting-result" | "outfit-card";
  status: "ready" | "processing" | "failed" | "unavailable";
  media: FittingMedia | null;
  operationId?: string;
  resultId?: string;
}
export interface FittingPresentation {
  display: "original-person" | "fitting-result";
  reason:
    | "ready"
    | "missing-input"
    | "no-result"
    | "pending"
    | "stale"
    | "unavailable"
    | "invalid-result";
  media: FittingMedia | null;
  label: string;
  message: string;
}
export function selectFittingPresentation(input: {
  current: FittingSnapshot | null;
  request: FittingRequest | null;
  result: FittingCandidate | null;
}): FittingPresentation {
  const original = (
    reason: FittingPresentation["reason"],
    detail: string,
  ): FittingPresentation => ({
    display: "original-person",
    reason,
    media: null,
    label: "사진 기반 표시",
    message: `선택 코디 미적용 / ${detail}`,
  });
  if (!input.current)
    return original(
      "missing-input",
      "인물 사진과 전체 코디 입력을 확인하세요.",
    );
  if (
    input.request &&
    !fittingSnapshotsMatch(input.current, input.request.snapshot)
  )
    return original("stale", "이전 요청 결과는 현재 코디에 적용하지 않습니다.");
  if (
    input.request &&
    ["canceled", "failed", "unavailable"].includes(input.request.status)
  )
    return original("unavailable", "요청이 중단되었거나 피팅 결과가 없습니다.");
  const result = input.result;
  if (!result)
    return input.request?.status === "processing"
      ? original("pending", "피팅 생성 대기")
      : original("no-result", "피팅 결과 없음");
  if (!fittingSnapshotsMatch(input.current, result.snapshot))
    return original("stale", "이전 인물·코디 또는 요청의 결과입니다.");
  if (result.status === "processing")
    return original("pending", "피팅 생성 대기");
  if (result.status !== "ready")
    return original("unavailable", "피팅 결과 없음");
  if (
    ![
      "saved",
      "prepared-static",
      "provider-batch",
      "provider-realtime",
    ].includes(result.origin)
  )
    return original("invalid-result", "확인된 피팅 결과 유형이 아닙니다.");
  if (result.content !== "fitting-result" || !result.media)
    return original("invalid-result", "확인된 피팅 미디어가 없습니다.");
  if (!["image", "video", "stream"].includes(result.media.kind))
    return original("invalid-result", "확인된 피팅 미디어 유형이 아닙니다.");
  if (
    ["saved", "prepared-static"].includes(result.origin) &&
    !isNonempty(result.resultId)
  )
    return original("invalid-result", "저장 결과 참조가 확인되지 않았습니다.");
  if (
    !["saved", "prepared-static"].includes(result.origin) &&
    !isNonempty(result.operationId)
  )
    return original(
      "invalid-result",
      "공급자 요청 참조가 확인되지 않았습니다.",
    );
  if (result.origin === "provider-realtime") {
    if (
      !input.request ||
      input.request.status !== "processing" ||
      result.media.kind !== "stream" ||
      !isNonempty(result.media.streamId)
    ) {
      return original(
        "invalid-result",
        "현재 요청에 연결된 실시간 세션이 없습니다.",
      );
    }
  } else if (result.media.kind === "stream" || !isNonempty(result.media.url))
    return original("invalid-result", "확인된 피팅 파일이 없습니다.");
  const label =
    result.origin === "prepared-static"
      ? "준비된 정적 착장 예시 · 실시간 피팅 아님"
      : result.origin === "saved"
        ? "저장된 피팅 결과"
        : result.origin === "provider-realtime"
          ? "실시간 피팅 세션"
          : "실제 생성 피팅 결과 · 배치";
  return {
    display: "fitting-result",
    reason: "ready",
    media: result.media,
    label,
    message: label,
  };
}

/** One accepted realtime stream, bound to the submitted owner/person/full-outfit snapshot. */
export interface FittingStreamBinding {
  stream: MediaStream;
  snapshot: FittingSnapshot;
  operationId: string;
}
/** Pure validation; stale stream disposal remains the originating session's responsibility. */
export function selectCurrentFittingStream(
  binding: FittingStreamBinding | null,
  current: FittingSnapshot | null,
  operationId?: string,
): MediaStream | null {
  if (
    !binding ||
    !current ||
    !isNonempty(binding.operationId) ||
    (operationId !== undefined && operationId !== binding.operationId) ||
    !fittingSnapshotsMatch(binding.snapshot, current)
  )
    return null;
  try {
    const stream = binding.stream;
    if (
      stream.active !== true ||
      !stream.getVideoTracks().some((track) => track.readyState === "live")
    )
      return null;
    return stream;
  } catch {
    return null;
  }
}
