import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "./api.js";
import { Badge, ErrorBox, useAction } from "./ui.jsx";
import { Home } from "./pages/Home.jsx";
import { Wardrobe } from "./pages/Wardrobe.jsx";
import { Outfits } from "./pages/Outfits.jsx";
import { Care, History, Settings } from "./pages/Life.jsx";
import { TryOn, Cards } from "./pages/TryOn.jsx";
import { Storage } from "./pages/Storage.jsx";
import "./style.css";

const menus = [
  ["home", "⌂", "홈"],
  ["wardrobe", "▥", "옷장"],
  ["outfits", "◇", "코디"],
  ["history", "▦", "캘린더"],
  ["care", "✳", "케어"],
  ["settings", "○", "마이"],
];
const household = "10000000-0000-4000-8000-000000000001";
const profiles = [
  ["20000000-0000-4000-8000-000000000001", "나의 옷장", "Demo User", "D"],
  ["20000000-0000-4000-8000-000000000002", "가족의 옷장", "Family Member", "F"],
];
function Login({ onLogin }) {
  const action = useAction();
  const client = useMemo(() => createClient(), []);
  const [selected, setSelected] = useState(profiles[0][0]);
  return (
    <main className="login">
      <div className="login-art">
        <span className="wordmark">
          wardrobe<span>°</span>
        </span>
        <p className="eyebrow">A LITTLE MORE YOU</p>
        <h1>
          매일의 나를
          <br />
          입는 공간.
        </h1>
        <div className="art-shirt" />
        <p>
          잘 고른 옷 한 벌에서 시작하는 하루.
          <br />
          나의 옷장과 일상을 함께 정리해요.
        </p>
      </div>
      <section className="login-panel">
        <Badge kind="orange">로컬 데모</Badge>
        <h2>
          반가워요.
          <br />
          어느 옷장으로 들어갈까요?
        </h2>
        <p>프로필을 선택해 오늘의 코디를 만나보세요.</p>
        <div className="profile-list">
          {profiles.map(([id, title, name, initial]) => (
            <button
              key={id}
              className={`profile ${selected === id ? "selected" : ""}`}
              onClick={() => setSelected(id)}
              aria-pressed={selected === id}
            >
              <span className="avatar">{initial}</span>
              <span>
                <strong>{title}</strong>
                <small>{name}</small>
              </span>
              <span className="profile-check">
                {selected === id ? "✓" : "○"}
              </span>
            </button>
          ))}
        </div>
        <ErrorBox error={action.error} />
        <button
          className="primary wide"
          disabled={action.busy}
          onClick={() =>
            action.run(async () =>
              onLogin(
                await client.send("/sessions", {
                  household_id: household,
                  member_id: selected,
                  demo_mode: true,
                }),
              ),
            )
          }
        >
          {action.busy ? "옷장 여는 중…" : "내 옷장 들어가기 →"}
        </button>
        <p className="fine">
          사진과 설정은 선택한 프로필에 연결됩니다.
          <br />
          실제 외부 연동은 아직 연결되지 않은 로컬 QA 환경입니다.
        </p>
      </section>
    </main>
  );
}
function App() {
  const [session, setSession] = useState(null),
    [route, setRoute] = useState({ page: "home" }),
    [notice, setNotice] = useState("");
  const lock = () => {
    setSession(null);
    setRoute({ page: "home" });
    setNotice("");
    window.history.replaceState({ page: "home" }, "", "#home");
  };
  const currentToken = useRef(session?.access_token);
  currentToken.current = session?.access_token;
  const api = useMemo(() => {
    const token = session?.access_token;
    return createClient(token, () => {
      if (currentToken.current === token) lock();
    });
  }, [session?.access_token]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      lock,
      Math.max(0, new Date(session.expires_at) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  useEffect(() => {
    const back = (event) => {
      setRoute(event.state?.page ? event.state : { page: "home" });
      setNotice("");
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  if (!session) return <Login onLogin={setSession} />;
  const navigate = (page, data = {}) => {
    setNotice("");
    setRoute({ page, ...data });
    window.history.pushState({ page, ...data }, "", "#" + page);
  };
  const props = { api, member: session.member, navigate, notify: setNotice };
  const active = ["tryon", "cards"].includes(route.page)
    ? "outfits"
    : route.page === "storage"
      ? "care"
      : route.page;
  return (
    <div className="shell">
      <a className="skip" href="#content">
        본문으로 이동
      </a>
      <aside className="sidebar">
        <button className="wordmark" onClick={() => navigate("home")}>
          wardrobe<span>°</span>
        </button>
        <p className="sidebar-caption">나의 일상을 입다</p>
        <nav aria-label="주 메뉴">
          {menus.map(([key, icon, title]) => (
            <button
              key={key}
              className={active === key ? "active" : ""}
              aria-current={active === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              <span aria-hidden="true">{icon}</span>
              {title}
              {active === key && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-note">
            <span>작은 옷장, 더 많은 가능성</span>
            <p>오늘도 나다운 하루를.</p>
          </div>
          <button className="account" onClick={lock}>
            <span className="avatar">{session.member.display_name[0]}</span>
            <span>
              <strong>{session.member.display_name}</strong>
              <small>잠금 · 프로필 변경</small>
            </span>
            <span>↗</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            SMART WARDROBE <span className="separator">/</span>{" "}
            {menus.find((x) => x[0] === active)?.[2]}
          </span>
          <div>
            <Badge>Mock 모드</Badge>
            <span className="top-date">
              {new Date().toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </span>
            <button className="mobile-lock" onClick={lock}>
              잠금
            </button>
          </div>
        </header>
        <main
          id="content"
          tabIndex="-1"
          key={session.session_id + route.page + (route.id || "")}
        >
          <div className="local-banner">
            <span className="dot" />
            로컬 QA · 외부 연동과 유료 API 호출은 사용하지 않습니다.
          </div>
          {notice && (
            <div role="status" className="toast">
              {notice}
              <button aria-label="알림 닫기" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {route.page === "home" && <Home {...props} />}
          {route.page === "wardrobe" && (
            <Wardrobe {...props} initialId={route.id} />
          )}
          {route.page === "outfits" && (
            <Outfits {...props} reference={route.reference} />
          )}
          {route.page === "history" && <History {...props} />}
          {route.page === "care" && <Care {...props} garmentId={route.id} />}
          {route.page === "settings" && <Settings {...props} />}{" "}
          {route.page === "tryon" && <TryOn {...props} entry={route} />}{" "}
          {route.page === "cards" && (
            <Cards
              {...props}
              outfitId={route.outfitId}
              contextId={route.contextId}
            />
          )}{" "}
          {route.page === "storage" && <Storage {...props} />}
        </main>
        <footer>
          WARDROBE° <span>나의 옷, 나의 방식.</span>
        </footer>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
