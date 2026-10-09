import {
  fittingSnapshotsMatch,
  selectCurrentFittingStream,
  type FittingSnapshot,
  type FittingStreamBinding,
} from "./mirrorScene";

/** Stream tracks belong to this session, never to the presentation-only video element. */
export function stopFittingStream(stream: MediaStream): void {
  for (const track of stream.getTracks())
    if (track.readyState !== "ended")
      try {
        track.stop();
      } catch {
        /* Release all remaining tracks. */
      }
}
export class FittingStreamSession {
  private binding: FittingStreamBinding | null = null;
  private detach: Array<() => void> = [];
  constructor(
    private readonly publish: (binding: FittingStreamBinding | null) => void,
  ) {}
  get hasStream(): boolean {
    return this.binding !== null;
  }
  receive(
    binding: FittingStreamBinding,
    current: FittingSnapshot | null,
    isCurrent: boolean,
  ): boolean {
    if (!isCurrent || !selectCurrentFittingStream(binding, current)) {
      if (this.binding?.stream === binding.stream) this.clear();
      else stopFittingStream(binding.stream);
      return false;
    }
    if (this.binding?.stream === binding.stream) {
      if (
        this.binding.operationId === binding.operationId &&
        fittingSnapshotsMatch(this.binding.snapshot, binding.snapshot)
      )
        return true;
      this.clear();
      return false;
    }
    this.release();
    this.binding = { ...binding, snapshot: structuredClone(binding.snapshot) };
    const accepted = this.binding;
    const ended = () => {
      if (
        this.binding === accepted &&
        !selectCurrentFittingStream(accepted, accepted.snapshot)
      )
        this.clear();
    };
    for (const track of accepted.stream.getVideoTracks()) {
      track.addEventListener("ended", ended);
      this.detach.push(() => track.removeEventListener("ended", ended));
    }
    this.publish({ ...accepted, snapshot: structuredClone(accepted.snapshot) });
    return true;
  }
  reconcile(current: FittingSnapshot | null): boolean {
    if (!this.binding) return false;
    if (!selectCurrentFittingStream(this.binding, current)) {
      this.clear();
      return false;
    }
    return true;
  }
  private release(): void {
    this.detach.splice(0).forEach((detach) => detach());
    const previous = this.binding;
    this.binding = null;
    if (previous) stopFittingStream(previous.stream);
  }
  clear(): void {
    const hadBinding = this.binding !== null;
    this.release();
    if (hadBinding) this.publish(null);
  }
}

/** Attach only. Session code owns stopping tracks and provider work. */
export function attachFittingStreamVideo(
  video: HTMLVideoElement,
  stream: MediaStream,
  onPlaybackError: () => void = () => {},
): () => void {
  let attached = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    Promise.resolve(video.play()).catch(() => {
      if (attached && video.srcObject === stream) onPlaybackError();
    });
  } catch {
    if (attached) onPlaybackError();
  }
  return () => {
    attached = false;
    if (video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
  };
}
