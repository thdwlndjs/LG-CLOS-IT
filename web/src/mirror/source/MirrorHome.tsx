import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DemoApp } from "./core/app";
import type { Outfit } from "./core/types";
import { outfitAssetRefs } from "./core/outfitAssets";
import { currentMember } from "./integrations/backendClient";
import { useToday } from "./ScenarioControls";
import { type MirrorWeatherContext } from "./mirrorPanelData";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
import { confirmedHomeUsage, winterHomeScenario } from "./homeRecommendations";
import {
  homeServerStorageAdvice,
  todayServerRecommendation,
} from "./homeServerActions";
import "./mirror-panels.css";

export function MirrorHome({
  app,
  onOpenOutfit,
}: {
  app: DemoApp;
  onOpenOutfit: (outfit: Outfit) => void;
  weather?: MirrorWeatherContext;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getState),
    today = useToday(),
    owner = state.activeProfileId,
    repository = app.repository;
  const garments = app.garments(),
    profile = state.profiles.find((p) => p.id === owner);
  const [scenario, setScenario] = useState(
    import.meta.env.VITE_HOME_DEMO_SCENARIO !== "off",
  );
  const [candidates, setCandidates] = useState<
    { outfit: Outfit; reasons: string[] }[]
  >([]);
  const [storage, setStorage] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0),
    sending = useRef(false);
  useEffect(() => {
    generation.current++;
    sending.current = false;
    setBusy(false);
    setMessage("");
    setCandidates([]);
    setStorage(null);
    return () => {
      generation.current++;
    };
  }, [owner, repository, today.date, scenario]);
  const demo = winterHomeScenario(garments, owner, today.date),
    usage = confirmedHomeUsage(state.events, owner, garments);
  const choices = scenario
    ? demo.outfit
      ? [{ outfit: demo.outfit, reasons: demo.reasons }]
      : []
    : candidates;
  const run = async (kind: "outfit" | "storage") => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    const token = generation.current;
    const check = () => {
      if (
        token !== generation.current ||
        app.getState().activeProfileId !== owner ||
        currentMember()?.id !== owner ||
        app.repository !== repository
      )
        throw Error("조회 대상이 바뀌어 이전 결과를 표시하지 않습니다.");
    };
    try {
      if (kind === "outfit") {
        const value = await todayServerRecommendation(garments, check);
        check();
        setCandidates(value);
        setMessage(
          value.length
            ? "보유 의류와 실제 이력 기반 추천 · 날씨는 기존 Mock Provider입니다."
            : "추천 가능한 의류가 없습니다. 의류 상태·사진·조합 조건을 확인하세요. 시연 모드는 실제 상태를 변경하지 않습니다.",
        );
      } else {
        const value = await homeServerStorageAdvice(check);
        check();
        setStorage(value);
        setMessage("보관·회수 분석 완료 · 실제 이동은 실행하지 않았습니다.");
      }
    } catch (e) {
      if (token === generation.current) setMessage((e as Error).message);
    } finally {
      if (token === generation.current) {
        sending.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className="mx-home-panel"
      aria-label="홈 안내"
      data-profile-id={owner}
    >
      <div className="mx-home-summary">
        <div className="mx-home-time">
          <time dateTime={`${today.date}T${today.time}:00+09:00`}>
            {today.time}
          </time>
          <span>{today.label}</span>
          <small className="mx-home-weather">
            {scenario
              ? "겨울 전환 시연 · 오늘 16°C → 다음 주 7°C · Mock 예보"
              : "실제 예보·방별 센서 연동 없음"}
          </small>
        </div>
        <div className="mx-home-greeting">
          <strong className="mx-home-name">
            {profile?.name ?? "내 옷장"}님
          </strong>
          <p>오늘 입을 옷과 계절에 맞는 보관을 제안해요.</p>
        </div>
      </div>
      <div className="mx-home-recommendations" aria-label="오늘의 추천과 관리">
        <div
          className="mx-home-mode"
          role="group"
          aria-label="추천 데이터 출처"
        >
          <button aria-pressed={scenario} onClick={() => setScenario(true)}>
            겨울 전환 시연
          </button>
          <button aria-pressed={!scenario} onClick={() => setScenario(false)}>
            실제 기록
          </button>
        </div>
        <small data-home-source={scenario ? "MOCK" : "SERVER"}>
          {scenario
            ? "시연 예보·환경·사용 이력 / 실제 보유 사진"
            : "실제 보유 의류·착용 기록 / 날씨는 Mock"}
        </small>
        <section className="mx-home-advice" aria-label="오늘의 코디 추천">
          <h2>오늘의 코디 추천</h2>
          {choices.map(({ outfit, reasons }) => (
            <div key={outfit.id}>
              <MirrorOutfitThumbnail app={app} outfit={outfit} />
              <strong>{outfit.name}</strong>
              {reasons.map((reason, index) => (
                <p key={index}>{reason}</p>
              ))}
              <button
                className="mx-home-open"
                onClick={() => {
                  try {
                    outfitAssetRefs(
                      outfit,
                      app.garments(),
                      app.connection.kind === "supabase",
                    );
                    onOpenOutfit(outfit);
                  } catch (error) {
                    setMessage((error as Error).message);
                  }
                }}
              >
                추천 코디 비교하기
              </button>
            </div>
          ))}
          {!choices.length && (
            <p>
              {scenario
                ? "상의·하의 또는 원피스 사진이 있는 보유 의류를 로그인 후 불러오세요."
                : "내 옷 추천을 요청하면 착용 가능 상태와 실제 이력을 확인합니다."}
            </p>
          )}
          {!scenario && (
            <button
              disabled={busy || app.connection.kind !== "supabase"}
              onClick={() => void run("outfit")}
            >
              {busy ? "분석 중" : "내 옷 추천 받기"}
            </button>
          )}
        </section>
        <section className="mx-home-advice" aria-label="계절 보관 관리 추천">
          <h2>계절·보관 관리 추천</h2>
          {scenario ? (
            <>
              <p>
                시연 예보에서 다음 주 기온이 내려갑니다. 따뜻한 옷을 가까운
                옷장에 두고, 나시·반팔 등 여름옷은 옷장 밖 보관을 검토해보세요.
              </p>
              <small>
                나시·반팔은 설명용 예시이며 보유 의류로 등록하지 않습니다.
              </small>
              <div className="mx-home-room-readings">
                {demo.rooms.map((room) => (
                  <div key={room.name}>
                    <strong>{room.name}</strong>
                    <span>
                      {room.temperature}°C · 습도 {room.humidity}%
                    </span>
                  </div>
                ))}
              </div>
              {demo.storageRoom && (
                <p>
                  <strong>
                    {demo.storageRoom.name}을 보관 후보로 추천해요.
                  </strong>{" "}
                  습도 {demo.storageRoom.humidity}%로 시연 기준 범위에
                  들어갑니다.
                </p>
              )}
              <small>
                Mock 기준: 습도 40~55%, 온도 25°C 이하. 소재별 실제 권장치가
                아닙니다. 실제 이동 전 환경·빈 공간·케어 제약을 확인하세요.
              </small>
            </>
          ) : (
            <>
              <p>
                실제 이력과 확인된 위치로 보관 후보를 분석합니다. 센서·위치·착용
                이력이 없으면 판단을 보류합니다.
              </p>
              <button
                disabled={busy || app.connection.kind !== "supabase"}
                onClick={() => void run("storage")}
              >
                실제 보관 추천 조회
              </button>
              {storage && (
                <>
                  <p>
                    보관·회수 제안 {storage.proposed_items?.length ?? 0}건 /
                    검토 필요 {storage.blocked?.length ?? 0}건
                  </p>
                  {(storage.diagnostics ?? []).map((d: string, i: number) => (
                    <small key={i}>{d}</small>
                  ))}
                  {storage.blocked?.length > 0 && (
                    <small>
                      위치·환경·이력 미확인 항목은 자동 이동하지 않습니다.
                    </small>
                  )}
                </>
              )}
            </>
          )}
        </section>
        <section className="mx-home-advice" aria-label="추천에 사용한 이력">
          <h2>사용 이력</h2>
          <p>
            실제 착용 완료 {usage.wearRecords}건 · 관리 완료 {usage.careRecords}
            건
          </p>
          {scenario && (
            <>
              <small>
                아래는 최근 7일 시연용 사용 횟수입니다. 실제 착용 기록과
                분리합니다.
              </small>
              {demo.usage.map((row) => (
                <p key={row.garmentId}>
                  {row.name} · Mock {row.count}회
                </p>
              ))}
            </>
          )}
          {!scenario && usage.wearRecords === 0 && (
            <small>
              아직 실제 착용 로그가 없습니다. 캘린더에서 본인이 확인한 착용만
              기록하세요.
            </small>
          )}
        </section>
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
