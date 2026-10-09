import { useEffect, useRef, useState } from "react";
import {
  ForegroundFrameGate,
  FOREGROUND_FRAME_INTERVAL_MS,
  type ForegroundTicket,
} from "./foregroundCore";
import "./mirror-foreground.css";
export type ForegroundMedia =
  | { kind: "image" | "video"; url: string; label: string }
  | { kind: "stream"; stream: MediaStream; label: string };
export type ForegroundStatus = {
  state: "loading" | "ready" | "error" | "ended";
  frames: number;
  processingMs: number;
  latencyMs: number;
  sourceTime: number | null;
  contextKey: string;
  message: string;
};
type Props = {
  media: ForegroundMedia;
  contextKey: string;
  className?: string;
  mirrored?: boolean;
  onStatus?: (status: ForegroundStatus) => void;
};
/** The owner/session/look/asset version key invalidates every pending RGB+mask pair. */
export function MirrorForeground({
  media,
  contextKey,
  className = "",
  mirrored = false,
  onStatus,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    notify = useRef(onStatus);
  notify.current = onStatus;
  const [status, setStatus] = useState<ForegroundStatus>({
    state: "loading",
    frames: 0,
    processingMs: 0,
    latencyMs: 0,
    sourceTime: null,
    contextKey,
    message: "인물을 거울에 준비하고 있어요.",
  });
  const [generation, setGeneration] = useState(contextKey);
  const url = media.kind === "stream" ? null : media.url,
    stream = media.kind === "stream" ? media.stream : null,
    kind = media.kind;
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    let cancelled = false,
      ready = false,
      ended = false,
      frames = 0,
      worker: Worker | null = null,
      video: HTMLVideoElement | null = null,
      image: HTMLImageElement | null = null,
      timer: number | undefined,
      watchdog: number | undefined,
      frameCallback: number | undefined,
      lastAttempt = 0,
      lastVideoTime = -1,
      startedAt = 0;
    const gate = new ForegroundFrameGate(contextKey),
      context = target.getContext("2d");
    target.width = 1;
    target.height = 1;
    setGeneration(contextKey);
    const emit = (
      state: ForegroundStatus["state"],
      message: string,
      other: Partial<ForegroundStatus> = {},
    ) => {
      if (cancelled) return;
      const value = {
        state,
        message,
        frames,
        processingMs: 0,
        latencyMs: 0,
        sourceTime: null,
        contextKey,
        ...other,
      };
      setStatus(value);
      notify.current?.(value);
    };
    emit("loading", "인물을 거울에 준비하고 있어요.");
    const fail = (message: string) => emit("error", message);
    const capture = async (frameTime?: number) => {
      if (cancelled || ended || !ready || gate.busy) return;
      const source = image ?? video;
      if (
        !source ||
        (image && !image.complete) ||
        (video && (video.readyState < 2 || video.ended))
      )
        return;
      const sourceTime = frameTime ?? video?.currentTime ?? 0;
      if (video && sourceTime === lastVideoTime) return;
      const ticket = gate.begin(sourceTime);
      if (!ticket) return;
      lastVideoTime = sourceTime;
      startedAt = performance.now();
      try {
        const bitmap = await createImageBitmap(source);
        if (cancelled || ended) {
          bitmap.close();
          return;
        }
        worker?.postMessage({ type: "frame", ticket, bitmap }, [bitmap]);
      } catch {
        gate.finish(ticket);
        fail(
          "선택한 영상의 인물을 읽지 못했어요. 원본 접근 권한을 확인해 주세요.",
        );
      }
    };
    const schedule = () => {
      if (cancelled || ended || !video) return;
      if ("requestVideoFrameCallback" in video) {
        frameCallback = video.requestVideoFrameCallback((now, metadata) => {
          if (now - lastAttempt >= FOREGROUND_FRAME_INTERVAL_MS) {
            lastAttempt = now;
            void capture(metadata.mediaTime);
          }
          schedule();
        });
      } else
        timer = window.setTimeout(() => {
          void capture();
          schedule();
        }, FOREGROUND_FRAME_INTERVAL_MS);
    };
    const streamEnded = () => {
      if (
        !ended &&
        !stream?.getVideoTracks().some((track) => track.readyState === "live")
      ) {
        ended = true;
        worker?.terminate();
        emit("ended", "영상이 끝났어요. 마지막 확인 화면을 유지해요.");
      }
    };
    if (stream) {
      stream
        .getVideoTracks()
        .forEach((track) => track.addEventListener("ended", streamEnded));
      watchdog = window.setInterval(streamEnded, 500);
    }
    try {
      worker = new Worker("/foreground-worker.js");
      worker.onmessage = ({ data }: { data: any }) => {
        if (cancelled || ended) {
          data.bitmap?.close();
          return;
        }
        if (data.type === "ready") {
          ready = true;
          void capture();
          return;
        }
        if (data.type === "error") {
          fail(data.message);
          return;
        }
        const ticket = data.ticket as ForegroundTicket;
        if (!ticket || !gate.finish(ticket)) {
          data.bitmap?.close();
          return;
        }
        if (data.type === "frame-error") {
          fail(data.message);
          return;
        }
        const bitmap = data.bitmap as ImageBitmap;
        if (context && bitmap) {
          if (
            target.width !== bitmap.width ||
            target.height !== bitmap.height
          ) {
            target.width = bitmap.width;
            target.height = bitmap.height;
          }
          context.clearRect(0, 0, target.width, target.height);
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          frames++;
          emit("ready", "로컬 인물 합성", {
            processingMs: Math.round(data.processingMs),
            latencyMs: Math.round(performance.now() - startedAt),
            sourceTime: ticket.sourceTime,
          });
        }
      };
      worker.onerror = () =>
        fail("이 브라우저에서 인물 분리를 준비하지 못했어요.");
      worker.postMessage({ type: "init" });
      if (kind === "image") {
        image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          void capture();
        };
        image.onerror = () => fail("선택한 이미지를 열지 못했어요.");
        image.src = url!;
      } else {
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = "anonymous";
        video.autoplay = true;
        video.onloadeddata = () => {
          void capture();
        };
        video.onerror = () => fail("선택한 영상을 열지 못했어요.");
        video.onended = () => {
          ended = true;
          emit("ended", "영상이 끝났어요. 마지막 확인 화면을 유지해요.");
        };
        if (kind === "stream") video.srcObject = stream;
        else video.src = url!;
        void video
          .play()
          .then(() => schedule())
          .catch(() => fail("영상 재생을 시작하지 못했어요."));
      }
    } catch {
      fail("이 브라우저는 로컬 인물 분리를 지원하지 않아요.");
    }
    return () => {
      cancelled = true;
      gate.dispose();
      stream
        ?.getVideoTracks()
        .forEach((track) => track.removeEventListener("ended", streamEnded));
      worker?.terminate();
      if (timer !== undefined) clearTimeout(timer);
      if (watchdog !== undefined) clearInterval(watchdog);
      if (video) {
        if (frameCallback !== undefined && "cancelVideoFrameCallback" in video)
          video.cancelVideoFrameCallback(frameCallback);
        video.pause();
        video.srcObject = null;
        video.removeAttribute("src");
        video.load();
      }
      if (image) {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      }
      context?.clearRect(0, 0, target.width, target.height);
    };
  }, [contextKey, kind, url, stream]);
  const current = generation === contextKey && status.contextKey === contextKey;
  return (
    <div
      className={`mirror-foreground ${className}`}
      data-foreground-context={contextKey}
      data-foreground-state={current ? status.state : "loading"}
      data-foreground-frames={current ? status.frames : 0}
      data-foreground-processing-ms={current ? status.processingMs : 0}
      data-foreground-latency-ms={current ? status.latencyMs : 0}
      data-foreground-source-time={current ? status.sourceTime : undefined}
    >
      <canvas
        ref={canvas}
        aria-label={media.label}
        role="img"
        className={
          mirrored
            ? "mirror-foreground__canvas is-mirrored"
            : "mirror-foreground__canvas"
        }
        style={{ visibility: current ? "visible" : "hidden" }}
      />
      {(!current || status.state !== "ready") && (
        <span className="mirror-foreground__status" role="status">
          {current ? status.message : "인물을 거울에 준비하고 있어요."}
        </span>
      )}
    </div>
  );
}
