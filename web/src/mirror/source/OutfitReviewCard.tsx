import { useEffect, useId, useState } from "react";
import type { Garment, OutfitDraft, Slot } from "./core/types";
import { Icon } from "./Icons";
import {
  REVIEW_AVAILABILITY_LABELS,
  REVIEW_SLOTS,
  REVIEW_SLOT_LABELS,
  confirmReviewAvailability,
  createOutfitReviewState,
  reconcileOutfitReviewState,
  replacementDecision,
  reviewCurrentOutfit,
  reviewGarmentIdentity,
  reviewReplacementCandidates,
  type ReviewAvailability,
  type OutfitReviewState,
} from "./outfitReview";
import "./OutfitReviewCard.css";

export interface OutfitReviewCardProps {
  ownerId: string;
  garments: Garment[];
  draft: OutfitDraft;
  onReplace: (slot: Slot, garmentId: string) => void;
  review?: OutfitReviewState;
  onReviewChange?: (review: OutfitReviewState) => void;
}
/** Confirmations belong to this review (controlled or mounted); they never change garment status or call a provider. */
export function OutfitReviewCard(props: OutfitReviewCardProps) {
  return <OutfitReviewContent key={props.ownerId} {...props} />;
}
function OutfitReviewContent({
  ownerId,
  garments,
  draft,
  onReplace,
  review: controlledReview,
  onReviewChange,
}: OutfitReviewCardProps) {
  const titleId = useId(),
    [localReview, setLocalReview] = useState(() =>
      createOutfitReviewState(ownerId),
    ),
    [slot, setSlot] = useState<Slot>("bottom"),
    [showAll, setShowAll] = useState(false),
    [message, setMessage] = useState("");
  const review = controlledReview ?? localReview;
  const setReview = (next: OutfitReviewState) => {
    if (controlledReview === undefined) setLocalReview(next);
    onReviewChange?.(next);
  };
  const inventoryIdentity = JSON.stringify(
    garments.map(reviewGarmentIdentity).sort(),
  );
  useEffect(() => {
    const next = reconcileOutfitReviewState(review, ownerId, garments);
    if (next !== review) setReview(next);
    setMessage("");
  }, [ownerId, inventoryIdentity, review]);
  const input = { ownerId, garments, draft, review },
    current = reviewCurrentOutfit(input),
    candidates = reviewReplacementCandidates(input, slot);
  const blocked = current.items.filter(
    (item) => item.status === "laundry" || item.status === "repair",
  ).length;
  const unchecked = current.items.filter(
    (item) => item.status === "unknown",
  ).length;
  const confirmed = current.items.filter(
    (item) => item.status === "available",
  ).length;
  const changeStatus = (garmentId: string, status: ReviewAvailability) => {
    setReview(
      confirmReviewAvailability(review, ownerId, garments, garmentId, status),
    );
    setMessage("");
  };
  const statusControl = (garment: Garment, status: ReviewAvailability) => (
    <label className="outfit-review-status-control">
      <span className="outfit-review-sr-only">{garment.name} 사용 상태</span>
      <select
        aria-label={`${garment.name} 사용 상태`}
        value={status}
        onChange={(event) =>
          changeStatus(garment.id, event.target.value as ReviewAvailability)
        }
      >
        {Object.entries(REVIEW_AVAILABILITY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const replace = (garmentId: string) => {
    const decision = replacementDecision(input, slot, garmentId);
    if (!decision.allowed) {
      setMessage(decision.reason);
      return;
    }
    try {
      onReplace(slot, garmentId);
      setMessage(
        `${REVIEW_SLOT_LABELS[slot]} 선택을 바꿨어요. 코디 저장과 실제 착용 기록은 별도예요.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "코디를 바꾸지 못했어요. 현재 선택을 다시 확인해 주세요.",
      );
    }
  };
  return (
    <section className="outfit-review-card" aria-labelledby={titleId}>
      <header className="outfit-review-heading">
        <span className="outfit-review-heading-icon">
          <Icon name="check" size={19} />
        </span>
        <div>
          <p className="outfit-review-eyebrow">입기 전 한 번 더</p>
          <h2 id={titleId}>보유 의류 점검</h2>
        </div>
      </header>
      <p className="outfit-review-note">이번 검토의 확인 · DB 상태 변경 아님</p>
      <p className="outfit-review-intro">
        지금 사용할 수 있는 옷을 확인하고, 같은 종류의 보유 의류로 바꿔 보세요.
      </p>
      {current.issues.length > 0 ? (
        <div className="outfit-review-warning" role="status">
          {current.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      ) : (
        <>
          <div className="outfit-review-summary" aria-live="polite">
            <span>
              <b>{confirmed}</b> 사용 가능
            </span>
            <span className={unchecked ? "needs-check" : ""}>
              <b>{unchecked}</b> 확인 필요
            </span>
            <span className={blocked ? "is-blocked" : ""}>
              <b>{blocked}</b> 사용 불가
            </span>
          </div>
          {blocked > 0 && (
            <p className="outfit-review-warning">
              세탁·수선 중인 옷이 현재 코디에 있어요. 해당 종류의 교체 후보를
              확인해 주세요.
            </p>
          )}
          <h3 className="outfit-review-subheading">현재 구성 확인</h3>
          <ul className="outfit-review-current">
            {current.items.map((item) => (
              <li
                key={item.slot}
                className={
                  item.status === "laundry" || item.status === "repair"
                    ? "is-blocked"
                    : ""
                }
              >
                <div className="outfit-review-item-copy">
                  <span className="outfit-review-slot">
                    {REVIEW_SLOT_LABELS[item.slot]}
                    {item.slot === "top" && draft.topLocked && (
                      <Icon name="lock" size={12} />
                    )}
                  </span>
                  <strong>
                    {item.garment?.name ??
                      (item.garmentId
                        ? "의류 참조 확인 필요"
                        : "아직 선택하지 않음")}
                  </strong>
                  {item.issues.length > 0 && (
                    <small>{item.issues.join(" ")}</small>
                  )}
                </div>
                {item.garment && statusControl(item.garment, item.status)}
              </li>
            ))}
          </ul>
          <div className="outfit-review-candidate-heading">
            <h3 className="outfit-review-subheading">바꿀 옷 살펴보기</h3>
            <label>
              <span className="outfit-review-sr-only">바꿀 종류</span>
              <select
                aria-label="점검 카드에서 바꿀 종류"
                value={slot}
                onChange={(event) => {
                  setSlot(event.target.value as Slot);
                  setShowAll(false);
                  setMessage("");
                }}
              >
                {REVIEW_SLOTS.map((value) => (
                  <option key={value} value={value}>
                    {REVIEW_SLOT_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="outfit-review-candidate-note">
            사용 가능으로 확인한 옷만 교체할 수 있어요. 색상과 종류는 옷장에
            등록된 정보예요.
          </p>
          {slot === "top" && draft.topLocked && (
            <p className="outfit-review-warning">
              <Icon name="lock" size={13} /> 상의 고정을 해제하면 다른 상의를
              선택할 수 있어요.
            </p>
          )}
          {candidates.length === 0 ? (
            <p className="outfit-review-empty">
              현재 선택한 옷 외에 확인할 수 있는 {REVIEW_SLOT_LABELS[slot]}가
              없어요.
            </p>
          ) : (
            <ul className="outfit-review-candidates">
              {(showAll ? candidates : candidates.slice(0, 6)).map(
                (candidate) => (
                  <li
                    key={candidate.garment.id}
                    className={candidate.canReplace ? "is-ready" : ""}
                  >
                    <div className="outfit-review-candidate-copy">
                      <span
                        className={`outfit-review-badge ${candidate.canReplace ? "is-ready" : ""}`}
                      >
                        {candidate.canReplace
                          ? "교체 후보"
                          : REVIEW_AVAILABILITY_LABELS[candidate.status]}
                      </span>
                      <strong>{candidate.garment.name}</strong>
                      <p>{candidate.reasons.join(" · ")}</p>
                    </div>
                    <div className="outfit-review-candidate-controls">
                      {statusControl(candidate.garment, candidate.status)}
                      <button
                        type="button"
                        disabled={!candidate.canReplace}
                        title={candidate.restriction || undefined}
                        onClick={() => replace(candidate.garment.id)}
                      >
                        이 옷으로 교체
                        <Icon name="arrow" size={14} />
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
          {candidates.length > 6 && (
            <button
              className="outfit-review-show-all"
              type="button"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "후보 접기" : `후보 ${candidates.length}개 모두 보기`}
            </button>
          )}
        </>
      )}
      {message && (
        <p className="outfit-review-message" role="status">
          {message}
        </p>
      )}
      <footer>
        현재 화면에서만 유지돼요. 계정·의류·사진 버전이 바뀌면 다시 확인해
        주세요.
      </footer>
    </section>
  );
}
