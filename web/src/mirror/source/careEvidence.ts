import type { Asset, Garment } from "./core/types";
export type CareEvidenceKind =
  "label" | "official_guidance" | "user_observation";
export interface CareEvidenceItem {
  id: string;
  ownerId: string;
  garmentId: string;
  kind: CareEvidenceKind;
  originalText: string;
  sourceRef: string | null;
  observedAt: string | null;
  asset: {
    id: string;
    version: number;
    url: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  } | null;
}
export interface CareEvidenceResponse {
  ownerId: string;
  garmentId: string;
  evidence: CareEvidenceItem[];
}
export interface ScopedLabelUpload {
  ownerId: string;
  garmentId: string;
  contextGeneration: number;
  asset: Asset;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const kinds: readonly string[] = [
  "label",
  "official_guidance",
  "user_observation",
];
export function labelEvidenceAssetId(
  kind: CareEvidenceKind,
  ownerId: string,
  garmentId: string,
  contextGeneration: number,
  upload: ScopedLabelUpload | null,
): string | undefined {
  return kind === "label" &&
    upload?.ownerId === ownerId &&
    upload.garmentId === garmentId &&
    upload.contextGeneration === contextGeneration &&
    upload.asset.source === "storage" &&
    uuid.test(upload.asset.id)
    ? upload.asset.id
    : undefined;
}
/** Evidence is read only, owner scoped, and never followed through an arbitrary source URL. */
export function parseCareEvidence(
  value: unknown,
  ownerId: string,
  garmentId: string,
): CareEvidenceResponse {
  const result = value as CareEvidenceResponse;
  if (
    !result ||
    result.ownerId !== ownerId ||
    result.garmentId !== garmentId ||
    !Array.isArray(result.evidence) ||
    result.evidence.length > 30
  )
    throw new Error("현재 의류의 관리 근거를 확인하지 못했어요.");
  const ids = new Set<string>();
  for (const item of result.evidence) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !uuid.test(item.id) ||
      ids.has(item.id) ||
      item.ownerId !== ownerId ||
      item.garmentId !== garmentId ||
      !kinds.includes(item.kind) ||
      typeof item.originalText !== "string" ||
      item.originalText.length > 20000 ||
      typeof item.observedAt !== "string" ||
      !Number.isFinite(Date.parse(item.observedAt)) ||
      (item.sourceRef !== null &&
        (typeof item.sourceRef !== "string" || item.sourceRef.length > 1000))
    )
      throw new Error("현재 의류의 관리 근거를 확인하지 못했어요.");
    ids.add(item.id);
    const asset = item.asset;
    if (
      asset !== null &&
      (!asset ||
        item.kind !== "label" ||
        typeof asset.id !== "string" ||
        !uuid.test(asset.id) ||
        !Number.isSafeInteger(asset.version) ||
        asset.version < 1 ||
        !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) ||
        asset.url !== "/api/assets/" + asset.id + "/content")
    )
      throw new Error("관리 라벨 사진의 연결을 확인하지 못했어요.");
  }
  return structuredClone(result);
}
export function careNotesEvidence(garment: Garment): CareEvidenceItem | null {
  return garment.provenance.care === "user" && garment.careNotes.trim()
    ? {
        id: "local-care-notes",
        ownerId: garment.ownerId,
        garmentId: garment.id,
        kind: "user_observation",
        originalText: garment.careNotes,
        sourceRef: "직접 입력한 관리 메모",
        observedAt: null,
        asset: null,
      }
    : null;
}
