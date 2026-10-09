import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Garment, Outfit, DemoEvent } from "./core/types";
import { garmentWearSummary } from "./core/wearScenario";

export function useToday() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return {
    date,
    time: new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now),
    label: new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(now),
  };
}
export function GarmentFacts({
  garment,
  ownerId,
  outfits,
  events,
  onTakeOut,
}: {
  garment: Garment;
  ownerId: string;
  outfits: Outfit[];
  events: DemoEvent[];
  onTakeOut: () => void;
}) {
  const summary = garmentWearSummary(garment.id, ownerId, outfits, events);
  const hasEvidence =
    garment.provenance.care === "user" && !!garment.careNotes.trim();
  return (
    <section
      className="garment-facts"
      data-facts-garment-id={garment.id}
      aria-label="선택 의류의 착용과 관리"
    >
      <div className="wear-facts">
        <strong>
          실제 착용{" "}
          <b data-wear-days={summary.wearDays}>{summary.wearDays}일</b>
        </strong>
        <span>마지막 착용 {summary.lastWornDate ?? "기록 없음"}</span>
      </div>
      <small>선택·피팅·코디 저장·착용 계획은 포함하지 않아요.</small>
      {summary.unresolvedWearEvents > 0 && (
        <small>연결된 코디를 찾지 못한 과거 기록은 합산하지 않았어요.</small>
      )}
      <details className="washing-guidance">
        <summary>라벨 기반 세탁 안내</summary>
        {hasEvidence ? (
          <>
            <p>{garment.careNotes}</p>
            <small>
              직접 입력한 관리 근거 · 실제 라벨과 함께 확인해 주세요.
            </small>
          </>
        ) : (
          <>
            <p>관리 라벨 미확인</p>
            <small>
              세탁법을 추측하지 않아요. 아래 관리 근거에 실제 라벨 내용을 입력할
              수 있어요.
            </small>
            {garment.careNotes && (
              <p className="subtle">
                {garment.provenance.care === "demo"
                  ? "시연용 참고 메모"
                  : "미확인 메모"}
                : {garment.careNotes}
              </p>
            )}
          </>
        )}
        <p className="subtle">
          착용 일수만으로 세탁 필요 여부를 판단하지 않아요.
        </p>
      </details>
      <button
        type="button"
        className="button take-out-button"
        onClick={onTakeOut}
      >
        옷 꺼내기 · 위치 안내
      </button>
    </section>
  );
}
export function WardrobeRail({
  garments,
  selectedId,
  onSelect,
  photo,
  location,
}: {
  garments: Garment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  photo: (g: Garment) => ReactNode;
  location: (g: Garment) => string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const move = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * (rail.current.clientWidth * 0.8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  return (
    <section className="wardrobe-browser" aria-label="의류 가로 탐색">
      <div className="rail-controls">
        <span>좌우로 옷 둘러보기</span>
        <button
          type="button"
          aria-label="이전 의류 보기"
          onClick={() => move(-1)}
        >
          이전
        </button>
        <button
          type="button"
          aria-label="다음 의류 보기"
          onClick={() => move(1)}
        >
          다음
        </button>
      </div>
      <div
        className="garment-rail"
        ref={rail}
        tabIndex={0}
        aria-label="옷 목록 가로 스크롤"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            move(e.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        {garments.map((g) => (
          <button
            data-garment-id={g.id}
            className={`garment-card ${selectedId === g.id ? "selected" : ""}`}
            aria-pressed={selectedId === g.id}
            key={g.id}
            onClick={() => onSelect(g.id)}
          >
            <div>{photo(g)}</div>
            <strong>{g.name}</strong>
            <small>{location(g)}</small>
            <code>{g.id}</code>
          </button>
        ))}
      </div>
    </section>
  );
}
