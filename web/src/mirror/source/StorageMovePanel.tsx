import { useRef, useState } from "react";
import { api, currentMember } from "./integrations/backendClient";
import { homeServerStorageAdvice } from "./homeServerActions";
import type { DemoApp } from "./core/app";

/** Approval is intent. Only an explicit physical completion updates locations. */
export function StorageMovePanel({ app }: { app: DemoApp }) {
  const [actions, setActions] = useState<any[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sending = useRef(false);
  const owner = app.getState().activeProfileId;
  const run = async (work: (check: () => void) => Promise<void>) => {
    if (sending.current) return;
    const repository = app.repository;
    sending.current = true;
    setBusy(true);
    setMessage("");
    const check = () => {
      if (
        app.getState().activeProfileId !== owner ||
        currentMember()?.id !== owner ||
        repository !== app.repository
      )
        throw Error("사용자가 바뀌어 이전 이동 작업을 계속하지 않습니다.");
    };
    try {
      check();
      await work(check);
    } catch (e) {
      if (app.getState().activeProfileId === owner)
        setMessage((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const reload = async (check: () => void) => {
    const result: any = await api().get("/storage-actions");
    check();
    setActions(result.items);
    setChecked({});
  };
  return (
    <section aria-label="보관 이동 완료 확인" className="mx-home-advice">
      <h2>보관·회수 이동</h2>
      <small>
        가구 관리자: 접근 가능한 기기의 가족 의류 관리 · 일반 구성원: 내 소유
        의류 이동
      </small>
      <button
        disabled={busy}
        onClick={() =>
          void run(async (check) => {
            await homeServerStorageAdvice(check, false, "WINTER");
            check();
            await reload(check);
            setMessage(
              "제안만 생성했습니다. 승인해도 현재 위치는 바뀌지 않습니다.",
            );
          })
        }
      >
        겨울 보관·회수 제안 만들기
      </button>
      <button disabled={busy} onClick={() => void run(reload)}>
        이동 제안 조회
      </button>
      {actions.map((action) => (
        <div key={action.id} data-storage-action-id={action.id}>
          <strong>
            {action.action_type} · {action.status}
          </strong>
          {action.items.map((item: any) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                disabled={
                  busy ||
                  !["APPROVED", "AWAITING_CONFIRMATION"].includes(action.status) ||
                  !["PENDING", "AWAITING_CONFIRMATION"].includes(item.status)
                }
                onChange={(e) =>
                  setChecked((v) => ({ ...v, [item.id]: e.target.checked }))
                }
              />
              {app.garments().find((g) => g.id === item.garment_id)?.name ??
                item.garment_id}
              {" → "}
              {item.destination_location_id} · 실제 이동 완료
            </label>
          ))}
          {action.status === "PROPOSED" && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async (check) => {
                  await api().send(
                    "POST",
                    `/storage-actions/${action.id}/decision`,
                    { expected_version: action.version, decision: "APPROVE" },
                  );
                  check();
                  await reload(check);
                  setMessage(
                    "승인했습니다. 물리적으로 이동 후 완료를 확인하세요.",
                  );
                })
              }
            >
              제안 승인
            </button>
          )}
          {["APPROVED", "AWAITING_CONFIRMATION"].includes(action.status) && (
            <button
              disabled={busy || !action.items.some((i: any) => checked[i.id])}
              onClick={() =>
                void run(async (check) => {
                  const items = action.items
                    .filter((i: any) => checked[i.id])
                    .map((i: any) => ({
                      garment_id: i.garment_id,
                      confirmed: true,
                      observed_location_id: i.destination_location_id,
                      observed_at: new Date().toISOString(),
                      confirmation_method: "USER",
                    }));
                  await api().send(
                    "POST",
                    `/storage-actions/${action.id}/confirm`,
                    { expected_version: action.version, items },
                  );
                  check();
                  await app.reloadRemote();
                  check();
                  await reload(check);
                  setMessage("선택한 품목의 이동 완료를 저장했습니다.");
                })
              }
            >
              선택한 의류 이동 완료 저장
            </button>
          )}
          {["PROPOSED", "APPROVED", "AWAITING_CONFIRMATION"].includes(
            action.status,
          ) && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async (check) => {
                  await api().send(
                    "POST",
                    `/storage-actions/${action.id}/decision`,
                    { expected_version: action.version, decision: "CANCEL" },
                  );
                  check();
                  await reload(check);
                  setMessage("취소했습니다. 현재 위치는 유지됩니다.");
                })
              }
            >
              이동 취소
            </button>
          )}
        </div>
      ))}
      <p role="status">{message}</p>
    </section>
  );
}
