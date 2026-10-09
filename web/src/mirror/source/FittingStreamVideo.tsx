import { useEffect, useRef, useState } from "react";
import { attachFittingStreamVideo } from "./fittingStreamSession";

/** The session owns stream lifetime. This view neither requests media nor sends provider calls. */
export function FittingStreamVideo({
  stream,
  label,
  className = "person-media",
}: {
  stream: MediaStream;
  label: string;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null),
    [playbackError, setPlaybackError] = useState(false);
  useEffect(() => {
    setPlaybackError(false);
    if (!video.current) return;
    return attachFittingStreamVideo(video.current, stream, () =>
      setPlaybackError(true),
    );
  }, [stream]);
  return (
    <>
      <video
        ref={video}
        className={className}
        autoPlay
        muted
        playsInline
        controls
        aria-label={label}
        onPlaying={() => setPlaybackError(false)}
        onError={() => setPlaybackError(true)}
      />
      {playbackError && (
        <span role="status" className="stream-playback-status">
          영상 재생을 시작하지 못했어요. 재생 버튼을 눌러 주세요.
        </span>
      )}
    </>
  );
}
