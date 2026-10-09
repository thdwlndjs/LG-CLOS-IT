/** No colour key: only model confidence affects alpha. RGB belongs to the same output frame. */
export const FOREGROUND_FRAME_INTERVAL_MS = 100;
export type ForegroundTicket = {
  contextKey: string;
  sequence: number;
  sourceTime: number;
};
export function confidenceToAlpha(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  const t = Math.max(0, Math.min(1, (confidence - 0.12) / 0.76));
  return Math.round(255 * t * t * (3 - 2 * t));
}
/** One in-flight operation; dropped inputs are never replayed using an old mask. */
export class ForegroundFrameGate {
  private sequence = 0;
  private pending: ForegroundTicket | null = null;
  private disposed = false;
  constructor(readonly contextKey: string) {}
  begin(sourceTime: number): ForegroundTicket | null {
    if (this.disposed || this.pending || !Number.isFinite(sourceTime))
      return null;
    return (this.pending = {
      contextKey: this.contextKey,
      sequence: ++this.sequence,
      sourceTime,
    });
  }
  finish(ticket: ForegroundTicket): boolean {
    if (
      this.disposed ||
      !this.pending ||
      ticket.contextKey !== this.contextKey ||
      ticket.sequence !== this.pending.sequence ||
      ticket.sourceTime !== this.pending.sourceTime
    )
      return false;
    this.pending = null;
    return true;
  }
  get busy() {
    return this.pending !== null;
  }
  dispose() {
    this.disposed = true;
    this.pending = null;
  }
}
