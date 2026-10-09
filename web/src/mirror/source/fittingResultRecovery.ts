import {
  fittingSnapshotsMatch,
  selectFittingPresentation,
  type FittingCandidate,
  type FittingRequest,
  type FittingSnapshot,
} from "./mirrorScene";

export interface FittingRecoveryIdentity {
  snapshot: FittingSnapshot;
  inputFingerprint: string;
}
export interface RecoverableFittingResult {
  identity: FittingRecoveryIdentity;
  result: FittingCandidate & {
    media: { kind: "image" | "video"; url: string };
  };
  request: FittingRequest;
}

/**
 * Keeps one verified successful result only for the exact current inputs.
 * A selection, account or request-version change invalidates and releases it permanently.
 * This never starts a provider request and never relabels an old outfit as a new one.
 */
export class FittingResultRecovery {
  private retained: RecoverableFittingResult | null = null;
  constructor(private readonly releaseUrl: (url: string) => void) {}

  read(
    identity: FittingRecoveryIdentity | null,
  ): RecoverableFittingResult | null {
    if (!this.retained) return null;
    if (
      !identity ||
      !identity.inputFingerprint ||
      identity.inputFingerprint !== this.retained.identity.inputFingerprint ||
      !fittingSnapshotsMatch(identity.snapshot, this.retained.identity.snapshot)
    ) {
      this.clear();
      return null;
    }
    return structuredClone(this.retained);
  }

  replace(
    identity: FittingRecoveryIdentity,
    result: FittingCandidate,
  ): RecoverableFittingResult {
    const request: FittingRequest = {
      snapshot: structuredClone(identity.snapshot),
      status: "completed",
    };
    if (
      !identity.inputFingerprint ||
      !fittingSnapshotsMatch(identity.snapshot, result.snapshot) ||
      !result.media ||
      result.media.kind === "stream" ||
      selectFittingPresentation({ current: identity.snapshot, request, result })
        .display !== "fitting-result"
    ) {
      throw new Error(
        "현재 인물·전체 코디와 일치하는 정상 피팅 결과만 보관할 수 있습니다.",
      );
    }
    const next: RecoverableFittingResult = {
      identity: structuredClone(identity),
      result: structuredClone(result) as RecoverableFittingResult["result"],
      request,
    };
    const previousUrl = this.retained?.result.media.url;
    this.retained = next;
    if (previousUrl && previousUrl !== next.result.media.url)
      this.releaseUrl(previousUrl);
    return structuredClone(next);
  }

  clear(): void {
    const previous = this.retained;
    this.retained = null;
    if (previous) this.releaseUrl(previous.result.media.url);
  }
}
