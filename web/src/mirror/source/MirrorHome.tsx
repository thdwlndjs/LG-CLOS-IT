import { useSyncExternalStore } from "react";
import type { DemoApp } from "./core/app";
import type { Outfit } from "./core/types";
import { useToday } from "./ScenarioControls";
import {
  mirrorHomeWeather,
  type MirrorWeatherContext,
} from "./mirrorPanelData";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
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
    outfits = app
      .outfits()
      .filter((outfit) => !outfit.name.startsWith("__"))
      .slice(0, 3);
  const currentWeather = mirrorHomeWeather(weather, owner, today.date);
  return (
    <section
      className="mx-home-panel"
      aria-label="홈 안내"
      data-profile-id={owner}
    >
      <div className="mx-home-summary">
        <time dateTime={today.date}>{today.time}</time>
        <span>{today.label}</span>
        <small className="mx-home-weather">
          {currentWeather
            ? `${currentWeather.summary} · ${currentWeather.source}`
            : "날씨 정보 없음"}
        </small>
        <strong>{profile?.name ?? "내 옷장"}님</strong>
        <p>
          {outfits.length
            ? "저장해 둔 코디를 다시 살펴보세요. 선택한 조합에서 자유롭게 바꿀 수 있어요."
            : "옷장에서 옷을 찾아 나만의 조합을 만들어 보세요."}
        </p>
      </div>
      {outfits.length > 0 && (
        <div className="mx-home-side" aria-label="저장한 코디 다시 보기">
          <span>다시 입어볼 코디</span>
          {outfits.map((outfit) => (
            <button
              type="button"
              className="mx-home-mini"
              key={outfit.id}
              data-look-id={outfit.id}
              aria-label={`${outfit.name} · 미러에서 조합 보기`}
              onClick={() => onOpenOutfit(outfit)}
            >
              <MirrorOutfitThumbnail app={app} outfit={outfit} />
              <strong>{outfit.name}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
