import React, { useEffect, useId, useRef, useState } from "react";
import { assetUrl } from "./api.js";

export const labels = {
  TOP: "상의",
  BOTTOM: "하의",
  OUTER: "아우터",
  SHOES: "신발",
  ACCESSORY: "액세서리",
  DRESS: "원피스",
  AVAILABLE: "사용 가능",
  IN_USE: "사용 중",
  LAUNDRY: "세탁 중",
  CARE: "관리 중",
  STORED: "보관 중",
  UNKNOWN: "미확인",
  RETIRED: "사용 종료",
  SAVED: "저장됨",
  DRAFT: "초안",
  ARCHIVED: "보관됨",
  SCHEDULED: "예정",
  OVERDUE: "기한 지남",
  COMPLETED: "완료",
  CANCELLED: "취소",
  CONFIRMED: "착용 확인",
  SELECTED: "코디 선택",
  NOT_DONE: "미수행",
  WASH: "세탁",
  DRY: "건조",
  CLEAN: "드라이클리닝",
  INSPECT: "점검",
  OTHER: "기타",
  PROPOSED: "제안",
  APPROVED: "승인됨",
  REJECTED: "거절",
  FAILED: "실패",
  EXPIRED: "만료",
  IN_PROGRESS: "진행 중",
  AWAITING_CONFIRMATION: "실제 이동 확인 대기",
  QUEUED: "대기 중",
  RUNNING: "처리 중",
  SUCCEEDED: "성공",
  READY: "준비됨",
  TIMED_OUT: "시간 초과",
  MOCK: "Mock",
  PARTIAL: "부분 데이터",
  CACHED: "캐시",
  FRESH: "최신",
  STALE: "오래된 데이터",
  EMPTY: "데이터 없음",
  UNAVAILABLE: "연결 불가",
  TRUNCATED: "일부만 표시",
  WEAR: "실제 착용",
  OUTFIT_SELECTION: "코디 선택",
  SPRING: "봄",
  SUMMER: "여름",
  AUTUMN: "가을",
  WINTER: "겨울",
  ALL: "사계절",
  WHITE: "화이트",
  BLACK: "블랙",
  BLUE: "블루",
  GRAY: "그레이",
  BEIGE: "베이지",
  GENERAL: "일반 안내",
  LABEL: "케어라벨",
  USER_PROFILE: "사용자 설정",
};
export const label = (x) => labels[x] || x;
export const time = (x) => (x ? new Date(x).toLocaleString("ko-KR") : "미확인");
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const localInput = (x) => {
  const d = x ? new Date(x) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function Badge({ children, kind = "" }) {
  return <span className={`badge ${kind}`}>{label(children)}</span>;
}
export function Empty({ title = "아직 항목이 없어요", children }) {
  return (
    <div className="empty">
      <span className="empty-mark">＋</span>
      <h3>{title}</h3>
      <p>{children || "새 항목을 추가하면 여기에 표시됩니다."}</p>
    </div>
  );
}
export function ErrorBox({ error, retry }) {
  return error ? (
    <div role="alert" className="error">
      <strong>{error.message}</strong>
      {error.code && <small>오류 코드: {error.code}</small>}
      {retry && (
        <button className="text-button" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  ) : null;
}
export function useLoad(load, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const [tick, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    set((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => load(controller.signal))
      .then((data) => {
        if (active) set({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (active && error.name !== "AbortError")
          set({ data: null, error, loading: false });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [...deps, tick]);
  return { ...state, reload: () => refresh((x) => x + 1) };
}
export function Load({ state, children }) {
  if (state.loading)
    return (
      <div role="status" className="loading">
        옷장을 불러오는 중…
      </div>
    );
  if (state.error) return <ErrorBox error={state.error} retry={state.reload} />;
  return children(state.data);
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const lock = useRef(false);
  const run = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError(null) };
}
export function Field({ label: caption, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{caption}</label>
      {React.cloneElement(children, { id })}
    </div>
  );
}
export function Select({ values, ...props }) {
  return (
    <select {...props}>
      {values.map((x) => {
        const [v, t] = Array.isArray(x) ? x : [x, label(x)];
        return (
          <option key={v} value={v}>
            {t}
          </option>
        );
      })}
    </select>
  );
}
export function Modal({ title, children, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const d = dialog.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="modal"
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button aria-label="닫기" className="icon-button" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Photo({ asset, category = "TOP" }) {
  const [broken, setBroken] = useState(false);
  const src = assetUrl(asset?.read_url);
  useEffect(() => setBroken(false), [src]);
  return (
    <div className={`photo ${category.toLowerCase()}`}>
      {src && !broken ? (
        <img
          src={src}
          alt="의류 사진"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <>
          <svg viewBox="0 0 160 160" aria-hidden="true">
            {category === "BOTTOM" ? (
              <path d="M46 30h68l9 106H90L80 74l-10 62H37z" />
            ) : category === "SHOES" ? (
              <path d="M27 87l42-38 23 31 37 14c11 5 13 22 0 27H27z" />
            ) : category === "DRESS" ? (
              <path d="M62 27h36l-4 35 28 77H38l28-77z" />
            ) : (
              <path d="M53 32l27 10 27-10 34 34-25 23-12-15v62H56V74L44 89 19 66z" />
            )}
          </svg>
          <small>{broken ? "사진 만료 · 새로고침해주세요" : "사진 없음"}</small>
        </>
      )}
    </div>
  );
}
export function Pager({ page, onPage }) {
  return page && page.total > page.limit ? (
    <div className="pager">
      <button
        disabled={page.offset === 0}
        onClick={() => onPage(Math.max(0, page.offset - page.limit))}
      >
        이전
      </button>
      <span>
        {page.offset + 1}–{Math.min(page.total, page.offset + page.limit)} /{" "}
        {page.total}
      </span>
      <button
        disabled={page.offset + page.limit >= page.total}
        onClick={() => onPage(page.offset + page.limit)}
      >
        다음
      </button>
    </div>
  ) : null;
}
export function SectionHead({ eyebrow, title, children }) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Notice({ children }) {
  return <p className="notice">{children}</p>;
}
export function JobPanel({ api, id, onDone }) {
  const [job, setJob] = useState(null),
    [error, setError] = useState(null),
    [tick, setTick] = useState(0);
  const action = useAction();
  const callback = useRef(onDone);
  callback.current = onDone;
  useEffect(() => {
    let active = true,
      timer;
    const c = new AbortController();
    async function poll() {
      try {
        const result = await api.get(`/jobs/${id}`, { signal: c.signal });
        if (!active) return;
        setJob(result);
        setError(null);
        if (["QUEUED", "RUNNING"].includes(result.status))
          timer = setTimeout(poll, 2000);
        else callback.current?.(result);
      } catch (e) {
        if (active && e.name !== "AbortError") setError(e);
      }
    }
    poll();
    return () => {
      active = false;
      c.abort();
      clearTimeout(timer);
    };
  }, [id, tick, api]);
  return (
    <div className="job" role="status">
      <strong>작업 {label(job?.status || "QUEUED")}</strong>
      <progress max="100" value={job?.progress_pct || 0} />
      <span>
        시도 {job?.attempt_count || 0}회{" "}
        {job?.provider_mode && `· ${job.provider_mode}`}
      </span>
      {job?.stale && (
        <Notice>이전 구성의 결과입니다. 현재 코디에 반영되지 않습니다.</Notice>
      )}
      {job?.error && <Notice>처리 실패: {job.error.code}</Notice>}
      <ErrorBox
        error={error || action.error}
        retry={() => setTick((x) => x + 1)}
      />
      {["QUEUED", "RUNNING"].includes(job?.status) && (
        <button
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              setJob(await api.send(`/jobs/${id}/cancel`, {}));
              setTick((x) => x + 1);
            })
          }
        >
          작업 취소
        </button>
      )}
    </div>
  );
}
