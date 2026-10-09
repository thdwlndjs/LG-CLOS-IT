import React from "react";
import { allGarments } from "../api.js";
import { reasonText } from "../demo.js";
import {
  Badge,
  Empty,
  ErrorBox,
  Load,
  Notice,
  Photo,
  SectionHead,
  time,
  useAction,
  useLoad,
} from "../ui.jsx";

export function Home({ api, member, navigate, notify }) {
  const garments = useLoad((signal) => allGarments(api, signal), [api]);
  const state = useLoad((signal) => api.get("/home", { signal }), [api]);
  const action = useAction();
  const recommend = () =>
    action.run(async () => {
      const context = await api.send("/context-snapshots", {
        member_id: member.id,
        timezone:
          state.data?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        mode: "MOCK",
      });
      const result = await api.send("/outfit-recommendations", {
        member_id: member.id,
        context_snapshot_id: context.id,
        limit: 3,
      });
      notify(
        result.candidates.length
          ? "오늘의 추천을 준비했어요."
          : "사용 가능한 의류 조합이 부족합니다. 옷장을 확인해주세요.",
      );
      state.reload();
    });
  return (
    <>
      <SectionHead
        eyebrow="YOUR EVERYDAY, REIMAGINED"
        title="오늘, 무엇을 입을까요?"
      >
        <button onClick={state.reload}>새로고침</button>
        <button className="primary" disabled={action.busy} onClick={recommend}>
          {action.busy ? "추천 준비 중…" : "오늘의 코디 추천 ↗"}
        </button>
      </SectionHead>
      <ErrorBox error={action.error} />
      <Load state={state}>
        {(home) => (
          <>
            <div className="home-grid">
              <section className="hero">
                <div>
                  <span className="eyebrow">TODAY’S MOOD</span>
                  <h2>
                    나다운 하루를 위한
                    <br />
                    작은 선택.
                  </h2>
                  <p>
                    옷장 속 아이템에서 시작하는
                    <br />
                    오늘의 코디를 만나보세요.
                  </p>
                  <button onClick={() => navigate("outfits")}>
                    직접 코디 만들기 →
                  </button>
                </div>
                <div className="hero-art">
                  <Photo category="TOP" />
                  <Photo category="BOTTOM" />
                  <span className="hero-sticker">
                    MAKE IT
                    <br />
                    YOURS.
                  </span>
                </div>
              </section>
              <section className="panel context">
                <span className="eyebrow">TODAY’S CONTEXT</span>
                <h3>오늘의 컨디션</h3>
                {home.today_context ? (
                  <>
                    <div className="weather">
                      ☁{" "}
                      <strong>
                        {home.today_context.weather.temperature_c ?? "—"}
                        <small>°C</small>
                      </strong>
                    </div>
                    <p>
                      {home.today_context.location_label || "위치 미확인"} ·{" "}
                      {home.today_context.weather.condition || "날씨 미확인"}
                    </p>
                    <Badge kind="orange">
                      {home.today_context.source_mode}
                    </Badge>
                    <p className="fine">
                      기상·일정은 실제 연결 정보가 아닙니다.
                    </p>
                    <p className="fine">
                      수집 {time(home.today_context.captured_at)}
                    </p>
                    {home.today_context.missing_fields.length > 0 && (
                      <Notice>일부 Context 항목이 없습니다.</Notice>
                    )}
                  </>
                ) : (
                  <Empty title="아직 Context가 없어요">
                    추천을 실행하면 명시적인 Mock Context를 생성합니다.
                  </Empty>
                )}
              </section>
            </div>
            {home.partial && (
              <Notice>
                일부 데이터가 없거나 오래됐습니다. 아래 소스 상태를
                확인해주세요.
              </Notice>
            )}
            <div className="source-row">
              {Object.entries(home.source_status).map(([k, v]) => (
                <span key={k}>
                  {{
                    context: "Context",
                    recommendations: "추천",
                    care: "케어",
                    storage: "보관",
                  }[k] || k}{" "}
                  <Badge>{v}</Badge>
                </span>
              ))}
            </div>
            <div className="block-title">
              <h2>오늘의 추천 코디</h2>
              <button
                className="text-button"
                onClick={() => navigate("outfits")}
              >
                내 코디 전체 보기 →
              </button>
            </div>
            {home.today_outfits.length ? (
              <div className="grid three">
                {home.today_outfits.map((candidate, i) => (
                  <article
                    className="panel look-card"
                    key={candidate.outfit.id}
                  >
                    <div className="look-preview">
                      <span className="look-number">0{i + 1}</span>
                      {candidate.outfit.items.slice(0, 3).map((item) => (
                        <Photo
                          key={item.garment_id}
                          category={item.slot}
                          asset={
                            garments.data?.find((g) => g.id === item.garment_id)
                              ?.image
                          }
                        />
                      ))}
                    </div>
                    <h3>{candidate.outfit.title}</h3>
                    <p>{candidate.reasons.map(reasonText).join(" · ")}</p>
                    <div className="row">
                      <Badge>점수 {candidate.score.toFixed(1)}</Badge>
                      <button
                        onClick={() =>
                          navigate("tryon", {
                            outfitId: candidate.outfit.id,
                            contextId: home.today_context?.id,
                            source: "HOME",
                          })
                        }
                      >
                        입어보기 →
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="오늘의 추천을 기다리고 있어요">
                위의 ‘오늘의 코디 추천’으로 옷장에 맞는 조합을 만들어보세요.
              </Empty>
            )}
            <div className="grid two home-bottom">
              <section className="panel">
                <div className="block-title">
                  <h3>잊지 말아야 할 케어</h3>
                  <button
                    className="text-button"
                    onClick={() => navigate("care")}
                  >
                    보기 →
                  </button>
                </div>
                {home.care_alerts.length ? (
                  home.care_alerts.map((s) => (
                    <div className="list-row" key={s.id}>
                      <span>
                        {s.care_type} · {time(s.scheduled_at)}
                      </span>
                      <Badge>{s.status}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="muted">오늘 예정된 케어가 없어요.</p>
                )}
              </section>
              <section className="panel">
                <div className="block-title">
                  <h3>옷장 정리 알림</h3>
                  <button
                    className="text-button"
                    onClick={() => navigate("storage")}
                  >
                    보관 제안 →
                  </button>
                </div>
                {home.storage_alerts.length ? (
                  home.storage_alerts.map((a) => (
                    <div className="list-row" key={a.id}>
                      <span>이동 제안 · {a.items.length}개 의류</span>
                      <Badge>{a.status}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="muted">진행 중인 보관 제안이 없어요.</p>
                )}
              </section>
            </div>
            <p className="fine">마지막 집계 {time(home.updated_at)}</p>
          </>
        )}
      </Load>
    </>
  );
}
