import {
  useState,
  useSyncExternalStore,
  useRef,
  useLayoutEffect,
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
  const pane = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = pane.current,
      parent = node?.closest(".mx-auth-dialog") as HTMLElement | null;
    if (!node || !parent) return;
    const style = getComputedStyle(parent);
    const close = parent.querySelector(":scope > button") as HTMLElement | null;
    node.style.maxHeight =
      parseFloat(style.maxHeight) -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom) -
      (close?.offsetHeight || 0) +
      "px";
    node.style.overflowY = "auto";
  }, [connected]);
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
    <section ref={pane} className="mirror-account-panel">
      <h3>{placement === "tools" ? "서버 연결" : "내 계정"}</h3>
      {connected ? (
        <>
          <p>
            {currentMember().display_name} · {currentDevice()}
          </p>
          <button onClick={() => void app.reloadRemote()}>
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
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => void demoLogin()}
          >
            시연용 로그인
          </button>
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
          <button disabled={busy}>내 계정으로 로그인</button>
        </form>
      )}
      <p role="status">{message}</p>
      {connected && <IntegrationActions />}
    </section>
  );
}
