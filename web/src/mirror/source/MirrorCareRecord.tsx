import { ServerCareRecord } from "./ServerCareRecord";
import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import type { Garment } from "./core/types";
function LocalCareRecord({
  garment,
  onClose,
}: {
  garment: Garment;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"care" | "movement">("care"),
    [value, setValue] = useState("세탁 완료"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const mounted = useRef(true),
    pending = useRef(false),
    keys = useRef(new Map<string, string>()),
    owner = garment.ownerId,
    repository = app.repository;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const record = async () => {
    if (pending.current || !value.trim()) return;
    const identity = JSON.stringify([owner, garment.id, kind, value.trim()]);
    let key = keys.current.get(identity);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(identity, key);
    }
    pending.current = true;
    setBusy(true);
    setMessage("기록을 확인하고 있어요");
    try {
      const result =
        kind === "care"
          ? await app.recordActualCare(garment.id, value, key)
          : await app.recordMovementConfirmed(garment.id, value, key);
      if (
        mounted.current &&
        app.getState().activeProfileId === owner &&
        app.repository === repository
      )
        setMessage(
          result.replayed
            ? "이미 남긴 기록을 확인했어요."
            : "직접 확인한 내용을 기록했어요.",
        );
    } catch {
      if (
        mounted.current &&
        app.getState().activeProfileId === owner &&
        app.repository === repository
      )
        setMessage(
          "기록을 확인하지 못했어요. 같은 내용으로 다시 확인할 수 있어요.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section
      className="mx-work mg-record-panel"
      aria-label="실제 관리 이동 기록"
    >
      <div className="mg-heading">
        <h1>{garment.name}</h1>
        <button onClick={onClose}>닫기</button>
      </div>
      <p>실제로 마친 관리나 직접 확인한 이동만 기록해요.</p>
      <div className="mg-care-tabs">
        <button
          aria-pressed={kind === "care"}
          onClick={() => {
            setKind("care");
            setValue("세탁 완료");
            setMessage("");
          }}
        >
          관리
        </button>
        <button
          aria-pressed={kind === "movement"}
          onClick={() => {
            setKind("movement");
            setValue("");
            setMessage("");
          }}
        >
          이동
        </button>
      </div>
      {kind === "care" ? (
        <label>
          완료한 관리
          <select
            aria-label="완료한 관리"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            {["세탁 완료", "건조 완료", "관리 완료"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          직접 확인한 새 위치
          <input
            aria-label="직접 확인한 새 위치"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      )}
      <small>
        조회·닫기만으로 기록하지 않아요.{" "}
        {kind === "movement"
          ? "저장하면 이 옷의 보관 위치가 바뀌어요."
          : "실제 착용 기록은 별도예요."}
      </small>
      <button
        className="mx-primary"
        disabled={busy || !value.trim()}
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

export function MirrorCareRecord(props: {
  garment: Garment;
  onClose: () => void;
}) {
  return app.connection.kind === "supabase" ? (
    <ServerCareRecord {...props} />
  ) : (
    <LocalCareRecord {...props} />
  );
}
