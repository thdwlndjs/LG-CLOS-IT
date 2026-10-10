import { useState, useSyncExternalStore } from "react";
import type { DemoApp } from "./core/app";
import { HorizontalPager } from "./HorizontalPager";
import { permittedMirrorProfiles } from "./mirrorPanelData";
import "./mirror-panels.css";

export function MirrorProfiles({
  app,
  onSelectProfile,
  onAccount,
}: {
  app: DemoApp;
  onSelectProfile: (id: string) => void;
  onAccount: () => void;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getState),
    [page, setPage] = useState(0),
    local = app.connection.kind === "local";
  const profiles = permittedMirrorProfiles(state, app.connection.kind),
    pages = Array.from({ length: Math.ceil(profiles.length / 4) }, (_, index) =>
      profiles.slice(index * 4, index * 4 + 4),
    );
  return (
    <section className="mx-work mx-profile-panel" aria-label="프로필 선택">
      <h1>
        누가 옷장을
        <br />
        사용하나요?
      </h1>
      <p className="mx-panel-note">
        {local ? "이 브라우저의 시연 프로필" : "현재 로그인에 허용된 프로필"}
      </p>
      <HorizontalPager
        index={Math.min(page, Math.max(0, pages.length - 1))}
        onIndexChange={setPage}
        label="프로필 가로 탐색"
        peek={0}
        gap={8}
        showControls={pages.length > 1}
      >
        {pages.map((profiles, index) => (
          <div className="mx-profiles-grid" key={index}>
            {profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                data-profile-id={profile.id}
                aria-label={`${profile.name} 프로필 선택`}
                aria-pressed={profile.id === state.activeProfileId}
                onClick={() => onSelectProfile(profile.id)}
              >
                <span className="mx-profile-avatar" aria-hidden="true">
                  {Array.from(profile.name.trim())[0] ?? "나"}
                </span>
                <strong>{profile.name}</strong>
                <small>
                  {profile.id === state.activeProfileId ? "사용 중" : "선택"}
                </small>
              </button>
            ))}
          </div>
        ))}
      </HorizontalPager>
      {!local && profiles.length === 1 && (
        <p className="mx-panel-note">
          현재 로그인 계정의 프로필을 표시해요. 연결된 기기의 의류는 함께 조회할
          수 있어요.
        </p>
      )}
      <button type="button" className="mx-profile-account" onClick={onAccount}>
        내 계정
      </button>
    </section>
  );
}
