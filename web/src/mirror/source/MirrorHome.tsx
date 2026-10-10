import { buildLifeSnapshot } from "./lifeSnapshot";
import { useSyncExternalStore } from "react";
import type { DemoApp } from "./core/app";
import type { Outfit } from "./core/types";
import { useToday } from "./ScenarioControls";
import {
  mirrorHomeWeather,
  type MirrorWeatherContext,
} from "./mirrorPanelData";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
import { describeOutfitCard } from "./outfitCardPresentation";
import "./mirror-panels.css";

export function MirrorHome({
  app,
  onOpenOutfit,
  weather,
}: {
  app: DemoApp;
  onOpenOutfit: (outfit: Outfit) => void;
  weather?: MirrorWeatherContext;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getState),
    today = useToday(),
    owner = state.activeProfileId;
  const profile = state.profiles.find((profile) => profile.id === owner),
    outfits = app.cardOutfits().slice(0, 3);
  const currentWeather = mirrorHomeWeather(weather, owner, today.date),
    name = profile?.name ?? "내 옷장";
  const life = buildLifeSnapshot(state, owner, { date: today.date });
  const weatherText = life.weather
    ? `${life.weather.summary} · ${life.weather.sourceLabel}`
    : currentWeather
      ? `${currentWeather.summary} · ${currentWeather.source}`
      : "날씨 정보 없음";
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
          <small className="mx-home-weather">{weatherText}</small>
        </div>
        <div className="mx-home-greeting">
          <strong
            className="mx-home-name"
            title={name}
            aria-label={`${name}님`}
          >
            {name}님
          </strong>
          <p>
            {life.shortFact ||
              (outfits.length
                ? "저장한 코디를 다시 입어보세요."
                : "내 옷으로 코디를 만들어 보세요.")}
          </p>
        </div>
      </div>
      {outfits.length > 0 && (
        <div className="mx-home-side" aria-label="저장한 코디 다시 보기">
          <span>다시 입어볼 코디</span>
          {outfits.map((outfit) => {
            const card = describeOutfitCard({
              outfit,
              ownerId: owner,
              garments: app.garments(),
              externalItems: app.externalItems(),
              deviceScoped: app.connection.kind === "supabase",
            });
            return (
              <button
                type="button"
                className="mx-home-mini"
                key={outfit.id}
                data-look-id={outfit.id}
                title={card.title}
                aria-label={`${card.title} · ${card.description} · 미러로 입어보기`}
                onClick={() => onOpenOutfit(outfit)}
              >
                <MirrorOutfitThumbnail app={app} outfit={outfit} />
                <strong>{card.title}</strong>
                {card.description !== card.title && (
                  <span
                    className="mx-card-description"
                    title={card.description}
                  >
                    {card.description}
                  </span>
                )}
                <small>
                  {card.reuseStatus === "needs-review"
                    ? "구성 확인 필요 · 입어보기"
                    : "미러로 입어보기"}
                </small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
