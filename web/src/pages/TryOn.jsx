import React, { useState } from "react";
import { allGarments, assetUrl, query, upload } from "../api.js";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  JobPanel,
  Load,
  Notice,
  Pager,
  Photo,
  SectionHead,
  label,
  useAction,
  useLoad,
} from "../ui.jsx";
import { SlotPicker } from "./Outfits.jsx";

export function TryOn({ api, member, navigate, notify, entry }) {
  const [session, setSession] = useState(null),
    [person, setPerson] = useState(null),
    [jobId, setJobId] = useState(null),
    [result, setResult] = useState(null),
    [items, setItems] = useState(null),
    [wear, setWear] = useState(false);
  const action = useAction();
  const garments = useLoad((signal) => allGarments(api, signal), [api]);
  const create = () =>
    action.run(async () => {
      const value = await api.send("/vton-sessions", {
        member_id: member.id,
        source_screen: entry.source || "OTHER",
        outfit_id: entry.outfitId || null,
        garment_id: entry.garmentId || null,
        context_snapshot_id: entry.contextId || null,
        person_asset_id: person?.asset_id || null,
      });
      setSession(value);
      setItems(value.items);
    });
  const done = async (job) => {
    setResult(job);
    if (job.status === "SUCCEEDED")
      try {
        const updated = await api.get(`/vton-sessions/${session.id}`);
        setSession(updated);
      } catch {
        /* Refresh button retains recoverable state. */
      }
  };
  return (
    <>
      <SectionHead eyebrow="YOUR LOOK, YOUR CHOICE" title="공통 입어보기">
        <button onClick={() => navigate("outfits")}>내 코디로 돌아가기</button>
      </SectionHead>
      <Notice>
        Mock 가상 착용입니다. 생성 결과는 안내 이미지이며 실제 인물·의류 합성
        품질을 표현하지 않습니다.
      </Notice>
      <ErrorBox error={action.error} />
      <div className="tryon-grid">
        <section className="panel tryon-preview">
          <Badge kind="orange">Mock VTON</Badge>
          {result?.result_asset && !result.stale && result.is_current ? (
            <img
              className="result-image"
              src={assetUrl(result.result_asset.read_url)}
              alt="Mock 가상 착용 안내 결과"
            />
          ) : (
            <div className="mirror-placeholder">
              <span>◇</span>
              <h2>내 코디를 확인해보세요.</h2>
              <p>
                인물과 의류 사진을 등록하면
                <br />
                Mock 작업 흐름을 확인할 수 있어요.
              </p>
            </div>
          )}
          {jobId && <JobPanel api={api} id={jobId} onDone={done} />}
        </section>
        <section className="panel">
          <span className="eyebrow">LOOK DETAILS</span>
          <h2>
            {session?.status === "ENDED"
              ? "최종 코디를 선택했어요."
              : "입어볼 구성을 선택하세요."}
          </h2>
          {!session ? (
            <>
              <p>선택한 코디 또는 의류를 독립된 편집 초안으로 가져옵니다.</p>
              <button
                className="primary wide"
                disabled={action.busy}
                onClick={create}
              >
                입어보기 시작
              </button>
            </>
          ) : (
            <>
              <div className="row">
                <Badge>{session.status}</Badge>
                <small>구성 버전 {session.revision}</small>
              </div>
              <Load state={garments}>
                {(data) =>
                  session.status === "ENDED" ? (
                    <div className="selected-items">
                      {session.items.map((x) => (
                        <span key={x.garment_id}>
                          {label(x.slot)} ·{" "}
                          {label(
                            data.find((g) => g.id === x.garment_id)?.color ||
                              "",
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <>
                      <SlotPicker
                        items={items || session.items}
                        garments={data}
                        onChange={setItems}
                      />
                      <button
                        disabled={
                          action.busy ||
                          (!!jobId && !result) ||
                          JSON.stringify(items) ===
                            JSON.stringify(session.items)
                        }
                        onClick={() =>
                          action.run(async () => {
                            const value = await api.send(
                              `/vton-sessions/${session.id}/outfit`,
                              { items, expected_revision: session.revision },
                              "PATCH",
                            );
                            setSession(value);
                            setResult(null);
                            setJobId(null);
                            notify(
                              "입어보기 구성을 변경했어요. 이전 결과는 사용하지 않습니다.",
                            );
                          })
                        }
                      >
                        의류 구성 반영
                      </button>
                    </>
                  )
                }
              </Load>
              {session.status !== "ENDED" && (
                <>
                  <Field label="인물 사진 (PNG·JPEG·WebP, 10MB 이하)">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={action.busy}
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file)
                          action.run(async () => {
                            setPerson(await upload(api, file, "PERSON_VTON"));
                            notify("인물 사진을 업로드했어요.");
                          });
                      }}
                    />
                  </Field>
                  <p className="fine">
                    사진 업로드는 마이의 동의가 필요합니다. 변경한 의류 구성은
                    먼저 반영해주세요.
                  </p>
                  {person && <Badge>인물 사진 준비됨</Badge>}
                  {session.unavailable_reasons.length > 0 && (
                    <Notice>
                      기존 구성 제한: {session.unavailable_reasons.join(" · ")}.
                      사진 없는 의류는 옷장 상세에서 사진을 등록한 뒤
                      새로고침해주세요.
                    </Notice>
                  )}
                  <div className="actions wrap">
                    <button
                      onClick={() =>
                        action.run(async () => {
                          const updated = await api.get(
                            `/vton-sessions/${session.id}`,
                          );
                          setSession(updated);
                          setItems(updated.items);
                        })
                      }
                    >
                      구성 새로고침
                    </button>
                    <button
                      className="primary"
                      disabled={
                        action.busy ||
                        !person ||
                        (!!jobId && !result) ||
                        JSON.stringify(items) !== JSON.stringify(session.items)
                      }
                      onClick={() =>
                        action.run(async () => {
                          const accepted = await api.send("/vton-jobs", {
                            session_id: session.id,
                            expected_revision: session.revision,
                            person_asset_id: person.asset_id,
                            outfit_id: session.outfit_id,
                            provider: "MOCK",
                          });
                          setResult(null);
                          setJobId(accepted.job_id);
                        })
                      }
                    >
                      Mock 입어보기 실행
                    </button>
                  </div>
                  <div className="divider" />
                  <p>
                    이 구성을 최종 선택할까요? 선택만으로 실제 착용이 기록되지는
                    않습니다.
                  </p>
                  <button
                    className="primary wide"
                    disabled={
                      action.busy ||
                      (!!jobId && !result) ||
                      JSON.stringify(items) !== JSON.stringify(session.items)
                    }
                    onClick={() =>
                      action.run(async () => {
                        setSession(
                          await api.send(`/vton-sessions/${session.id}/end`, {
                            expected_revision: session.revision,
                            final_outfit_id: session.outfit_id,
                            save_outfit: true,
                          }),
                        );
                        notify(
                          "최종 코디를 선택했어요. 실제 착용 기록은 별도 확인이 필요해요.",
                        );
                      })
                    }
                  >
                    최종 코디 선택 · 세션 종료
                  </button>
                </>
              )}
              {session.status === "ENDED" && (
                <>
                  <Notice>
                    코디 선택 완료 · 실제 착용은 아직 기록하지 않았습니다.
                  </Notice>
                  <div className="actions wrap">
                    <button
                      className="primary"
                      onClick={() =>
                        navigate("cards", {
                          outfitId: session.final_outfit_id,
                          contextId: session.context_snapshot_id,
                        })
                      }
                    >
                      코디카드 만들기
                    </button>
                    <button
                      disabled={wear || action.busy}
                      onClick={() =>
                        action.run(async () => {
                          if (
                            !window.confirm(
                              "이 코디를 실제로 입었나요? 확인하면 착용 기록을 생성합니다.",
                            )
                          )
                            return;
                          await api.send("/wear-confirmations", {
                            member_id: member.id,
                            outfit_id: session.final_outfit_id,
                            session_id: session.id,
                            context_snapshot_id: session.context_snapshot_id,
                            worn_at: new Date().toISOString(),
                            confirmation_method: "USER",
                          });
                          setWear(true);
                          notify(
                            "실제 착용을 확인했어요. 캘린더에서 확인할 수 있어요.",
                          );
                        })
                      }
                    >
                      {wear ? "실제 착용 기록됨" : "별도 실제 착용 확인"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
function CardDetail({ api, card, onChange, navigate, notify }) {
  const [job, setJob] = useState(null),
    [title, setTitle] = useState(card.saved_title || card.data.title),
    [share, setShare] = useState(false),
    [reuse, setReuse] = useState(false);
  const action = useAction();
  const save = (visibility) =>
    action.run(async () => {
      const updated = await api.send(`/cards/${card.id}/save`, {
        title,
        visibility,
        reuse_outfit: reuse,
      });
      onChange(updated);
      notify(
        visibility === "SHAREABLE"
          ? "24시간 공유 링크를 만들었어요."
          : "카드를 비공개로 저장했어요.",
      );
    });
  return (
    <section className="panel card-detail">
      <ErrorBox error={action.error} />
      <div className="grid two">
        <div>
          {card.image_asset ? (
            <img
              className="card-image"
              src={assetUrl(card.image_asset.read_url)}
              alt="생성된 코디카드"
            />
          ) : (
            <div className="card-placeholder">
              <span className="eyebrow">WARDROBE° / LOOK CARD</span>
              <h2>{card.data.title}</h2>
              <p>{card.data.weather_label || "Context 없음"}</p>
              <div className="look-preview">
                {card.data.items.slice(0, 3).map((x) => (
                  <Photo key={x.garment_id} category={x.slot} />
                ))}
              </div>
              <p className="fine">미리보기 · 아직 생성된 이미지가 아닙니다.</p>
            </div>
          )}
        </div>
        <div>
          <Badge>{card.status}</Badge>
          <h2>하루의 코디를 한 장에.</h2>
          <p>1080 × 1350 · 고정 템플릿</p>
          <button
            className="primary"
            disabled={
              action.busy ||
              ["QUEUED", "RUNNING"].includes(card.status) ||
              (!!job && !["READY", "FAILED", "SAVED"].includes(card.status))
            }
            onClick={() =>
              action.run(async () => {
                const accepted = await api.send("/card-render-jobs", {
                  card_id: card.id,
                  output_format: "PNG",
                  width: 1080,
                  height: 1350,
                });
                setJob(accepted.job_id);
                onChange({ ...card, status: "QUEUED" });
              })
            }
          >
            {card.image_asset ? "카드 다시 생성" : "카드 이미지 생성"}
          </button>
          {job && (
            <JobPanel
              api={api}
              id={job}
              onDone={async () => {
                try {
                  onChange(await api.get(`/cards/${card.id}`));
                } catch (e) {
                  notify("카드 상태를 새로고침해주세요.");
                }
              }}
            />
          )}
          <div className="divider" />
          <Field label="카드 제목">
            <input
              value={title}
              maxLength="200"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={reuse}
              onChange={(e) => setReuse(e.target.checked)}
            />
            저장 코디로 연결해 다시 사용하기
          </label>
          <button
            disabled={
              action.busy ||
              !card.image_asset ||
              !["READY", "SAVED"].includes(card.status)
            }
            onClick={() => save("PRIVATE")}
          >
            비공개 저장 · 기존 공유 폐기
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
            />
            카드의 제목·의류·날씨 등 표시 정보 공유에 동의
          </label>
          <button
            disabled={
              !share ||
              action.busy ||
              !card.image_asset ||
              !["READY", "SAVED"].includes(card.status)
            }
            onClick={() => save("SHAREABLE")}
          >
            24시간 공유 링크 생성
          </button>
          {card.share_url && (
            <div className="notice">
              <p>공유 항목: {card.shared_fields.join(" · ")}</p>
              <p>
                만료 {new Date(card.share_expires_at).toLocaleString("ko-KR")}
              </p>
              <button
                onClick={() =>
                  action.run(async () => {
                    await navigator.clipboard.writeText(
                      new URL(assetUrl(card.share_url), window.location.origin)
                        .href,
                    );
                    notify(
                      "공유 링크를 복사했어요. 링크를 가진 사람은 카드 정보를 볼 수 있어요.",
                    );
                  })
                }
              >
                공유 링크 복사
              </button>
            </div>
          )}
          {card.linked_outfit_id && (
            <button
              onClick={() =>
                navigate("tryon", {
                  outfitId: card.linked_outfit_id,
                  source: "MY_OUTFITS",
                })
              }
            >
              저장 코디 다시 입어보기 →
            </button>
          )}
          <Notice>
            카드 저장·공유는 착용 확인이 아닙니다. 사진 동의 철회 시 이미지와
            공유 접근이 철회됩니다.
          </Notice>
        </div>
      </div>
    </section>
  );
}
export function Cards({ api, navigate, notify, outfitId, contextId }) {
  const [selected, setSelected] = useState(null),
    [offset, setOffset] = useState(0);
  const action = useAction();
  const state = useLoad(
    (signal) => api.get("/cards?" + query({ limit: 12, offset }), { signal }),
    [api, offset],
  );
  return (
    <>
      <SectionHead eyebrow="A LOOK TO REMEMBER" title="코디카드 보관함">
        <button onClick={state.reload}>새로고침</button>
        <button onClick={() => navigate("outfits")}>내 코디</button>
        {outfitId && (
          <button
            className="primary"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                setSelected(
                  await api.send("/cards/drafts", {
                    outfit_id: outfitId,
                    context_snapshot_id: contextId || null,
                    template_id: "minimal-v1",
                  }),
                );
                state.reload();
              })
            }
          >
            선택 코디로 카드 초안 만들기
          </button>
        )}
      </SectionHead>
      <ErrorBox error={action.error} />
      {selected && (
        <>
          <button className="text-button" onClick={() => setSelected(null)}>
            ← 카드 목록
          </button>
          <CardDetail
            key={selected.id}
            api={api}
            card={selected}
            navigate={navigate}
            notify={notify}
            onChange={(card) => {
              setSelected(card);
              state.reload();
            }}
          />
        </>
      )}
      <Load state={state}>
        {(data) => (
          <>
            {data.items.length ? (
              <div className="grid three card-list">
                {data.items.map((c) => (
                  <button
                    className="panel"
                    key={c.id}
                    onClick={() =>
                      action.run(async () =>
                        setSelected(await api.get(`/cards/${c.id}`)),
                      )
                    }
                  >
                    {c.image_asset ? (
                      <img
                        className="card-thumbnail"
                        src={assetUrl(c.image_asset.read_url)}
                        alt="코디카드 썸네일"
                      />
                    ) : (
                      <div className="thumbnail-empty">
                        ◇<p>아직 이미지 없음</p>
                      </div>
                    )}
                    <Badge>{c.status}</Badge>
                    <h3>{c.saved_title || c.data.title}</h3>
                    <small>
                      {c.is_saved ? "내 카드로 저장됨" : "작업 초안"}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              !selected && (
                <Empty title="아직 코디카드가 없어요">
                  내 코디 또는 최종 선택 화면에서 카드 만들기를 시작해보세요.
                </Empty>
              )
            )}
            <Pager page={data.page} onPage={setOffset} />
          </>
        )}
      </Load>
    </>
  );
}
