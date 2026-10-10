import sources from "./data/handoff-reference/product_sources.json";
import bindings from "./data/handoff-reference/evidence_bindings.json";
import type { CareEvidenceItem } from "./careEvidence";

export const CARE_GROUNDING_REVISION = "care-excerpt-allowlist-v1";
export interface CareDisplayRow {
  key: string;
  text: string;
  evidenceId: string;
  sourcePhrase: string;
}
export interface CareEvidencePresentation {
  title: string;
  sourceKind:
    | "demo_product_reference"
    | "official_product_reference"
    | "label_record"
    | "user_observation";
  verificationState:
    | "reviewed_excerpt"
    | "original_recheck_required"
    | "recorded_source"
    | "unreviewed_source";
  verificationLabel: string;
  scope: string;
  summary: string;
  rows: CareDisplayRow[];
  excerptRows: CareDisplayRow[];
  originalExcerpt: string;
  sourceDomain: string | null;
  sourceUrl: string | null;
  canGroundCare: boolean;
  physicalLabelPhoto: boolean;
}
type ReviewedPhrase = { key: string; phrase: string; text: string };
// This is a reviewed translation table for the supplied excerpts, not a parser for unknown prose.
// Structured care values, source notes and product issues never supply a row.
const reviewed: Record<string, ReviewedPhrase[]> = {
  "SRC-P01": [
    { key: "wash", phrase: "Machine wash at 40°", text: "40°C에서 기계 세탁" },
    {
      key: "tumble_dry",
      phrase: "Tumble dry low",
      text: "낮은 온도로 기계 건조",
    },
    { key: "iron", phrase: "Medium iron", text: "중간 온도로 다림질" },
    { key: "professional_clean", phrase: "Dry clean", text: "드라이클리닝" },
  ],
  "SRC-P02": [
    {
      key: "wash",
      phrase: "Machine wash cool",
      text: "낮은 온도로 기계 세탁 · 온도 수치 미표기",
    },
    { key: "dry", phrase: "Line dry", text: "걸어서 건조" },
    { key: "iron", phrase: "Medium iron", text: "중간 온도로 다림질" },
  ],
  "SRC-P03": [
    { key: "wash", phrase: "Machine wash at 40°", text: "40°C에서 기계 세탁" },
    {
      key: "tumble_dry",
      phrase: "Tumble dry medium",
      text: "중간 온도로 기계 건조",
    },
  ],
  "SRC-P04": [
    {
      key: "professional_clean",
      phrase: "Do not dry clean",
      text: "드라이클리닝 금지",
    },
    {
      key: "wash",
      phrase: "Wash at or below 40°C",
      text: "40°C 이하에서 세탁",
    },
    { key: "dry", phrase: "Line dry", text: "걸어서 건조" },
  ],
  "SRC-P05": [
    {
      key: "professional_clean",
      phrase: "Do not dry clean",
      text: "드라이클리닝 금지",
    },
    {
      key: "wash",
      phrase: "Wash at or below 40°C",
      text: "40°C 이하에서 세탁",
    },
    { key: "dry", phrase: "Line dry", text: "걸어서 건조" },
  ],
  "SRC-P06": [{ key: "wash", phrase: "Hand wash", text: "손세탁" }],
  "SRC-P07": [],
  "SRC-P08": [
    { key: "professional_clean", phrase: "Dry clean", text: "드라이클리닝" },
  ],
  "SRC-P09": [
    {
      key: "wash",
      phrase: "Hand wash cold (40°c max)",
      text: "찬물로 손세탁 · 최고 40°C",
    },
    {
      key: "dry",
      phrase: "flat drying in the shade",
      text: "그늘에 뉘어서 건조",
    },
  ],
  "SRC-P10": [],
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function sourceLink(value: string | null) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password)
      return { sourceDomain: null, sourceUrl: null };
    return { sourceDomain: url.hostname, sourceUrl: url.href };
  } catch {
    return { sourceDomain: null, sourceUrl: null };
  }
}
/** Read projection only: original evidence and its internal review record remain unchanged. */
export function careEvidencePresentation(
  item: CareEvidenceItem,
): CareEvidencePresentation {
  let payload: unknown;
  let structured = false;
  try {
    payload = JSON.parse(item.originalText);
    structured = true;
  } catch {
    /* Plain recorded source text has no importer fields. */
  }
  const link = sourceLink(item.sourceRef),
    official = item.kind === "official_guidance",
    label = item.kind === "label";
  const view: CareEvidencePresentation = {
    title: official
      ? "관리 정보 확인 필요"
      : label
        ? "저장된 라벨 근거"
        : "직접 관찰한 내용",
    sourceKind: official
      ? "official_product_reference"
      : label
        ? "label_record"
        : "user_observation",
    verificationState: official ? "unreviewed_source" : "recorded_source",
    verificationLabel: official
      ? "원문과 적용 범위 확인 필요"
      : label
        ? item.asset
          ? "저장된 라벨 사진"
          : "라벨 텍스트 기록 · 사진 없음"
        : "사용자 기록",
    scope: official
      ? "현재 의류에 적용되는지 확인이 필요해요."
      : label
        ? "선택한 의류에 연결된 라벨 기록이에요."
        : "직접 기록한 관찰 내용이에요.",
    summary: official
      ? "관리 정보 원문 확인이 필요해요."
      : structured
        ? "기록 원문 확인이 필요해요."
        : item.originalText,
    rows: [],
    excerptRows: [],
    originalExcerpt: structured ? "" : item.originalText,
    ...link,
    canGroundCare: !official && !structured && !!item.originalText.trim(),
    physicalLabelPhoto: label && !!item.asset,
  };
  if (!official || !object(payload)) return view;
  const meta = payload._life_data;
  if (
    !object(meta) ||
    meta.provenance !== "source_derived_evidence_binding" ||
    meta.namespace !== "scprep-20261009-v1"
  )
    return view;
  const binding = bindings.find(
    (row) =>
      row.ref === meta.source_ref &&
      row.product_ref === meta.product_ref &&
      row.source_ref === meta.official_source_ref,
  );
  const source = sources.find(
    (row) =>
      row.ref === meta.official_source_ref &&
      row.product_ref === meta.product_ref,
  );
  if (
    !binding ||
    !source ||
    item.sourceRef !== source.url ||
    payload.short_excerpt !== source.short_excerpt ||
    payload.retrieval_level !== source.retrieval_level ||
    payload.demo_product_binding_verified !== true
  )
    return view;
  // Local canonical IDs must match the reviewed binding; a similar image/name never supplies product identity.
  const prefix = "local:scprep-20261009-v1:";
  if (
    item.ownerId.startsWith("local:") ||
    item.garmentId.startsWith("local:") ||
    item.id.startsWith("local:")
  ) {
    if (
      item.ownerId !== prefix + "profile:" + binding.owner_ref ||
      item.garmentId !== prefix + "garment:" + binding.garment_ref ||
      item.id !== prefix + "evidence:" + binding.ref
    )
      return view;
  }
  const excerptRows = (reviewed[source.ref] ?? [])
    .filter((row) =>
      source.short_excerpt
        .split(";")
        .map((phrase) => phrase.trim())
        .includes(row.phrase),
    )
    .map((row) => ({
      key: row.key,
      text: row.text,
      evidenceId: item.id,
      sourcePhrase: row.phrase,
    }));
  const search = source.retrieval_level === "official_search_snapshot",
    rows = search ? [] : excerptRows;
  return {
    ...view,
    title: search ? "관리 정보 확인 필요" : "시연 상품 관리 안내",
    sourceKind: "demo_product_reference",
    verificationState: search
      ? "original_recheck_required"
      : "reviewed_excerpt",
    verificationLabel: search
      ? "검색 발췌 · 원문 재확인 전"
      : "저장된 공식 발췌",
    scope: "시연에 설정한 상품 참고 · 실물 적용 미확인",
    summary: search
      ? "관리 정보 원문 확인이 필요해요."
      : rows.length
        ? rows.map((row) => row.text).join(" · ")
        : "확인된 관리 조건이 없어요. 관리 원문을 확인해 주세요.",
    rows,
    excerptRows,
    originalExcerpt: source.short_excerpt,
    ...sourceLink(source.url),
    canGroundCare: !search && rows.length > 0,
    physicalLabelPhoto: false,
  };
}
export function careEvidenceOriginalText(item: CareEvidenceItem): string {
  const view = careEvidencePresentation(item);
  return [
    view.verificationState === "original_recheck_required"
      ? "검색에서 확보한 상품 안내 발췌 · 원문 재확인 전"
      : view.verificationLabel,
    view.scope,
    view.originalExcerpt,
    ...(view.excerptRows.length
      ? ["발췌 번역", ...view.excerptRows.map((row) => row.text)]
      : []),
    ...(!view.originalExcerpt ? ["고객에게 표시할 검토된 발췌가 없어요."] : []),
  ]
    .filter(Boolean)
    .join("\n");
}
/** Provider DTO is built from the same allowlist. No raw importer JSON or research fields cross this boundary. */
export function careEvidenceGrounding(item: CareEvidenceItem) {
  const view = careEvidencePresentation(item);
  if (!view.canGroundCare) return null;
  const original = view.rows.length
    ? view.rows.map((row) => row.sourcePhrase).join("; ")
    : view.originalExcerpt;
  return {
    id: item.id,
    kind: item.kind,
    original_text: original.slice(0, 2000),
    source_ref: view.sourceDomain,
    observed_at: item.observedAt,
    physical_label_photo: view.physicalLabelPhoto,
    original_text_truncated: original.length > 2000,
    source_label: view.title,
    source_kind: view.sourceKind,
    verification_state: view.verificationState,
    applicability: view.scope,
    care_rows: view.rows.map((row) => ({
      key: row.key,
      text: row.text,
      evidence_id: row.evidenceId,
      source_phrase: row.sourcePhrase,
    })),
    grounding_revision: CARE_GROUNDING_REVISION,
  };
}
