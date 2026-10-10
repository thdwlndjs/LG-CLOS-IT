import { useEffect, useRef, useState } from "react";
import { app } from "./appInstance";
import { currentMember } from "./integrations/backendClient";
import { confirmedTimestamp, serverCommand } from "./secondHandoffActions";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
import { completeOutfit, hasExternalItems } from "./core/externalOutfits";

/** Wear confirmation is a separate, explicit action; it does not require an invented plan. */
export function ServerWearConfirmation({ date }: { date: string }) {
  const owner = app.getState().activeProfileId,
    repository = app.repository;
  const storageKey = `smartcloset.remote-wear.pending.v1:${owner}:${date}`;
  const [original] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (
        value.owner !== owner ||
        value.date !== date ||
        typeof value.outfitId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(value.intentKey) ||
        typeof value.time !== "string"
      )
        throw Error("invalid");
      confirmedTimestamp(date, value.time);
      return value as {
        owner: string;
        date: string;
        outfitId: string;
        time: string;
        intentKey: string;
      };
    } catch {
      return {
        error: "이전 착용 요청을 읽지 못했습니다. 새 기록을 보내지 않습니다.",
      };
    }
  });
  const recovered = original && !("error" in original) ? original : null;
  const [recovering, setRecovering] = useState(!!recovered);
  const [open, setOpen] = useState(!!recovered),
    [outfitId, setOutfitId] = useState(recovered?.outfitId || ""),
    [time, setTime] = useState(recovered?.time || ""),
    [checked, setChecked] = useState(!!recovered),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const intent = useRef(recovered?.intentKey || crypto.randomUUID()),
    mounted = useRef(true),
    sending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    currentMember()?.id === owner &&
    app.repository === repository;
  const outfits = app
    .outfits()
    .filter(
      (o) =>
        /^[a-f0-9-]{36}$/i.test(o.id) &&
        !hasExternalItems(o) &&
        completeOutfit(o),
    );
  const outfit = outfits.find((o) => o.id === outfitId);
  const submit = async () => {
    if (
      sending.current ||
      !outfit ||
      !checked ||
      (original && "error" in original)
    )
      return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        member_id: owner,
        outfit_id: outfit.id,
        worn_at: confirmedTimestamp(date, time),
        confirmation_method: "USER",
      };
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          owner,
          date,
          outfitId: outfit.id,
          time,
          intentKey: intent.current,
        }),
      );
      setRecovering(true);
      await serverCommand(`wear:${intent.current}`, payload, (step) =>
        step("wear", "POST", "/wear-confirmations", payload),
      );
      if (!current()) return;
      await app.reloadRemote();
      if (!current()) return;
      sessionStorage.removeItem(storageKey);
      setRecovering(false);
      setOpen(false);
      setChecked(false);
      intent.current = crypto.randomUUID();
      setMessage("직접 확인한 실제 착용을 기록했습니다.");
    } catch (e) {
      if (current())
        setMessage(
          (e as Error).message + " 원래 입력으로 다시 확인할 수 있습니다.",
        );
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <div className="mx-wear-confirm">
      <button type="button" onClick={() => setOpen(!open)} disabled={busy}>
        실제 착용 기록
      </button>
      {open && (
        <div role="group" aria-label="실제 착용 확인">
          <p>{date} · 코디 확정과 별도로 실제 입은 조합을 확인하세요.</p>
          <label>
            실제로 입은 코디
            <select
              aria-label="실제로 입은 코디"
              value={outfitId}
              disabled={busy || recovering}
              onChange={(e) => {
                setOutfitId(e.target.value);
                setChecked(false);
              }}
            >
              <option value="">선택하세요</option>
              {outfits.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {!outfits.length && (
            <p>
              먼저 보유 의류 조합을 저장하세요. 착용 예정은 자동 생성하지
              않습니다.
            </p>
          )}
          {outfit && <MirrorOutfitThumbnail app={app} outfit={outfit} />}
          <label>
            실제 착용 시간 (한국 시간)
            <input
              aria-label="실제 착용 시간"
              type="time"
              value={time}
              disabled={busy || recovering}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || recovering}
              onChange={(e) => setChecked(e.target.checked)}
            />
            선택한 날짜·시간에 이 옷을 실제로 입었습니다.
          </label>
          <button
            type="button"
            disabled={busy || !outfit || !time || !checked}
            onClick={() => void submit()}
          >
            {busy ? "기록 확인 중" : "실제 착용 확인"}
          </button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            취소
          </button>
        </div>
      )}
      {original && "error" in original && <p role="status">{original.error}</p>}
      {recovering && (
        <small>
          미확인 요청의 원래 입력으로 결과를 확인합니다. 새 착용 요청을 만들지
          않습니다.
        </small>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
