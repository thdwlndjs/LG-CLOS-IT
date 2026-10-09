import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { app } from "./appInstance";
import type { CareGuide, Garment } from "./core/types";
import { MirrorGarmentGrid } from "./MirrorGarmentGrid";
import { HorizontalPager } from "./HorizontalPager";
import { api } from "./integrations/backendClient";
import { listAll } from "../../api.js";
export function MirrorCareOverview({
  onSelect,
}: {
  onSelect: (g: Garment) => void;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getState);
  const [view, setView] = useState<"schedule" | "guide">("guide"),
    [page, setPage] = useState(0);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [scheduleError, setScheduleError] = useState("");
  useEffect(() => {
    let current = true;
    setSchedules([]);
    setScheduleError("");
    void listAll(api(), "/care-schedules", { timezone: "Asia/Seoul" })
      .then((rows: any[]) => {
        if (current) setSchedules(rows);
      })
      .catch((e: Error) => {
        if (current) setScheduleError(e.message);
      });
    return () => {
      current = false;
    };
  }, [state.activeProfileId, state.revisionReceipts, view]);
  const garments = app.garments(),
    events = app
      .events()
      .filter((e) => e.kind === "care")
      .sort((a, b) => b.date.localeCompare(a.date));
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
          <p className="mx-fine">서버에 등록된 관리 일정과 확인된 기록</p>
          {scheduleError && <p role="status">{scheduleError}</p>}
          {schedules.length > 0 && (
            <HorizontalPager
              label="관리 일정 탐색"
              index={page}
              onIndexChange={setPage}
              peek={0}
            >
              {schedules.map((s) => (
                <article className="mg-care-list" key={s.id}>
                  <strong>
                    {garments.find((g) => g.id === s.garment_id)?.name ||
                      "연결 의류 확인 필요"}
                  </strong>
                  <p>
                    {new Date(s.scheduled_at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </p>
                  <p>
                    {s.care_type} · {s.status}
                  </p>
                  <p>{s.notes || ""}</p>
                </article>
              ))}
            </HorizontalPager>
          )}
          {events.length ? (
            <HorizontalPager
              label="관리 기록 탐색"
              index={page}
              onIndexChange={setPage}
              peek={0}
            >
              {events.map((event) => {
                const g = garments.find((g) => g.id === event.garmentId);
                return (
                  <article className="mg-care-list" key={event.id}>
                    <strong>{g?.name ?? "연결 의류 확인 필요"}</strong>
                    <p>{event.date}</p>
                    <p>{event.value}</p>
                    {g && (
                      <button onClick={() => onSelect(g)}>
                        이 옷의 관리법
                      </button>
                    )}
                  </article>
                );
              })}
            </HorizontalPager>
          ) : !schedules.length && !scheduleError ? (
            <p className="mx-glass">
              관리 일정·기록이 아직 없어요. 마지막 세탁 후 경과일을 착용 일수로
              바꾸지 않아요.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
export function MirrorCareHelp({ garment }: { garment: Garment }) {
  const [guide, setGuide] = useState<CareGuide | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [expanded, setExpanded] = useState(false);
  const mounted = useRef(true),
    owner = app.getState().activeProfileId,
    id = garment.id,
    repository = app.repository;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const request = async () => {
    if (busy) return;
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
      if (result.status === "success") setGuide(result.data);
      else setMessage(result.message);
    } catch {
      if (mounted.current && app.getState().activeProfileId === owner)
        setMessage(
          "도움을 확인하지 못했어요. 확인된 원문은 그대로 볼 수 있어요.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="mg-care-helper">
      <button disabled={busy} onClick={() => void request()}>
        {busy ? "도움 확인 중" : "관리 도움 요청"}
      </button>
      {message && <small role="status">{message}</small>}
      {guide && (
        <>
          <small>
            {guide.source === "provider"
              ? "서버 관리 안내 · 확인된 라벨과 구분"
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
