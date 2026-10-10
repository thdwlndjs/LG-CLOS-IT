import { lifeHistoryReadOptions } from "./lifeSnapshot";
import { effectiveLifeEvents, lifeEventSource } from "./lifeHistory";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { app } from "./appInstance";
import type { CareGuide, Garment } from "./core/types";
import { MirrorGarmentGrid } from "./MirrorGarmentGrid";
import { HorizontalPager } from "./HorizontalPager";
export function MirrorCareOverview({
  onSelect,
}: {
  onSelect: (g: Garment) => void;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getState);
  const [view, setView] = useState<"schedule" | "guide">("guide"),
    [page, setPage] = useState(0);
  const garments = app.garments(),
    events = effectiveLifeEvents(
      state.activeProfileId,
      app.events(),
      lifeHistoryReadOptions(state, state.activeProfileId),
    )
      .events.filter((e) => e.kind === "care")
      .reverse();
  useEffect(() => setPage(0), [state.activeProfileId, view]);
  return (
    <section className="mx-work mg-care-overview">
      <h1>케어</h1>
      <div className="mg-care-tabs">
        <button
          aria-pressed={view === "schedule"}
          onClick={() => setView("schedule")}
        >
          관리 일정
        </button>
        <button
          aria-pressed={view === "guide"}
          onClick={() => setView("guide")}
        >
          관리 가이드
        </button>
      </div>
      {view === "guide" ? (
        <>
          <p className="mx-fine">확인할 옷을 선택해 주세요.</p>
          <MirrorGarmentGrid
            garments={garments}
            index={page}
            onIndexChange={setPage}
            onSelect={onSelect}
            label="케어 의류 탐색"
          />
        </>
      ) : (
        <>
          <p className="mx-fine">
            확인된 관리 기록 · 다음 관리일은 등록된 정보가 없어요.
          </p>
          {events.length ? (
            <HorizontalPager
              label="관리 기록 탐색"
              index={page}
              onIndexChange={setPage}
              peek={0}
            >
              {events.map((event) => {
                const targets = garments.filter((g) =>
                    event.garmentIds
                      ? event.garmentIds.includes(g.id)
                      : g.id === event.garmentId,
                  ),
                  g = targets[0];
                return (
                  <article className="mg-care-list" key={event.id}>
                    <strong>
                      {targets.map((g) => g.name).join(" · ") ||
                        "연결 의류 확인 필요"}
                    </strong>
                    <p>{event.date}</p>
                    <p>{event.value}</p>
                    {lifeEventSource(event) === "scenario_fixture" && (
                      <small>시연 생활 기록 · 실제 사용자 이력 아님</small>
                    )}
                    {g && (
                      <button onClick={() => onSelect(g)}>
                        이 옷의 관리법
                      </button>
                    )}
                  </article>
                );
              })}
            </HorizontalPager>
          ) : (
            <p className="mx-glass">
              관리 일정·기록이 아직 없어요. 마지막 세탁 후 경과일을 착용 일수로
              바꾸지 않아요.
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function MirrorCareHelp({
  garment,
  evidenceAvailable = null,
}: {
  garment: Garment;
  evidenceAvailable?: boolean | null;
}) {
  const [guide, setGuide] = useState<CareGuide | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [expanded, setExpanded] = useState(false);
  const mounted = useRef(true),
    owner = garment.ownerId,
    id = garment.id,
    repository = app.repository;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const request = async () => {
    if (busy || evidenceAvailable !== true) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await app.requestCareGuide(id);
      if (
        !mounted.current ||
        app.getState().activeProfileId !== owner ||
        app.repository !== repository
      )
        return;
      if (result.status === "success") {
        setGuide(result.data);
        setExpanded(true);
      } else setMessage(result.message);
    } catch {
      if (mounted.current && app.getState().activeProfileId === owner)
        setMessage(
          "도움을 확인하지 못했어요. 확인된 원문은 그대로 볼 수 있어요.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  if (evidenceAvailable !== true)
    return (
      <div className="mg-care-helper">
        <small>
          {evidenceAvailable === false
            ? "검토된 관리 근거를 보완하면 도움을 요청할 수 있어요."
            : "확인된 근거를 먼저 불러온 뒤 관리 도움을 요청할 수 있어요."}
        </small>
      </div>
    );
  return (
    <div className="mg-care-helper">
      <button disabled={busy} onClick={() => void request()}>
        {busy ? "도움 확인 중" : "관리 도움 요청"}
      </button>
      {message && <small role="status">{message}</small>}
      {guide && (
        <>
          <small>
            {guide.source === "local-evidence-summary"
              ? "저장된 근거 요약 · 로컬"
              : guide.source === "provider"
                ? "AI 안내 · 원문 근거와 구분"
                : guide.source === "prepared-demo"
                  ? "준비된 시연 안내 · 실제 라벨 아님"
                  : "확인할 정보 안내"}
          </small>
          <button onClick={() => setExpanded(!expanded)}>
            {expanded ? "안내 닫기" : "안내 읽기"}
          </button>
          {expanded && (
            <div
              className="mg-guide-original"
              role="region"
              aria-label="관리 도움 원문"
            >
              {guide.advice}
            </div>
          )}
        </>
      )}
    </div>
  );
}
