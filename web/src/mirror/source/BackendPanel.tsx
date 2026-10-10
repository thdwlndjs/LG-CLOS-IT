import {
  useState,
  useSyncExternalStore,
  useEffect,
} from "react";
import type { DemoApp } from "./core/app";
import { IntegrationActions } from "./IntegrationActions";
import {
  HttpRemoteBackend,
  bindStation,
  currentMember,
  currentDevice,
  onBackendSessionExpired,
} from "./integrations/backendClient";
export function BackendSessionBootstrap({ app }: { app: DemoApp }) {
  useEffect(
    () =>
      onBackendSessionExpired(() => {
        void app.configureRemote();
      }),
    [app],
  );
  return null;
}
export const MirrorAccountPanel = BackendPanel;
export function BackendPanel({
  app,
  placement = "account",
}: {
  app: DemoApp;
  placement?: "account" | "tools";
}) {
  useSyncExternalStore(app.subscribe, app.getState);
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [station, setStation] = useState(""),
    [credential, setCredential] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const connected = !!currentMember();
  const submit = async () => {
    setBusy(true);
    try {
      bindStation(station, credential);
      const client = new HttpRemoteBackend();
      await client.login(login, password);
      await app.configureRemote(client);
      setMessage("내 기기 의류를 조회했습니다.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPassword("");
      setCredential("");
      setBusy(false);
    }
  };
  const demoLogin = async () => {
    setBusy(true);
    setMessage("");
    try {
      const client = new HttpRemoteBackend();
      await client.demoLogin();
      await app.configureRemote(client);
      setMessage("시연용 옷장을 불러왔습니다.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPassword("");
      setCredential("");
      setBusy(false);
    }
  };
  return (
    <section className="mirror-account-panel">
      <h3>{placement === "tools" ? "서버 연결" : "내 계정"}</h3>
      {connected ? (
        <>
          <div className="mirror-account-identity">
            <span className="mirror-account-caption">로그인한 계정</span>
            <strong>{currentMember().display_name}</strong>
            <details className="mirror-account-device">
              <summary>연결된 옷장</summary>
              <p>{currentDevice()}</p>
            </details>
          </div>
          <div className="mirror-account-actions">
          <button disabled={busy} onClick={async () => {
            setBusy(true); setMessage("");
            try { await app.reloadRemote(); setMessage("내 옷장을 다시 불러왔습니다."); }
            catch (e) { setMessage((e as Error).message); }
            finally { setBusy(false); }
          }}>
            내 옷장 다시 불러오기
          </button>
          <button
            onClick={() =>
              void new HttpRemoteBackend()
                .logout()
                .finally(() => app.configureRemote())
                .catch((e: Error) => setMessage(e.message))
            }
          >
            로그아웃
          </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="mirror-account-intro">내 계정으로 로그인해 연결된 옷장을 불러오세요.</p>
          <button
            className="mirror-account-demo"
            type="button"
            disabled={busy}
            onClick={() => void demoLogin()}
          >
            시연용 로그인
          </button>
          <div className="mirror-account-divider"><span>계정 로그인</span></div>
          <label>
            계정
            <input
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <details className="mirror-account-optional">
            <summary>다른 기기에서 접속 · 선택</summary>
            <p>접속 기기 정보가 있을 때만 입력하세요.</p>
          <label>
            접속 기기 ID · 선택
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
            />
          </label>
          <label>
            기기 인증 · 선택
            <input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
          </label>
          </details>
          <button type="submit" disabled={busy}>내 계정으로 로그인</button>
        </form>
      )}
      <p className="mirror-account-status" role="status">{message}</p>
      {connected && (placement === "tools" ? <IntegrationActions /> :
        <details className="mirror-account-tools">
          <summary>쇼핑 및 추가 기능</summary>
          <IntegrationActions />
        </details>
      )}
    </section>
  );
}
