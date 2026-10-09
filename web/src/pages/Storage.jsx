import React, { useState } from "react";
import { allGarments, query } from "../api.js";
import { demoLocations } from "../demo.js";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  JobPanel,
  Load,
  Modal,
  Notice,
  Pager,
  SectionHead,
  Select,
  label,
  time,
  useAction,
  useLoad,
} from "../ui.jsx";

function ActionDetail({ api, action: initial, onClose, onChanged, garments }) {
  const [value, setValue] = useState(initial),
    [checks, setChecks] = useState({}),
    [failure, setFailure] = useState(""),
    [deciding, setDeciding] = useState(null);
  const action = useAction();
  const decide = (decision) =>
    action.run(async () => {
      setValue(
        await api.send(`/storage-actions/${value.id}/decision`, {
          expected_version: value.version,
          decision,
        }),
      );
      setDeciding(null);
      onChanged();
    });
  const active = ["APPROVED", "IN_PROGRESS", "AWAITING_CONFIRMATION"].includes(
    value.status,
  );
  return (
    <Modal title="보관 이동 제안" onClose={onClose}>
      <Badge>{value.status}</Badge>
      <p>
        생성 {time(value.created_at)} · 만료 {time(value.expires_at)}
      </p>
      <ul>
        {value.reasoning.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      <Notice>
        승인은 실제 이동이 아닙니다. 실제로 옷을 옮긴 뒤 각 항목을 확인해주세요.
        실제 센서 확인은 연결되어 있지 않습니다.
      </Notice>
      {value.items.map((item) => (
        <div className="storage-item" key={item.id}>
          <strong>
            {label(garments.find((g) => g.id === item.garment_id)?.color || "")}{" "}
            {label(
              garments.find((g) => g.id === item.garment_id)?.category ||
                "의류",
            )}
          </strong>
          <Badge>{item.status}</Badge>
          <p>
            출발{" "}
            {garments.find((g) => g.id === item.garment_id)?.location_label ||
              "위치 미확인"}
          </p>
          <p>
            목적지:{" "}
            {garments.find(
              (g) => g.location_id === item.destination_location_id,
            )?.location_label ||
              demoLocations[item.destination_location_id] ||
              "위치 이름 미제공 · 기존 위치 정보를 확인해주세요."}
          </p>
          <details className="fine">
            <summary>위치 식별자 확인</summary>
            {item.destination_location_id}
          </details>
          <p>{item.reasons.join(" · ")}</p>
          {active &&
            !["COMPLETED", "FAILED", "SKIPPED"].includes(item.status) && (
              <Field label="실제 이동 결과">
                <Select
                  values={[
                    ["", "아직 확인하지 않음"],
                    ["success", "제안 목적지로 실제 이동 완료"],
                    ["failure", "이동하지 못함"],
                  ]}
                  value={checks[item.garment_id] || ""}
                  onChange={(e) =>
                    setChecks({ ...checks, [item.garment_id]: e.target.value })
                  }
                />
              </Field>
            )}
          {item.failure_reason && <p>실패 사유: {item.failure_reason}</p>}
        </div>
      ))}
      {Object.values(checks).includes("failure") && (
        <Field label="이동 실패 사유">
          <input
            maxLength="500"
            value={failure}
            onChange={(e) => setFailure(e.target.value)}
          />
        </Field>
      )}
      <ErrorBox error={action.error} />
      <div className="actions wrap">
        {value.status === "PROPOSED" && (
          <>
            <button
              className="primary"
              disabled={action.busy || !value.executable}
              onClick={() => setDeciding("APPROVE")}
            >
              이동 제안 승인
            </button>
            <button
              disabled={action.busy}
              onClick={() => setDeciding("REJECT")}
            >
              제안 거절
            </button>
          </>
        )}
        {active && (
          <>
            <button
              className="primary"
              disabled={
                action.busy ||
                !Object.values(checks).some(Boolean) ||
                (Object.values(checks).includes("failure") && !failure.trim())
              }
              onClick={() =>
                action.run(async () => {
                  const items = value.items
                    .filter((i) => checks[i.garment_id])
                    .map((i) =>
                      checks[i.garment_id] === "success"
                        ? {
                            garment_id: i.garment_id,
                            confirmed: true,
                            observed_location_id: i.destination_location_id,
                            observed_at: new Date().toISOString(),
                            confirmation_method: "USER",
                          }
                        : {
                            garment_id: i.garment_id,
                            confirmed: false,
                            confirmation_method: "USER",
                            failure_reason: failure,
                          },
                    );
                  setValue(
                    await api.send(`/storage-actions/${value.id}/confirm`, {
                      expected_version: value.version,
                      items,
                    }),
                  );
                  setChecks({});
                  onChanged();
                })
              }
            >
              선택 항목 실제 이동 확인
            </button>
            <button
              disabled={action.busy}
              onClick={() => setDeciding("CANCEL")}
            >
              남은 이동 취소
            </button>
          </>
        )}
        <button
          onClick={() =>
            action.run(async () => {
              setValue(await api.get(`/storage-actions/${value.id}`));
              setChecks({});
              onChanged();
            })
          }
        >
          상태 새로고침
        </button>
      </div>
      {deciding && (
        <div className="notice">
          <p>
            {deciding === "APPROVE"
              ? "이동 제안을 승인할까요? 위치는 아직 변경하지 않습니다."
              : deciding === "REJECT"
                ? "이 제안을 거절할까요?"
                : "완료된 이동은 유지하고 남은 항목을 취소할까요?"}
          </p>
          <button disabled={action.busy} onClick={() => decide(deciding)}>
            결정 확인
          </button>
          <button onClick={() => setDeciding(null)}>돌아가기</button>
        </div>
      )}
    </Modal>
  );
}
export function Storage({ api, member, navigate, notify }) {
  const [mode, setMode] = useState("WEAR_PATTERN"),
    [season, setSeason] = useState("ALL"),
    [dry, setDry] = useState(true),
    [window, setWindow] = useState(90),
    [job, setJob] = useState(null),
    [result, setResult] = useState(null),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(null);
  const action = useAction();
  const garments = useLoad((signal) => allGarments(api, signal), [api]);
  const state = useLoad(
    (signal) =>
      api.get("/storage-actions?" + query({ limit: 12, offset }), { signal }),
    [api, offset],
  );
  return (
    <>
      <SectionHead
        eyebrow="ROOM FOR WHAT MATTERS"
        title="옷장의 자리를 정리해요."
      >
        <button onClick={() => navigate("care")}>케어로 돌아가기</button>
      </SectionHead>
      <section className="panel">
        <h2>보관 최적화 분석</h2>
        <div className="filters">
          <Field label="분석 기준">
            <Select
              values={[
                ["WEAR_PATTERN", "착용 패턴"],
                ["SPACE_ENVIRONMENT", "공간·환경"],
              ]}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            />
          </Field>
          <Field label="계절">
            <Select
              values={["ALL", "SPRING", "SUMMER", "AUTUMN", "WINTER"]}
              value={season}
              onChange={(e) => setSeason(e.target.value)}
            />
          </Field>
          <Field label="분석 기간 (일)">
            <input
              type="number"
              min="1"
              max="365"
              value={window}
              onChange={(e) => setWindow(Number(e.target.value))}
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={dry}
            onChange={(e) => setDry(e.target.checked)}
          />
          미리 분석만 하기 (이동 제안 저장 안 함)
        </label>
        <button
          className="primary"
          disabled={
            action.busy || !window || window > 365 || (!!job && !result)
          }
          onClick={() =>
            action.run(async () => {
              setResult(null);
              const accepted = await api.send("/storage-optimization-jobs", {
                household_id: member.household_id,
                member_id: member.id,
                mode,
                season,
                analysis_window_days: window,
                dry_run: dry,
                garment_ids: [],
              });
              setJob(accepted.job_id);
            })
          }
        >
          보관 분석 실행
        </button>
        <ErrorBox error={action.error} />
        {job && (
          <JobPanel
            api={api}
            id={job}
            onDone={(j) => {
              setResult(j);
              state.reload();
            }}
          />
        )}
        {result?.storage_result && (
          <div className="notice">
            <strong>
              {result.storage_result.feasible
                ? "가능한 배치가 있습니다."
                : "실행 가능한 배치가 없습니다."}
            </strong>
            <p>
              {result.storage_result.status} ·{" "}
              {result.storage_result.dry_run ? "미리보기" : "이동 제안 저장"}
            </p>
            {result.storage_result.diagnostics.map((x, i) => (
              <p key={i}>{x}</p>
            ))}
            {result.storage_result.blocked.map((x) => (
              <p key={x.garment_id}>보류: {x.reasons.join(" · ")}</p>
            ))}
            <p>제안 항목 {result.storage_result.proposed_items.length}개</p>
          </div>
        )}
        <Notice>
          현재 DB의 위치·환경 입력만 사용합니다. 새로운 환경 측정이나 자동 장비
          이동을 수행하지 않습니다.
        </Notice>
      </section>
      <div className="block-title">
        <h2>이동 제안과 진행 상황</h2>
        <button onClick={state.reload}>새로고침</button>
      </div>
      <Load state={state}>
        {(data) => (
          <>
            {data.items.length ? (
              <div className="grid two">
                {data.items.map((a) => (
                  <article className="panel" key={a.id}>
                    <Badge>{a.status}</Badge>
                    <h3>보관 이동 · {a.items.length}개 의류</h3>
                    <p>{a.reasoning.slice(0, 2).join(" · ")}</p>
                    <small>{time(a.created_at)}</small>
                    <div className="actions">
                      <button
                        onClick={() =>
                          action.run(async () =>
                            setSelected(
                              await api.get(`/storage-actions/${a.id}`),
                            ),
                          )
                        }
                      >
                        제안 상세 · 이동 확인
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="저장된 이동 제안이 없어요">
                미리보기 옵션을 해제하고 분석하면 가능한 이동 제안을 저장합니다.
              </Empty>
            )}
            <Pager page={data.page} onPage={setOffset} />
          </>
        )}
      </Load>
      {selected && (
        <ActionDetail
          api={api}
          action={selected}
          garments={garments.data || []}
          onClose={() => setSelected(null)}
          onChanged={() => {
            state.reload();
            garments.reload();
            notify("보관 제안 상태를 갱신했어요.");
          }}
        />
      )}
    </>
  );
}
