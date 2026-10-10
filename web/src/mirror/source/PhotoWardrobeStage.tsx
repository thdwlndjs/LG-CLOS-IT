import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import geometry from "./data/mirror-geometry.json";
export function PhotoWardrobeStage({
  anchorIds,
  children,
}: {
  anchorIds: string[];
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1672, height: 941 });
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(
        entry.contentRect.width / 1672,
        entry.contentRect.height / 941,
      );
      setSize({ width: 1672 * scale, height: 941 * scale });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [fullscreen, setFullscreen] = useState(false),
    [presentationStatus, setPresentationStatus] = useState("");
  useEffect(() => {
    const changed = () => {
      setFullscreen(document.fullscreenElement === viewport.current);
      setPresentationStatus("");
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const togglePresentation = async () => {
    try {
      if (document.fullscreenElement === viewport.current)
        await document.exitFullscreen();
      else if (viewport.current?.requestFullscreen)
        await viewport.current.requestFullscreen();
      else
        setPresentationStatus("이 브라우저에서는 전체 화면을 지원하지 않아요.");
    } catch {
      setPresentationStatus(
        "전체 화면을 열지 못했어요. 현재 화면에서 계속 사용할 수 있어요.",
      );
    }
  };
  const active = new Set(anchorIds);
  return (
    <div className="photo-wardrobe" ref={viewport}>
      <button
        className="photo-presentation-toggle"
        aria-label={fullscreen ? "전체 화면 나가기" : "전체 화면으로 보기"}
        title={fullscreen ? "전체 화면 나가기 · Esc" : "전체 화면으로 보기"}
        onClick={() => void togglePresentation()}
      >
        <span aria-hidden="true">{fullscreen ? "↙" : "⛶"}</span>
        <span>{fullscreen ? "나가기" : "전체 화면"}</span>
      </button>
      <span className="photo-presentation-status" role="status">
        {presentationStatus}
      </span>
      <div
        className="photo-stage"
        style={size}
        data-scene-version={geometry.source.rgb_pixel_sha256}
      >
        <img
          className="photo-background"
          src="/assets/mirror-final/wardrobe-base-led-off.png"
          alt="열린 수납부와 중앙 미러가 있는 기준 옷장"
          draggable={false}
        />
        <div className="photo-led-layer" aria-hidden="true">
          {geometry.led_anchors.map((anchor) => {
            const [x, y] = anchor.source_xy_px;
            const radius =
              anchor.kind === "drawer" || anchor.kind === "shelf" ? 29 : 24;
            return (
              <div
                key={anchor.anchor_id}
                data-anchor-id={anchor.anchor_id}
                data-led={active.has(anchor.anchor_id) ? "on" : "off"}
                className="photo-led"
                style={{
                  left: `${((x - radius) / 1672) * 100}%`,
                  top: `${((y - radius) / 941) * 100}%`,
                  width: `${((radius * 2) / 1672) * 100}%`,
                  height: `${((radius * 2) / 941) * 100}%`,
                }}
              >
                <img
                  draggable={false}
                  src="/assets/mirror-final/wardrobe-reference.png"
                  style={{
                    width: `${(1672 / (radius * 2)) * 100}%`,
                    height: `${(941 / (radius * 2)) * 100}%`,
                    left: `${(-(x - radius) / (radius * 2)) * 100}%`,
                    top: `${(-(y - radius) / (radius * 2)) * 100}%`,
                  }}
                  alt=""
                />
              </div>
            );
          })}
        </div>
        <main
          className="photo-mirror"
          aria-label="스마트 옷장 미러"
          style={
            {
              left: "42.7033493%",
              top: "2.975558%",
              width: "14.8325359%",
              height: "87.5664187%",
              "--mirror-width": `${(size.width * 248) / 1672}px`,
            } as CSSProperties
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
