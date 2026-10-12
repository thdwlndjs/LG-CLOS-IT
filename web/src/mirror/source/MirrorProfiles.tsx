import { useEffect, useState, useSyncExternalStore } from "react";
import type { DemoApp } from "./core/app";
import { HorizontalPager } from "./HorizontalPager";
import { permittedMirrorProfiles } from "./mirrorPanelData";
import "./mirror-panels.css";
import { HttpRemoteBackend, currentMember } from "./integrations/backendClient";

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
  const [demoProfiles, setDemoProfiles] = useState<Awaited<ReturnType<HttpRemoteBackend["demoProfiles"]>>>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [profileStatus, setProfileStatus] = useState<"loading" | "success" | "empty" | "error">("loading");
  const [profileRequest, setProfileRequest] = useState(0);
  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    setProfileStatus("loading");
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Profile request timed out")), 10000);
    });
    void Promise.race([new HttpRemoteBackend().demoProfiles(), deadline])
      .then(items => {
        if (!active) return;
        setDemoProfiles(items);
        setProfileStatus(items.length ? "success" : "empty");
      })
      .catch(() => { if (active) setProfileStatus("error"); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); };
  }, [profileRequest]);
  const profiles = [
    ...demoProfiles.map(profile => ({id: `saved-demo-${profile.profile}`, name: profile.display_name,
      details: `${profile.age}세 · ${profile.relationship}`, demo: profile.profile,
      selected: currentMember()?.display_name === profile.display_name})),
    ...permittedMirrorProfiles(state, app.connection.kind)
      .filter(profile => !demoProfiles.length || (!["demo-profile", "signed-out"].includes(profile.id) &&
        !demoProfiles.some(demo => demo.display_name === profile.name)))
      .map(profile => ({...profile, details: "", demo: undefined,
        selected: profile.id === state.activeProfileId})),
  ],
    pages = Array.from({ length: Math.ceil(profiles.length / 4) }, (_, index) =>
      profiles.slice(index * 4, index * 4 + 4),
    );
  return (
    <section className="mx-work mx-profile-panel" aria-label="프로필 선택" data-profile-status={profileStatus}>
      <h1>
        누가 옷장을
        <br />
        사용하나요?
      </h1>
      <p className="mx-panel-note">
        {demoProfiles.length ? "저장된 시연 프로필" : local ? "이 브라우저의 시연 프로필" : "현재 로그인에 허용된 프로필"}
      </p>
      {profileStatus === "loading" && <p className="mx-panel-note" role="status">프로필 조회 중</p>}
      {profileStatus === "empty" && <p className="mx-panel-note" role="status">등록된 시연 프로필이 없습니다.</p>}
      {profileStatus === "error" && <p className="mx-panel-note" role="alert">프로필을 불러오지 못했습니다</p>}
      <button type="button" className="mx-profile-account" disabled={profileStatus === "loading"}
        onClick={() => setProfileRequest(value => value + 1)}>
        {profileStatus === "error" ? "재시도" : "프로필 다시 조회"}
      </button>
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
                aria-pressed={profile.selected}
                disabled={busy}
                onClick={async () => {
                  if (!profile.demo) { onSelectProfile(profile.id); return; }
                  if (profile.selected) return;
                  setBusy(true); setError("");
                  try {
                    const client = new HttpRemoteBackend();
                    if (currentMember()) await client.logout();
                    await app.configureRemote();
                    await client.demoLogin(profile.demo);
                    await app.configureRemote(client);
                  } catch (e) {
                    await new HttpRemoteBackend().logout().catch(() => {});
                    await app.configureRemote();
                    setError((e as Error).message);
                  } finally { setBusy(false); }
                }}
              >
                <span className="mx-profile-avatar" aria-hidden="true">
                  {Array.from(profile.name.trim())[0] ?? "나"}
                </span>
                <strong>{profile.name}</strong>
                {profile.details && <small>{profile.details}</small>}
                <small>
                  {profile.selected ? "사용 중" : "선택"}
                </small>
              </button>
            ))}
          </div>
        ))}
      </HorizontalPager>
      {error && <p role="alert" className="mx-panel-note">{error}</p>}
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
