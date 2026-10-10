import { careEvidenceGrounding } from "./careEvidence";
import type { CareGuide, Garment } from "./core/types";
import type { LifeSnapshot } from "./lifeSnapshot";

/** Deterministic local read summary. It neither generates management advice nor records an action. */
export function localLifeCareGuide(
  garment: Garment,
  life: LifeSnapshot,
): CareGuide {
  const unknown: CareGuide = {
    garmentId: garment.id,
    title: "관리 근거 확인 필요",
    advice:
      "관리 정보 원문 확인이 필요해요. 확인되지 않은 관리 조건은 안내하지 않아요.",
    source: "unconfirmed",
    actualCareRecorded: false,
  };
  if (
    life.ownerId !== garment.ownerId ||
    life.namespace !== "scprep-20261009-v1" ||
    !life.ownerId.startsWith("local:scprep-20261009-v1:profile:")
  )
    return unknown;
  const current = life.garments.find(
    (item) => item.id === garment.id && item.ownerId === garment.ownerId,
  );
  if (!current) return unknown;
  const grounds = life.evidence
    .filter(
      (item) =>
        item.ownerId === garment.ownerId && item.garmentId === garment.id,
    )
    .map(careEvidenceGrounding)
    .filter(
      (item): item is NonNullable<ReturnType<typeof careEvidenceGrounding>> =>
        item !== null,
    );
  if (!grounds.length) return unknown;
  const sourceLines = grounds.flatMap((item) => [
    item.source_label,
    ...(item.care_rows.length
      ? item.care_rows.map((row) => row.text)
      : [item.original_text]),
    item.applicability,
    ...(item.source_ref ? ["출처 · " + item.source_ref] : []),
  ]);
  const h = current.history;
  const historyLines = [
    "전체 기록된 착용 " + h.wearDays + "일 · " + h.wearCount + "회",
    h.lastWashDate ? "마지막 세탁 " + h.lastWashDate : "마지막 세탁 기록 없음",
    ...(h.lastWashDate
      ? [
          h.wearsAfterLastWash !== null && h.wearDaysAfterLastWash !== null
            ? "지난 세탁 후 착용 " +
              h.wearsAfterLastWash +
              "회 · " +
              h.wearDaysAfterLastWash +
              "일"
            : "세탁 후 착용 횟수·일수는 이력 확인이 필요해요.",
        ]
      : []),
    ...(h.availability === "drying_unconfirmed"
      ? ["세탁 후 건조 완료 기록은 없어요."]
      : h.availability === "user_marked_laundry_pending"
        ? ["사용자 관찰: 세탁 대기로 표시했어요."]
        : []),
    ...(h.sourceKinds.includes("scenario_fixture")
      ? ["시연 생활 기록 · 실제 사용자 이력 아님"]
      : []),
  ];
  return {
    garmentId: garment.id,
    title: "저장된 근거 요약 · 로컬",
    advice: [current.name, ...sourceLines, ...historyLines].join("\n"),
    source: "local-evidence-summary",
    actualCareRecorded: false,
  };
}
