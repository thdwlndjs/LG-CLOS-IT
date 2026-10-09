import type { CompartmentDefinition, LocationBinding } from "./mirrorScene";

export type CompartmentType =
  | "long-hanger"
  | "upper-hanger"
  | "lower-hanger"
  | "shelf"
  | "drawer"
  | "drawer-stack";
export interface NormalizedGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutCompartment extends CompartmentDefinition {
  displayLabel: string;
  column: number;
  row: number;
  type: CompartmentType;
  geometry: NormalizedGeometry;
  ledAnchor: { x: number; y: number };
  displayOnly: true;
  physicalStatus: "unconfirmed";
}
export interface LayoutColumn {
  id: string;
  column: number;
  side: "left" | "center" | "right";
  label: string;
  kind: "long-hanging" | "double-hanging" | "mirror" | "folded";
  geometry: NormalizedGeometry;
  compartmentIds: readonly string[];
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function cell(
  id: string,
  label: string,
  displayLabel: string,
  column: number,
  row: number,
  type: CompartmentType,
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutCompartment {
  return {
    id,
    label,
    displayLabel,
    side: column < 3 ? "left" : "right",
    column,
    row,
    type,
    geometry: { x, y, width, height },
    ledAnchor: { x: x + width / 2, y: y + 0.008 },
    displayOnly: true,
    physicalStatus: "unconfirmed",
  };
}

/**
 * Display geometry traced from the supplied 2026-10-09 reference pixels.
 * This is not a measured cabinet, an approved shelf count, or a database location migration.
 * Keep stable labels where possible so existing Garment.location strings retain their meaning.
 */
export const MIRROR_COMPARTMENTS: readonly LayoutCompartment[] = freeze([
  cell(
    "left-hanger-b",
    "행거 B",
    "긴 옷 봉 · B",
    1,
    1,
    "long-hanger",
    0.054,
    0.112,
    0.171,
    0.601,
  ),
  cell(
    "left-drawer-e",
    "서랍 E",
    "긴 옷 아래 서랍 · E",
    1,
    2,
    "drawer",
    0.054,
    0.727,
    0.171,
    0.054,
  ),
  cell(
    "left-shelf-s",
    "선반 S",
    "긴 옷 아래 선반 · S",
    1,
    3,
    "shelf",
    0.054,
    0.795,
    0.171,
    0.108,
  ),
  cell(
    "left-hanger-a",
    "행거 A",
    "상의 봉 · A",
    2,
    1,
    "upper-hanger",
    0.241,
    0.112,
    0.172,
    0.352,
  ),
  cell(
    "left-hanger-d",
    "행거 D",
    "하의 봉 · D",
    2,
    2,
    "lower-hanger",
    0.241,
    0.492,
    0.172,
    0.287,
  ),
  cell(
    "left-drawer-g",
    "서랍 G",
    "하단 서랍 · G",
    2,
    3,
    "drawer",
    0.241,
    0.796,
    0.172,
    0.106,
  ),
  cell(
    "right-shelf-c",
    "선반 C",
    "접은 니트 · C",
    4,
    1,
    "shelf",
    0.591,
    0.063,
    0.171,
    0.099,
  ),
  cell(
    "right-shelf-f",
    "선반 F",
    "접은 상의 · F",
    4,
    2,
    "shelf",
    0.591,
    0.184,
    0.171,
    0.101,
  ),
  cell(
    "right-shelf-h",
    "선반 H",
    "접은 상의 · H",
    4,
    3,
    "shelf",
    0.591,
    0.309,
    0.171,
    0.103,
  ),
  cell(
    "right-shelf-j",
    "선반 J",
    "접은 니트 · J",
    4,
    4,
    "shelf",
    0.591,
    0.437,
    0.171,
    0.101,
  ),
  cell(
    "right-drawer-k",
    "서랍 K",
    "하단 서랍 묶음 · K",
    4,
    5,
    "drawer-stack",
    0.591,
    0.554,
    0.171,
    0.349,
  ),
  cell(
    "right-shelf-l",
    "선반 L",
    "접은 데님 · L",
    5,
    1,
    "shelf",
    0.778,
    0.064,
    0.172,
    0.099,
  ),
  cell(
    "right-shelf-m",
    "선반 M",
    "접은 하의 · M",
    5,
    2,
    "shelf",
    0.778,
    0.186,
    0.172,
    0.101,
  ),
  cell(
    "right-shelf-n",
    "선반 N",
    "접은 하의 · N",
    5,
    3,
    "shelf",
    0.778,
    0.312,
    0.172,
    0.103,
  ),
  cell(
    "right-shelf-o",
    "선반 O",
    "접은 상의 · O",
    5,
    4,
    "shelf",
    0.778,
    0.441,
    0.172,
    0.103,
  ),
  cell(
    "right-shelf-p",
    "선반 P",
    "접은 상의 · P",
    5,
    5,
    "shelf",
    0.778,
    0.565,
    0.172,
    0.099,
  ),
  cell(
    "right-shelf-q",
    "선반 Q",
    "접은 하의 · Q",
    5,
    6,
    "shelf",
    0.778,
    0.69,
    0.172,
    0.092,
  ),
  cell(
    "right-shelf-r",
    "선반 R",
    "접은 하의 · R",
    5,
    7,
    "shelf",
    0.778,
    0.807,
    0.172,
    0.096,
  ),
]);

export const LEGACY_LOCATION_BINDINGS = freeze([
  {
    locationRef: "행거 B · 오른쪽 1번째",
    compartmentId: "left-hanger-b",
    reason: "기존 행거 B 내 순서 표기를 유지하는 표시 연결",
  },
  {
    locationRef: "행거 B · 오른쪽 2번째",
    compartmentId: "left-hanger-b",
    reason: "기존 행거 B 내 순서 표기를 유지하는 표시 연결",
  },
  {
    locationRef: "행거 I",
    compartmentId: "left-hanger-b",
    reason:
      "이전 화면의 추가 외투 봉을 새 긴 옷 열에 표시하는 별칭; 실물 위치 변경 아님",
  },
]);
export const MIRROR_BINDINGS: readonly LocationBinding[] = freeze([
  ...MIRROR_COMPARTMENTS.map((c) => ({
    locationRef: c.label,
    compartmentId: c.id,
  })),
  ...LEGACY_LOCATION_BINDINGS.map(({ locationRef, compartmentId }) => ({
    locationRef,
    compartmentId,
  })),
]);
export function getLayoutCompartment(
  id: string,
): LayoutCompartment | undefined {
  return MIRROR_COMPARTMENTS.find((compartment) => compartment.id === id);
}
const columns: readonly LayoutColumn[] = freeze(
  [
    {
      id: "left-long",
      column: 1,
      side: "left",
      label: "긴 옷",
      kind: "long-hanging",
      geometry: { x: 0.047, y: 0.027, width: 0.18, height: 0.889 },
    },
    {
      id: "left-double",
      column: 2,
      side: "left",
      label: "상의 · 하의",
      kind: "double-hanging",
      geometry: { x: 0.237, y: 0.027, width: 0.177, height: 0.889 },
    },
    {
      id: "center-mirror",
      column: 3,
      side: "center",
      label: "중앙 세로 미러",
      kind: "mirror",
      geometry: { x: 0.422, y: 0.027, width: 0.158, height: 0.889 },
    },
    {
      id: "right-folded-inner",
      column: 4,
      side: "right",
      label: "접은 상의",
      kind: "folded",
      geometry: { x: 0.587, y: 0.027, width: 0.177, height: 0.889 },
    },
    {
      id: "right-folded-outer",
      column: 5,
      side: "right",
      label: "접은 상의 · 하의",
      kind: "folded",
      geometry: { x: 0.775, y: 0.027, width: 0.178, height: 0.889 },
    },
  ].map((column) => ({
    ...column,
    compartmentIds: MIRROR_COMPARTMENTS.filter(
      (c) => c.column === column.column,
    ).map((c) => c.id),
  })) as LayoutColumn[],
);
export const LAYOUT_CONFIG = freeze({
  id: "open-five-column-reference-20261009",
  version: 1,
  displayOnly: true as const,
  physicalStatus: "unconfirmed" as const,
  reference: {
    filename: "ChatGPT 이미지 2026년 10월 9일 오전 01_17_43.png",
    width: 1672,
    height: 941,
    selectedFinalDesign: false,
    geometryUnits: "normalized-reference-image" as const,
  },
  assumptions: {
    status: "unconfirmed" as const,
    label: "참고안 기반 시연 배치 · 실측 치수·선반 수·접은 상태 미확정",
    dimensions: "이미지 비율만 사용하며 실제 치수는 확인 대기입니다.",
    shelfCount: "오른쪽 4+7 선반은 참고안 픽셀에 맞춘 임시 표시 구획입니다.",
    foldedState:
      "선반 의류는 원본 자산을 활용한 접은 상태의 화면 표현이며 실제 보관 상태가 아닙니다.",
    drawers:
      "오른쪽 하단 서랍은 한 표시 구획으로 묶으며 내부 서랍 수를 확정하지 않습니다.",
    shoeStorage:
      "참고 구조에 신발 전용 칸이 확인되지 않아 신발 위치와 LED는 미확인으로 둡니다.",
  },
  columns,
  compartments: MIRROR_COMPARTMENTS,
  legacyBindings: LEGACY_LOCATION_BINDINGS,
  retiredCompartments: [
    {
      id: "left-hanger-i",
      label: "행거 I",
      displayAlias: "left-hanger-b",
      physicalRelocation: false,
    },
    {
      id: "right-shoes",
      label: "신발장",
      displayAlias: null,
      physicalRelocation: false,
    },
  ],
});
