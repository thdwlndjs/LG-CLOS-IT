import React, { useState } from "react";
import { allGarments, listAll, query } from "../api.js";
import { Calendar } from "../Calendar.jsx";
import { monthBounds } from "../calendar.js";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Load,
  Modal,
  Notice,
  Pager,
  SectionHead,
  Select,
  label,
  localInput,
  time,
  today,
  useAction,
  useLoad,
} from "../ui.jsx";

function Guide({ api, id, onClose }) {
  const state = useLoad(
    (signal) => api.get(`/garments/${id}/care-guide`, { signal }),
    [api, id],
  );
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(null);
  const action = useAction();
  return (
    <Modal title="의류 관리 가이드" onClose={onClose}>
      <Load state={state}>
        {(g) => (
          <>
            <Badge>{g.source}</Badge>
            <h3>{g.care_group}</h3>
            <Notice>
              케어라벨을 우선 확인하세요. 안내는 전문 관리 판단을 대신하지
              않습니다.
            </Notice>
            <ul>
              {g.instructions.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            {g.warnings.map((x, i) => (
              <Notice key={i}>{x}</Notice>
            ))}
            <p>
              세탁기{" "}
              {g.constraints.machine_wash_allowed === null
                ? "미확인"
                : g.constraints.machine_wash_allowed
                  ? "허용"
                  : "금지"}{" "}
              · 건조기{" "}
              {g.constraints.tumble_dry_allowed === null
                ? "미확인"
                : g.constraints.tumble_dry_allowed
                  ? "허용"
                  : "금지"}
            </p>
            {g.constraints.max_wash_temperature_c !== null && (
              <p>최대 세탁 온도 {g.constraints.max_wash_temperature_c}°C</p>
            )}
            {!editing ? (
              <button
                onClick={() => {
                  setEditing(true);
                  setDraft({ ...g, text: g.instructions.join("\n") });
                }}
              >
                관리 프로필 수정
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action.run(async () => {
                    await api.send(
                      `/garments/${id}/care-profile`,
                      {
                        expected_version: g.profile_version,
                        care_group: draft.care_group,
                        special_care: draft.special_care,
                        instructions: draft.text
                          .split("\n")
                          .filter((x) => x.trim()),
                        constraints: draft.constraints,
                      },
                      "PUT",
                    );
                    setEditing(false);
                    state.reload();
                  });
                }}
              >
                <Field label="관리 그룹">
                  <input
                    required
                    value={draft.care_group}
                    onChange={(e) =>
                      setDraft({ ...draft, care_group: e.target.value })
                    }
                  />
                </Field>
                <Field label="관리 지침 (줄마다 한 항목)">
                  <textarea
                    value={draft.text}
                    onChange={(e) =>
                      setDraft({ ...draft, text: e.target.value })
                    }
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.special_care}
                    onChange={(e) =>
                      setDraft({ ...draft, special_care: e.target.checked })
                    }
                  />
                  특별 관리 필요
                </label>
                {[
                  ["machine_wash_allowed", "세탁기"],
                  ["tumble_dry_allowed", "건조기"],
                ].map(([key, title]) => (
                  <Field key={key} label={title}>
                    <Select
                      values={[
                        ["", "미확인"],
                        ["true", "허용"],
                        ["false", "금지"],
                      ]}
                      value={
                        draft.constraints[key] === null
                          ? ""
                          : String(draft.constraints[key])
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          constraints: {
                            ...draft.constraints,
                            [key]:
                              e.target.value === ""
                                ? null
                                : e.target.value === "true",
                          },
                        })
                      }
                    />
                  </Field>
                ))}
                <Field label="최대 세탁 온도 (°C, 비우면 미확인)">
                  <input
                    type="number"
                    min="0"
                    max="95"
                    value={draft.constraints.max_wash_temperature_c ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        constraints: {
                          ...draft.constraints,
                          max_wash_temperature_c:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
                <ErrorBox error={action.error} />
                <button className="primary" disabled={action.busy}>
                  관리 프로필 저장
                </button>
              </form>
            )}
          </>
        )}
      </Load>
    </Modal>
  );
}
function ScheduleForm({ api, schedule, garments, onClose, onSaved }) {
  const [g, setG] = useState(schedule?.garment_id || garments[0]?.id || ""),
    [at, setAt] = useState(localInput(schedule?.scheduled_at)),
    [type, setType] = useState(schedule?.care_type || "WASH"),
    [notes, setNotes] = useState(schedule?.notes || ""),
    [recurrence, setRecurrence] = useState(schedule?.recurrence_days || "");
  const action = useAction();
  return (
    <Modal
      title={schedule ? "케어 일정 수정" : "새 케어 일정"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            const body = {
              scheduled_at: new Date(at).toISOString(),
              care_type: type,
              notes: notes || null,
              recurrence_days: recurrence ? Number(recurrence) : null,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            };
            await api.send(
              schedule ? `/care-schedules/${schedule.id}` : "/care-schedules",
              schedule
                ? {
                    ...body,
                    expected_version: schedule.version,
                    status: "SCHEDULED",
                  }
                : { ...body, garment_id: g },
              schedule ? "PATCH" : "POST",
            );
            onSaved();
          });
        }}
      >
        <Field label="대상 의류">
          <select
            required
            disabled={!!schedule}
            value={g}
            onChange={(e) => setG(e.target.value)}
          >
            <option value="">옷 선택</option>
            {garments.map((x) => (
              <option key={x.id} value={x.id}>
                {label(x.color)} {label(x.category)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="예정 시각">
          <input
            required
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </Field>
        <Field label="관리 종류">
          <Select
            values={["WASH", "DRY", "CLEAN", "INSPECT", "OTHER"]}
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        </Field>
        <Field label="반복 간격 (일, 비우면 한 번)">
          <input
            type="number"
            min="1"
            max="365"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
          />
        </Field>
        <Field label="메모">
          <textarea
            maxLength="1000"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <ErrorBox error={action.error} />
        <button className="primary" disabled={action.busy}>
          일정 저장
        </button>
      </form>
    </Modal>
  );
}
export function Care({ api, navigate, notify, garmentId }) {
  const [offset, setOffset] = useState(0),
    [guide, setGuide] = useState(garmentId || null),
    [form, setForm] = useState(null),
    [operation, setOperation] = useState(null),
    [reason, setReason] = useState(""),
    [completedAt, setCompletedAt] = useState("");
  const action = useAction();
  const garments = useLoad((signal) => allGarments(api, signal), [api]);
  const schedules = useLoad(
    (signal) =>
      api.get(
        "/care-schedules?" +
          query({
            limit: 12,
            offset,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        { signal },
      ),
    [api, offset],
  );
  const perform = () =>
    action.run(async () => {
      const { schedule: s, kind } = operation;
      if (kind === "cancel")
        await api.send(
          `/care-schedules/${s.id}`,
          {
            expected_version: s.version,
            scheduled_at: s.scheduled_at,
            care_type: s.care_type,
            status: "CANCELLED",
            notes: s.notes,
            recurrence_days: s.recurrence_days,
            timezone: s.timezone,
          },
          "PATCH",
        );
      else if (kind === "undo")
        await api.send(`/care-schedules/${s.id}/completion/cancel`, {
          expected_version: s.version,
          reason,
        });
      else
        await api.send(`/care-schedules/${s.id}/complete`, {
          expected_version: s.version,
          completed_at: completedAt
            ? new Date(completedAt).toISOString()
            : new Date().toISOString(),
          outcome: kind === "done" ? "SUCCESS" : "NOT_DONE",
          notes: reason || null,
        });
      setOperation(null);
      schedules.reload();
      notify("케어 기록을 반영했어요.");
    });
  return (
    <>
      <SectionHead
        eyebrow="CARE FOR WHAT YOU LOVE"
        title="오래도록, 좋은 상태로."
      >
        <button onClick={() => navigate("storage")}>보관 최적화</button>
        <button
          className="primary"
          disabled={!garments.data?.length}
          onClick={() => setForm({})}
        >
          ＋ 케어 일정
        </button>
      </SectionHead>
      <section className="panel guide-banner">
        <div>
          <span className="eyebrow">GARMENT CARE GUIDE</span>
          <h2>옷에 맞는 관리, 라벨부터.</h2>
          <p>관리 지침과 사용자 프로필을 확인하세요.</p>
        </div>
        <Load state={garments}>
          {(items) => (
            <Field label="관리 가이드 대상">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setGuide(e.target.value);
                }}
              >
                <option value="">옷을 선택해주세요</option>
                {items.map((g) => (
                  <option key={g.id} value={g.id}>
                    {label(g.color)} {label(g.category)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Load>
      </section>
      <div className="block-title">
        <h2>관리 일정</h2>
        <button onClick={schedules.reload}>새로고침</button>
      </div>
      <Load state={schedules}>
        {(data) => (
          <>
            {data.items.length ? (
              <div className="schedule-list">
                {data.items.map((s) => (
                  <article className="panel schedule" key={s.id}>
                    <div className="schedule-icon">✳</div>
                    <div className="grow">
                      <Badge>{s.status}</Badge>
                      <h3>
                        {label(s.care_type)} ·{" "}
                        {garments.data?.find((g) => g.id === s.garment_id)
                          ? `${label(garments.data.find((g) => g.id === s.garment_id).color)} ${label(garments.data.find((g) => g.id === s.garment_id).category)}`
                          : "접근 가능한 의류"}
                      </h3>
                      <p>
                        {time(s.scheduled_at)}
                        {s.recurrence_days && ` · ${s.recurrence_days}일 반복`}
                      </p>
                      <p>{s.notes}</p>
                      {s.next_due_at && (
                        <small>다음 일정 {time(s.next_due_at)}</small>
                      )}
                    </div>
                    <div className="actions wrap">
                      {["SCHEDULED", "OVERDUE"].includes(s.status) && (
                        <>
                          <button
                            className="primary"
                            onClick={() => {
                              setReason("");
                              setCompletedAt("");
                              setOperation({ schedule: s, kind: "done" });
                            }}
                          >
                            수행 완료
                          </button>
                          <button
                            onClick={() => {
                              setReason("");
                              setCompletedAt("");
                              setOperation({ schedule: s, kind: "notdone" });
                            }}
                          >
                            미수행
                          </button>
                          <button onClick={() => setForm(s)}>수정</button>
                          <button
                            onClick={() =>
                              setOperation({ schedule: s, kind: "cancel" })
                            }
                          >
                            일정 취소
                          </button>
                        </>
                      )}
                      {s.status === "COMPLETED" && (
                        <button
                          onClick={() => {
                            setReason("");
                            setOperation({ schedule: s, kind: "undo" });
                          }}
                        >
                          완료 취소
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="예정된 관리가 없어요">
                세탁·건조·점검 일정을 등록해보세요.
              </Empty>
            )}
            <Pager page={data.page} onPage={setOffset} />
          </>
        )}
      </Load>
      {guide && <Guide api={api} id={guide} onClose={() => setGuide(null)} />}{" "}
      {form && garments.data && (
        <ScheduleForm
          api={api}
          garments={garments.data}
          schedule={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            schedules.reload();
          }}
        />
      )}
      {operation && (
        <Modal
          title={
            {
              done: "케어 수행 확인",
              notdone: "미수행 기록",
              cancel: "일정 취소",
              undo: "완료 취소",
            }[operation.kind]
          }
          onClose={() => setOperation(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              perform();
            }}
          >
            <p>
              실제로 수행한 결과를 기록해주세요. 이력은 삭제하지 않고
              보존합니다.
            </p>
            {["done", "notdone"].includes(operation.kind) && (
              <Field label="수행 시각 (비우면 확인 시점)">
                <input
                  type="datetime-local"
                  max={localInput()}
                  value={completedAt}
                  onChange={(e) => setCompletedAt(e.target.value)}
                />
              </Field>
            )}
            {operation.kind !== "cancel" && (
              <Field label={operation.kind === "undo" ? "취소 사유" : "메모"}>
                <textarea
                  required={operation.kind === "undo"}
                  maxLength="500"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            )}
            <ErrorBox error={action.error} />
            <button className="primary" disabled={action.busy}>
              기록 확인
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function History({ api, member, navigate, notify }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [from, setFrom] = useState(today().slice(0, 8) + "01"),
    [to, setTo] = useState(today()),
    [kind, setKind] = useState(""),
    [offset, setOffset] = useState(0),
    [wearForm, setWearForm] = useState(false),
    [selected, setSelected] = useState(""),
    [worn, setWorn] = useState(localInput()),
    [cancel, setCancel] = useState(null),
    [reason, setReason] = useState("");
  const action = useAction();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const state = useLoad(
    (signal) =>
      api.get(
        "/history?" + query({ from, to, kind, timezone, limit: 20, offset }),
        { signal },
      ),
    [api, from, to, kind, offset],
  );
  const outfits = useLoad(
    async (signal) => ({
      items: await listAll(api, "/outfits", { status: "SAVED" }, signal),
    }),
    [api, wearForm],
  );
  const monthHistory = useLoad(
    (signal) =>
      listAll(
        api,
        "/history",
        { ...monthBounds(month), leading: undefined, kind, timezone },
        signal,
      ),
    [api, month, kind],
  );
  return (
    <>
      <SectionHead eyebrow="A RECORD OF YOUR DAYS" title="옷과 함께한 날들.">
        <button onClick={state.reload}>새로고침</button>
        <button
          className="primary"
          onClick={() => {
            setWearForm(true);
            setWorn(localInput());
          }}
        >
          실제 착용 기록
        </button>
      </SectionHead>
      <Notice>
        코디 선택·입어보기 종료·카드 저장은 실제 착용이 아닙니다. 실제 입은
        경우에만 별도로 확인해주세요.
      </Notice>
      <Calendar
        month={month}
        onMonth={(value) => {
          setMonth(value);
          const range = monthBounds(value);
          setFrom(range.from);
          setTo(range.to);
          setOffset(0);
        }}
        items={monthHistory.data || []}
        from={from}
        to={to}
        onDay={(day) => {
          setFrom(day);
          setTo(day);
          setOffset(0);
        }}
        onAll={() => {
          const range = monthBounds(month);
          setFrom(range.from);
          setTo(range.to);
          setOffset(0);
        }}
      />
      <ErrorBox error={monthHistory.error} retry={monthHistory.reload} />
      <div className="filters">
        <Field label="시작일">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Field label="종료일">
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Field label="이력 종류">
          <Select
            values={["", "WEAR", "CARE", "OUTFIT_SELECTION"].map((x) => [
              x,
              x ? label(x) : "전체 이력",
            ])}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
      </div>
      <Load state={state}>
        {(data) => (
          <>
            {data.items.length ? (
              <div className="timeline">
                {data.items.map((x) => (
                  <article className="panel timeline-item" key={x.id}>
                    <div className="timeline-date">
                      {x.local_date}
                      <small>{time(x.occurred_at)}</small>
                    </div>
                    <div className="grow">
                      <Badge>{x.kind}</Badge> <Badge>{x.status}</Badge>
                      <h3>{x.description}</h3>
                      {x.items_snapshot && (
                        <p>
                          {x.items_snapshot
                            .map((i) => label(i.slot))
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="actions">
                      {x.outfit_id && x.status !== "CANCELLED" && (
                        <button
                          onClick={() =>
                            navigate("tryon", {
                              outfitId: x.outfit_id,
                              source: "CALENDAR",
                            })
                          }
                        >
                          코디 불러오기
                        </button>
                      )}
                      {x.kind === "WEAR" && x.status === "CONFIRMED" && (
                        <button
                          onClick={() => {
                            setCancel(x);
                            setReason("");
                          }}
                        >
                          착용 취소
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="이 기간의 기록이 없어요">
                날짜와 이력 종류를 변경하거나 실제 착용을 기록해주세요.
              </Empty>
            )}
            <Pager page={data.page} onPage={setOffset} />
          </>
        )}
      </Load>
      {wearForm && (
        <Modal title="실제 착용 확인" onClose={() => setWearForm(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.run(async () => {
                await api.send("/wear-confirmations", {
                  member_id: member.id,
                  outfit_id: selected,
                  worn_at: new Date(worn).toISOString(),
                  confirmation_method: "USER",
                });
                setWearForm(false);
                state.reload();
                monthHistory.reload();
                notify("실제 착용을 기록했어요.");
              });
            }}
          >
            <Load state={outfits}>
              {(data) => (
                <Field label="실제로 입은 코디">
                  <select
                    required
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">코디 선택</option>
                    {data.items.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </Load>
            <Field label="착용 시각">
              <input
                required
                type="datetime-local"
                max={localInput()}
                value={worn}
                onChange={(e) => setWorn(e.target.value)}
              />
            </Field>
            <Notice>실제 옷을 입었음을 확인하면 착용 이력에 기록합니다.</Notice>
            <ErrorBox error={action.error} />
            <button className="primary" disabled={action.busy}>
              실제 착용 확인
            </button>
          </form>
        </Modal>
      )}
      {cancel && (
        <Modal title="착용 기록 취소" onClose={() => setCancel(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.run(async () => {
                await api.send(`/wear-confirmations/${cancel.id}/cancel`, {
                  expected_version: 1,
                  reason,
                });
                setCancel(null);
                state.reload();
                monthHistory.reload();
              });
            }}
          >
            <Notice>
              취소 이력은 보존됩니다. 이미 변경된 기록은 충돌로 거부됩니다.
            </Notice>
            <Field label="취소 사유">
              <textarea
                required
                maxLength="500"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <ErrorBox error={action.error} />
            <button className="primary" disabled={action.busy}>
              취소 확인
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Settings({ api, member, notify }) {
  const state = useLoad((signal) => api.get("/settings", { signal }), [api]);
  const history = useLoad(
    (signal) => api.get("/settings/consent-history", { signal }),
    [api],
  );
  const [draft, setDraft] = useState(null);
  const action = useAction();
  return (
    <>
      <SectionHead eyebrow="MADE PERSONAL" title="나에게 맞추는 옷장." />
      <Load state={state}>
        {(settings) => {
          const form = draft || settings;
          return (
            <div className="grid two">
              <section className="panel">
                <div className="profile-heading">
                  <span className="avatar">{member.display_name[0]}</span>
                  <div>
                    <h2>{member.display_name}</h2>
                    <p>로컬 데모 프로필</p>
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    action.run(async () => {
                      await api.send("/settings", form, "PUT");
                      setDraft(null);
                      state.reload();
                      history.reload();
                      notify("설정을 저장했어요.");
                    });
                  }}
                >
                  <Field label="시간대">
                    <Select
                      values={[
                        "Asia/Seoul",
                        "UTC",
                        "America/New_York",
                        "Europe/London",
                        "Asia/Tokyo",
                      ]}
                      value={form.timezone}
                      onChange={(e) =>
                        setDraft({ ...form, timezone: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="단위">
                    <Select
                      values={[
                        ["METRIC", "미터법"],
                        ["IMPERIAL", "야드·파운드법"],
                      ]}
                      value={form.units}
                      onChange={(e) =>
                        setDraft({ ...form, units: e.target.value })
                      }
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={form.notifications_enabled}
                      onChange={(e) =>
                        setDraft({
                          ...form,
                          notifications_enabled: e.target.checked,
                        })
                      }
                    />
                    알림 설정
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={form.calendar_enabled}
                      onChange={(e) =>
                        setDraft({
                          ...form,
                          calendar_enabled: e.target.checked,
                        })
                      }
                    />
                    일정 Context 사용 (Mock)
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={form.image_upload_consent}
                      onChange={(e) =>
                        setDraft({
                          ...form,
                          image_upload_consent: e.target.checked,
                        })
                      }
                    />
                    사진 업로드 및 사용 동의
                  </label>
                  <Notice>
                    동의 철회 시 사진 접근·공유를 철회하고 정리 작업을
                    예약합니다. 다시 동의해도 이전 사진이 자동 복구되지
                    않습니다.
                  </Notice>
                  <ErrorBox error={action.error} />
                  <button className="primary" disabled={action.busy}>
                    설정 저장
                  </button>
                </form>
              </section>
              <div>
                <section className="panel">
                  <span className="eyebrow">CONNECTED SERVICES</span>
                  <h2>외부 서비스 연결</h2>
                  {[
                    ["가상 착용", "Mock · 실제 Decart 미연동"],
                    ["날씨", "Mock · 실제 날씨 미연동"],
                    ["캘린더", "Mock · 외부 캘린더 미연동"],
                    ["의류 관측", "명시적 Mock · 실제 센서 미연동"],
                  ].map(([name, status]) => (
                    <div className="list-row" key={name}>
                      <strong>{name}</strong>
                      <span>{status}</span>
                    </div>
                  ))}
                  <Notice>
                    직접 QA 이후 선택 연동을 진행합니다. 이 화면에서 유료 API를
                    활성화하지 않습니다.
                  </Notice>
                </section>
                <section className="panel consent">
                  <h3>사진 동의 이력</h3>
                  <Load state={history}>
                    {(data) =>
                      data.items.length ? (
                        data.items.map((x) => (
                          <div className="list-row" key={x.id}>
                            <span>
                              {x.granted ? "동의" : "철회"} · 정책{" "}
                              {x.policy_version}
                            </span>
                            <small>{time(x.changed_at)}</small>
                          </div>
                        ))
                      ) : (
                        <p className="muted">동의 변경 이력이 없습니다.</p>
                      )
                    }
                  </Load>
                </section>
              </div>
            </div>
          );
        }}
      </Load>
    </>
  );
}
