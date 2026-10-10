import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import {
  api,
  currentDevice,
  currentMember,
} from "./integrations/backendClient";
import { listAll } from "../../api.js";
import type { Garment } from "./core/types";
import { confirmedTimestamp, serverCommand } from "./secondHandoffActions";

export function ServerCareRecord({
  garment,
  onClose,
}: {
  garment: Garment;
  onClose: () => void;
}) {
  const owner = app.getState().activeProfileId,
    repository = app.repository;
  const [kind, setKind] = useState<"care" | "movement">("care"),
    [schedules, setSchedules] = useState<any[]>([]),
    [scheduleId, setScheduleId] = useState(""),
    [plannedDate, setPlannedDate] = useState(""),
    [plannedTime, setPlannedTime] = useState(""),
    [careType, setCareType] = useState("WASH"),
    [date, setDate] = useState(""),
    [time, setTime] = useState(""),
    [location, setLocation] = useState(""),
    [locations, setLocations] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pendingKey = `smartcloset.remote-care.pending.v1:${owner}:${garment.id}`;
  const [recovered] = useState(() => {
    const raw = sessionStorage.getItem(pendingKey);
    return raw ? JSON.parse(raw) : null;
  });
  const intent = useRef(recovered?.intent || crypto.randomUUID()),
    mounted = useRef(true),
    sending = useRef(false);
  const current = () =>
    mounted.current &&
    currentMember()?.id === owner &&
    app.repository === repository;
  useEffect(() => {
    mounted.current = true;
    if (recovered) {
      setScheduleId(recovered.scheduleId);
      setDate(recovered.date);
      setTime(recovered.time);
    }
    void listAll(api(), "/care-schedules", { garment_id: garment.id })
      .then((items: any[]) => {
        if (current())
          setSchedules([
            ...items.filter(
              (s: any) =>
                s.garment_id === garment.id &&
                ["SCHEDULED", "OVERDUE"].includes(s.status),
            ),
            ...(recovered?.schedule ? [recovered.schedule] : []),
          ]);
      })
      .catch((e: Error) => {
        if (current()) setMessage(e.message);
      });
    void api()
      .get(`/integration/devices/${currentDevice()}/locations`)
      .then((r: any) => {
        if (current()) setLocations(r.items);
      })
      .catch((e: Error) => {
        if (current()) setMessage(e.message);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const createSchedule = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const at = confirmedTimestamp(plannedDate, plannedTime);
      const schedule: any = await serverCommand(
        `care-plan:${intent.current}`,
        { garmentId: garment.id, careType, at },
        (step) =>
          step("schedule", "POST", "/care-schedules", {
            garment_id: garment.id,
            care_type: careType,
            scheduled_at: at,
            timezone: "Asia/Seoul",
          }),
      );
      if (!current()) return;
      setSchedules((previous) => [
        ...previous.filter((s) => s.id !== schedule.id),
        schedule,
      ]);
      setScheduleId(schedule.id);
      intent.current = crypto.randomUUID();
      setMessage(
        "관리 일정을 등록했습니다. 실제 완료 기록은 별도로 확인하세요.",
      );
    } catch (e) {
      if (current()) setMessage((e as Error).message);
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  };
  const record = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (kind === "care") {
        const at = confirmedTimestamp(date, time);
        const schedule = schedules.find((s) => s.id === scheduleId);
        if (!schedule) throw Error("먼저 등록된 관리 일정을 선택하세요.");
        sessionStorage.setItem(
          pendingKey,
          JSON.stringify({
            intent: intent.current,
            scheduleId,
            date,
            time,
            schedule,
          }),
        );
        await serverCommand(
          `care:${intent.current}`,
          { scheduleId, at },
          (step) =>
            step("complete", "POST", `/care-schedules/${scheduleId}/complete`, {
              completed_at: at,
              expected_version: schedule.version,
              outcome: "SUCCESS",
            }),
        );
        sessionStorage.removeItem(pendingKey);
      } else {
        if (!locations.some((l) => l.id === location))
          throw Error("등록된 실제 보관 위치를 선택하세요.");
        const payload = { garmentId: garment.id, location };
        await serverCommand(
          `movement:${intent.current}`,
          payload,
          async (step, check) => {
            check();
            const g: any = await api().get(`/garments/${garment.id}`);
            check();
            return step(
              "location",
              "PATCH",
              `/garments/${garment.id}`,
              {
                owner_id: g.owner_id,
                category: g.category,
                color: g.color,
                location_id: location,
              },
              { version: g.version },
            );
          },
        );
      }
      if (!current()) return;
      await app.reloadRemote();
      if (current()) {
        intent.current = crypto.randomUUID();
        setMessage(
          kind === "care"
            ? "실제로 완료한 관리 기록을 저장했습니다."
            : "직접 확인한 보관 위치를 저장했습니다.",
        );
      }
    } catch (e) {
      if (current())
        setMessage(
          ((e as { code?: string }).code === "TIME_MISMATCH"
            ? "일정 생성 이전의 과거 완료 시각은 현재 계약에서 지원하지 않습니다."
            : (e as Error).message) + " 동일 입력으로 다시 확인할 수 있습니다.",
        );
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <section
      className="mx-work mg-record-panel"
      aria-label="실제 관리 이동 기록"
    >
      <div className="mg-heading">
        <h1>{garment.name}</h1>
        <button onClick={onClose} disabled={busy}>
          닫기
        </button>
      </div>
      <p>실제로 마친 관리와 직접 확인한 위치만 저장하세요.</p>
      <div className="mg-care-tabs">
        <button
          disabled={busy}
          aria-pressed={kind === "care"}
          onClick={() => setKind("care")}
        >
          관리
        </button>
        <button
          disabled={busy}
          aria-pressed={kind === "movement"}
          onClick={() => setKind("movement")}
        >
          이동
        </button>
      </div>
      {kind === "care" ? (
        <>
          <label>
            등록된 관리 일정
            <select
              aria-label="등록된 관리 일정"
              value={scheduleId}
              disabled={busy || !!recovered}
              onChange={(e) => setScheduleId(e.target.value)}
            >
              <option value="">선택하세요</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.care_type} ·{" "}
                  {new Date(s.scheduled_at).toLocaleString("ko-KR")}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>새 관리 일정 등록</summary>
            <label>
              관리 종류
              <select
                aria-label="관리 일정 종류"
                disabled={busy || !!recovered}
                value={careType}
                onChange={(e) => setCareType(e.target.value)}
              >
                {["WASH", "DRY", "CLEAN", "INSPECT", "OTHER"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              예정 날짜
              <input
                aria-label="관리 예정 날짜"
                type="date"
                disabled={busy || !!recovered}
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </label>
            <label>
              예정 시간 (한국 시간)
              <input
                aria-label="관리 예정 시간"
                type="time"
                disabled={busy || !!recovered}
                value={plannedTime}
                onChange={(e) => setPlannedTime(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !!recovered || !plannedDate || !plannedTime}
              onClick={() => void createSchedule()}
            >
              관리 일정 등록
            </button>
          </details>
          <p>
            먼저 등록한 일정의 실제 완료만 기록할 수 있습니다. 일정 생성 이전의
            과거 관리 기록은 현재 계약에서 지원하지 않습니다.
          </p>
          <label>
            실제 완료 날짜
            <input
              aria-label="실제 완료 날짜"
              type="date"
              value={date}
              disabled={busy || !!recovered}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            실제 완료 시간 (한국 시간)
            <input
              aria-label="실제 완료 시간"
              type="time"
              step="1"
              value={time}
              disabled={busy || !!recovered}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
        </>
      ) : (
        <label>
          직접 확인한 새 위치
          <select
            aria-label="직접 확인한 새 위치"
            value={location}
            disabled={busy}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="">선택하세요</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <small>
        조회·닫기만으로 기록하지 않습니다. 위치 저장은 기존 의류 수정 API를
        사용합니다.
      </small>
      <button
        className="mx-primary"
        disabled={
          busy || (kind === "care" ? !scheduleId || !date || !time : !location)
        }
        onClick={() => void record()}
      >
        {busy
          ? "기록 확인 중"
          : kind === "care"
            ? "실제 완료한 관리 기록"
            : "확인한 이동 기록"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
