import type { Asset, OutfitDraft } from "./core/types";
import { HttpRemoteBackend } from "./integrations/backendClient";
import {
  DecartRealtimeController,
  type RealtimeStart,
  type RealtimeLook,
} from "./integrations/decartRealtime";
import { lookupSavedFitting } from "./savedFittingLookup";
import { FittingResultRecovery } from "./fittingResultRecovery";
import { stopFittingStream } from "./fittingStreamSession";
import {
  fittingSnapshotsMatch,
  type FittingSnapshot,
  type FittingCandidate,
  type FittingRequest,
  type FittingStreamBinding,
} from "./mirrorScene";

export type MirrorExecutionMode =
  "saved_result" | "live-batch" | "live-realtime";
export interface MirrorFittingState {
  status: "idle" | "processing" | "ready" | "blocked" | "error";
  mode: MirrorExecutionMode;
  message: string;
}
export interface MirrorFittingEvents {
  onState?: (value: MirrorFittingState) => void;
  onResult?: (value: FittingCandidate | null) => void;
  onRequest?: (value: FittingRequest | null) => void;
  onStream?: (value: FittingStreamBinding | null) => void;
}
export interface MirrorInputRegistration {
  snapshot: FittingSnapshot;
  person: Asset;
  reference: Asset;
  samePersonConfirmed: true;
  fullOutfitConfirmed: true;
  transferConsent: boolean;
}
/** A client preflight declaration of EXISTING approval. The server remains authoritative. */
export interface ExistingMirrorLiveApproval {
  ownerId: string;
  approvalId: string;
  validUntilMs: number;
  perRequestUsd: number;
  totalUsd: number;
  maxGeneratedSeconds: number;
  allowedAssetVersions: Record<string, number>;
}
export interface MirrorExecutionConfiguration {
  mode: MirrorExecutionMode;
  liveApproval?: ExistingMirrorLiveApproval;
}
export interface MirrorFittingOutcome {
  status: "ready" | "processing" | "blocked" | "error" | "stale";
  message: string;
}
interface RealtimePort {
  start: (input: RealtimeStart) => Promise<{ connected: boolean }>;
  applyLook: (look: RealtimeLook) => Promise<boolean>;
  stop: () => Promise<void>;
}
export interface MirrorFittingPorts {
  request: (
    path: string,
    method: string,
    body?: unknown,
  ) => Promise<Record<string, unknown>>;
  tryOn: (
    draft: OutfitDraft,
    referenceId: string,
    personId: string,
    mode: "batch" | "realtime",
  ) => Promise<Record<string, unknown>>;
  fetch: typeof fetch;
  realtime: RealtimePort;
  openPerson: (
    asset: Asset,
  ) => Promise<{ stream: MediaStream; close: () => void }>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  now: () => number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prompt =
  "Apply the complete referenced outfit and preserve garment details, the input person and scene.";
const imageTypes = ["image/png", "image/jpeg", "image/webp"];
const outputTypes = [...imageTypes, "video/mp4", "video/webm"];
function key(snapshot: FittingSnapshot): string {
  return JSON.stringify({
    ownerId: snapshot.ownerId,
    person: snapshot.person,
    outfit: {
      ...snapshot.outfit,
      items: [...snapshot.outfit.items].sort((a, b) =>
        a.slot.localeCompare(b.slot),
      ),
    },
  });
}
function draftMatches(snapshot: FittingSnapshot, draft: OutfitDraft): boolean {
  const external = Object.entries(draft.externalItems ?? {}),
    requested = snapshot.outfit.externalItems ?? [];
  if (
    external.length !== requested.length ||
    external.some(
      ([slot, item]) =>
        draft.items[slot as keyof typeof draft.items] ||
        !requested.some(
          (row) =>
            row.slot === slot &&
            row.externalItemId === item.externalItemId &&
            row.assetId === item.assetId &&
            row.assetVersion === item.assetVersion,
        ),
    )
  )
    return false;
  const entries = Object.entries(draft.items);
  return (
    draft.ownerId === snapshot.ownerId &&
    draft.draftId === snapshot.outfit.draftId &&
    draft.revision === snapshot.outfit.revision &&
    entries.length === snapshot.outfit.items.length &&
    entries.every(([slot, id]) =>
      snapshot.outfit.items.some(
        (item) => item.slot === slot && item.garmentId === id,
      ),
    ) &&
    new Set(snapshot.outfit.items.map((item) => item.slot)).size ===
      entries.length
  );
}
function privateAsset(asset: Asset): boolean {
  return (
    asset.source === "storage" &&
    uuid.test(asset.id) &&
    Number.isSafeInteger(asset.version) &&
    asset.version > 0 &&
    !asset.needsReselection &&
    asset.url === "/api/assets/" + asset.id + "/content"
  );
}
function inputKey(input: MirrorInputRegistration): string {
  return JSON.stringify({
    look: key(input.snapshot),
    person: input.person,
    reference: input.reference,
  });
}
async function browserPerson(asset: Asset) {
  if (typeof document === "undefined")
    throw new Error("준비 영상 플레이어가 없습니다.");
  const video = document.createElement("video");
  video.hidden = true;
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.src = asset.url!;
  let stream: MediaStream | null = null;
  const close = () => {
    video.pause();
    if (stream) stopFittingStream(stream);
    video.removeAttribute("src");
    video.load();
    video.remove();
  };
  try {
    await video.play();
    const capture = (
      video as HTMLVideoElement & { captureStream?: () => MediaStream }
    ).captureStream;
    if (!capture)
      throw new Error("이 브라우저는 준비 영상 스트림을 지원하지 않습니다.");
    stream = capture.call(video);
    for (const track of stream.getAudioTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
    if (!stream.getVideoTracks().some((track) => track.readyState === "live"))
      throw new Error("재생 가능한 입력 영상이 없습니다.");
    return { stream, close };
  } catch (error) {
    close();
    throw error;
  }
}
function defaultPorts(): MirrorFittingPorts {
  const client = new HttpRemoteBackend();
  return {
    request: (path, method, body) => client.request(path, method, body),
    tryOn: (draft, referenceId, personId, mode) => {
      client.mode = "live";
      return client.tryOn(draft, referenceId, personId, mode);
    },
    fetch: (...args) => fetch(...args),
    realtime: new DecartRealtimeController(),
    openPerson: browserPerson,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    now: Date.now,
  };
}
interface Work {
  snapshot: FittingSnapshot;
  draft: OutfitDraft;
  generation: number;
  resolve: (value: MirrorFittingOutcome) => void;
}
interface Session {
  operationId: string;
  mode: "live-batch" | "live-realtime";
  snapshot: FittingSnapshot;
  draft: OutfitDraft;
  inputs: MirrorInputRegistration;
  absoluteEndMs: number;
  input: { stream: MediaStream; close: () => void } | null;
  remote: MediaStream | null;
  detach: Array<() => void>;
  applied: boolean;
  providerReady?: boolean;
}

/**
 * Direct tap bridge. All local configuration is memory-only; it cannot grant server permission.
 * No provider call occurs on import, registration, reconciliation, subscription or saved-result miss.
 */
export class MirrorFittingController {
  private readonly ports: MirrorFittingPorts;
  private readonly listeners = new Set<MirrorFittingEvents>();
  private readonly inputs = new Map<string, MirrorInputRegistration>();
  private readonly recovery: FittingResultRecovery;
  private configuration: MirrorExecutionConfiguration = {
    mode: "saved_result",
  };
  private selected: FittingSnapshot | null = null;
  private generation = 0;
  private pending: Work | null = null;
  private draining = false;
  private submission: {
    key: string;
    promise: Promise<MirrorFittingOutcome>;
  } | null = null;
  private session: Session | null = null;
  private stopping: Promise<void> = Promise.resolve();
  private readonly stoppedOperations = new Set<string>();
  private context: { ownerId: string; repository: object } | null = null;
  private contextVersion = 0;
  private readonly existingOperations = new Map<
    string,
    { operationId: string; providerReady: boolean }
  >();
  private pollTimers: unknown[] = [];
  private pollEpoch = 0;
  private polling = false;
  constructor(events: MirrorFittingEvents = {}, ports?: MirrorFittingPorts) {
    this.ports = ports ?? defaultPorts();
    this.listeners.add(events);
    this.recovery = new FittingResultRecovery((url) =>
      this.ports.revokeObjectURL(url),
    );
  }
  getCurrentOperation(): {
    operationId: string;
    mode: "live-batch" | "live-realtime";
  } | null {
    return this.session
      ? { operationId: this.session.operationId, mode: this.session.mode }
      : null;
  }
  subscribe(events: MirrorFittingEvents): () => void {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }
  private emit<K extends keyof MirrorFittingEvents>(
    event: K,
    value: Parameters<NonNullable<MirrorFittingEvents[K]>>[0],
  ) {
    for (const listener of this.listeners)
      (listener[event] as ((value: unknown) => void) | undefined)?.(value);
  }
  private state(status: MirrorFittingState["status"], message: string) {
    this.emit("onState", { status, mode: this.configuration.mode, message });
  }
  registerInputs(value: MirrorInputRegistration): void {
    if (
      value.samePersonConfirmed !== true ||
      value.fullOutfitConfirmed !== true ||
      !privateAsset(value.person) ||
      !privateAsset(value.reference)
    )
      throw new Error(
        "동일 인물·전체 코디 확인과 비공개 입력 자산이 필요합니다.",
      );
    const snapshot = value.snapshot;
    if (
      !snapshot.ownerId ||
      !snapshot.person.assetId ||
      !Number.isSafeInteger(snapshot.person.assetVersion) ||
      snapshot.person.assetVersion < 1 ||
      !(
        snapshot.outfit.items.length +
        (snapshot.outfit.externalItems?.length ?? 0)
      )
    )
      throw new Error("전체 코디 입력 참조가 올바르지 않습니다.");
    const previous = this.inputs.get(key(snapshot));
    this.inputs.set(key(snapshot), structuredClone(value));
    if (
      previous &&
      this.selected &&
      key(this.selected) === key(snapshot) &&
      (inputKey(previous) !== inputKey(value) ||
        (previous.transferConsent && !value.transferConsent))
    )
      void this.stop();
    if (
      this.session &&
      key(this.session.snapshot) === key(snapshot) &&
      (!value.transferConsent ||
        inputKey(value) !== inputKey(this.session.inputs))
    )
      void this.stop();
  }
  unregisterInputs(snapshot: FittingSnapshot): void {
    this.inputs.delete(key(snapshot));
    if (this.selected && key(this.selected) === key(snapshot)) void this.stop();
  }
  configureExecution(value: MirrorExecutionConfiguration): Promise<void> {
    this.configuration = structuredClone(value);
    return this.stop();
  }
  /** Preserve prepared inputs across SPA surfaces; a real account/repository change invalidates them. */
  bindContext(ownerId: string, repositoryIdentity: object): void {
    if (
      this.context?.ownerId === ownerId &&
      this.context.repository === repositoryIdentity
    )
      return;
    const changed = this.context !== null;
    this.context = { ownerId, repository: repositoryIdentity };
    ++this.contextVersion;
    if (changed) void this.reset();
  }
  /** Reads existing server authorization only. This never reserves budget or starts generation. */
  async prepareExecution(
    snapshot: FittingSnapshot,
    draft: OutfitDraft,
    mode: "batch" | "realtime" = "batch",
    isCurrent: () => boolean = () => true,
  ): Promise<MirrorFittingOutcome> {
    const input = this.inputs.get(key(snapshot)),
      contextVersion = this.contextVersion,
      generation = this.generation;
    if (!input || !draftMatches(snapshot, draft) || !input.transferConsent)
      return {
        status: "blocked",
        message: "정확한 인물·전체 코디 입력과 전송 동의를 먼저 확인해 주세요.",
      };
    const configuredCurrent = () =>
      isCurrent() &&
      contextVersion === this.contextVersion &&
      this.inputs.has(key(snapshot)) &&
      inputKey(this.inputs.get(key(snapshot))!) === inputKey(input) &&
      (!this.selected || key(this.selected) === key(snapshot));
    const current = () =>
      isCurrent() &&
      contextVersion === this.contextVersion &&
      generation === this.generation &&
      this.inputs.has(key(snapshot)) &&
      inputKey(this.inputs.get(key(snapshot))!) === inputKey(input);
    const response = await this.ports.request("/api/try-on/preflight", "POST", {
      draft,
      snapshot,
      person_asset_id: input.person.id,
      person_asset_version: input.person.version,
      reference_asset_id: input.reference.id,
      reference_asset_version: input.reference.version,
      fitting_mode: mode,
    });
    if (!current())
      return {
        status: "stale",
        message: "변경된 입력의 실행 조건은 연결하지 않았습니다.",
      };
    if (response.status === "existing_operation") {
      const operation = response.existingOperation as
        | {
            operationId?: string;
            processingStatus?: string;
            providerReady?: boolean;
          }
        | undefined;
      if (
        response.mode !== "live-batch" ||
        mode !== "batch" ||
        response.noExecution !== true ||
        !fittingSnapshotsMatch(
          response.snapshot as FittingSnapshot,
          snapshot,
        ) ||
        response.personAssetId !== input.person.id ||
        response.personAssetVersion !== input.person.version ||
        response.referenceAssetId !== input.reference.id ||
        response.referenceAssetVersion !== input.reference.version ||
        !operation?.operationId ||
        !uuid.test(operation.operationId) ||
        typeof operation.providerReady !== "boolean"
      )
        throw new Error("복구할 원 작업이 현재 전체 입력과 일치하지 않습니다.");
      if (
        this.session?.mode === "live-batch" &&
        this.session.operationId === operation.operationId &&
        fittingSnapshotsMatch(this.session.snapshot, snapshot) &&
        inputKey(this.session.inputs) === inputKey(input)
      ) {
        const message =
          "현재 연결된 동일 배치 작업을 유지합니다. 새 생성이나 종료 요청은 하지 않습니다.";
        this.state("processing", message);
        return { status: "ready", message };
      }

      await this.configureExecution({ mode: "live-batch" });
      if (!configuredCurrent())
        return {
          status: "stale",
          message: "변경된 계정의 원 작업은 연결하지 않았습니다.",
        };
      this.existingOperations.set(inputKey(input), {
        operationId: operation.operationId,
        providerReady: operation.providerReady,
      });
      const message =
        "동일 입력의 원 배치 작업을 연결했습니다. 다음 선택에서 원 작업만 확인합니다.";
      this.state("ready", message);
      return { status: "ready", message };
    }

    if (response.status !== "ready") {
      await this.configureExecution({ mode: "saved_result" });
      const message =
        typeof response.message === "string"
          ? response.message
          : "기존 실행 조건을 확인하지 못했습니다.";
      this.state("blocked", message);
      return { status: "blocked", message };
    }
    if (
      response.mode !== "live-batch" ||
      mode !== "batch" ||
      response.noExecution !== true ||
      !fittingSnapshotsMatch(response.snapshot as FittingSnapshot, snapshot) ||
      response.personAssetId !== input.person.id ||
      response.personAssetVersion !== input.person.version ||
      response.referenceAssetId !== input.reference.id ||
      response.referenceAssetVersion !== input.reference.version
    )
      throw new Error(
        "실행 조건이 현재 인물·전체 코디 입력과 일치하지 않습니다.",
      );
    const approval = response.approval as
      ExistingMirrorLiveApproval | undefined;
    const budget = response.budget as
      | {
          remainingUsd?: number;
          remainingSeconds?: number;
          estimatedUsd?: number;
        }
      | undefined;
    if (
      !approval ||
      approval.ownerId !== snapshot.ownerId ||
      !budget ||
      !Number.isFinite(budget.remainingUsd) ||
      !Number.isFinite(budget.estimatedUsd) ||
      budget.remainingUsd! < budget.estimatedUsd! ||
      !Number.isSafeInteger(budget.remainingSeconds) ||
      budget.remainingSeconds! <= 0
    )
      throw new Error("남은 배치 실행 한도를 확인하지 못했습니다.");
    this.existingOperations.delete(inputKey(input));
    await this.configureExecution({
      mode: "live-batch",
      liveApproval: approval,
    });
    if (!configuredCurrent())
      return {
        status: "stale",
        message: "변경된 계정의 실행 조건은 연결하지 않았습니다.",
      };
    const reason = this.gate(input);
    if (reason) {
      await this.configureExecution({ mode: "saved_result" });
      this.state("blocked", reason);
      return { status: "blocked", message: reason };
    }
    const message =
      "검증된 배치 실행 조건을 미러에 연결했습니다. 아직 실행하지 않았습니다.";
    this.state("ready", message);
    return { status: "ready", message };
  }

  private clearPresentation() {
    this.emit("onStream", null);
    this.emit("onResult", null);
    this.emit("onRequest", null);
  }
  private identity(snapshot: FittingSnapshot, input: MirrorInputRegistration) {
    return { snapshot, inputFingerprint: inputKey(input) };
  }
  private current(work: Work): boolean {
    return (
      work.generation === this.generation &&
      fittingSnapshotsMatch(work.snapshot, this.selected)
    );
  }
  reconcile(snapshot: FittingSnapshot | null): void {
    if (fittingSnapshotsMatch(snapshot, this.selected)) return;
    const previous = this.selected;
    this.selected = snapshot ? structuredClone(snapshot) : null;
    ++this.generation;
    this.submission = null;
    this.clearPresentation();
    this.recovery.clear();
    if (this.pending) {
      this.pending.resolve({
        status: "stale",
        message: "선택이 변경되었습니다.",
      });
      this.pending = null;
    }
    // Reconciliation alone must not retain a billable session while another screen is shown.
    if (this.session) void this.shutdown();
    if (!snapshot || (previous && previous.ownerId !== snapshot.ownerId)) {
      this.inputs.clear();
      this.existingOperations.clear();
      this.configuration = { mode: "saved_result" };
    }
  }
  submitSelected(
    snapshot: FittingSnapshot,
    draft: OutfitDraft,
  ): Promise<MirrorFittingOutcome> {
    const existingInput = this.inputs.get(key(snapshot));
    const submissionKey = JSON.stringify({
      snapshot,
      draft,
      mode: this.configuration.mode,
      input: existingInput && inputKey(existingInput),
    });
    if (
      this.submission?.key === submissionKey &&
      fittingSnapshotsMatch(snapshot, this.selected)
    ) {
      if (this.session?.mode === "live-batch" && !this.polling)
        this.startBatchPolling(this.session);
      return this.submission.promise;
    }
    const workSnapshot = structuredClone(snapshot);
    this.selected = workSnapshot;
    const generation = ++this.generation;
    const registration = this.inputs.get(key(snapshot));
    if (
      !registration ||
      !this.recovery.read(this.identity(snapshot, registration))
    )
      this.clearPresentation();
    else this.emit("onStream", null);
    if (this.pending)
      this.pending.resolve({
        status: "stale",
        message: "더 최근 후보로 대체되었습니다.",
      });
    const promise = new Promise<MirrorFittingOutcome>((resolve) => {
      this.pending = {
        snapshot: workSnapshot,
        draft: structuredClone(draft),
        generation,
        resolve,
      };
    });
    this.submission = { key: submissionKey, promise };
    void promise.then((outcome) => {
      if (
        this.submission?.promise === promise &&
        !["ready", "processing"].includes(outcome.status)
      )
        this.submission = null;
    });
    if (!this.draining) void this.drain();
    return promise;
  }
  /** Explicit retry; ordinary repeated taps reuse the same submitted request. */
  retrySelected(
    snapshot: FittingSnapshot,
    draft: OutfitDraft,
  ): Promise<MirrorFittingOutcome> {
    this.submission = null;
    return this.submitSelected(snapshot, draft);
  }
  private async drain() {
    this.draining = true;
    try {
      while (this.pending) {
        const work = this.pending;
        this.pending = null;
        const outcome = await this.perform(work);
        work.resolve(outcome);
      }
    } finally {
      this.draining = false;
    }
  }
  private async stopOperation(id: string) {
    if (this.stoppedOperations.has(id)) return;
    this.stoppedOperations.add(id);
    try {
      await this.ports.request("/api/try-on/" + id + "/stop", "POST", {});
    } catch {
      this.stoppedOperations.delete(id);
    }
  }
  private shutdown(): Promise<void> {
    this.clearPolling();
    const session = this.session;
    this.session = null;
    if (session) {
      session.detach.splice(0).forEach((detach) => detach());
      session.input?.close();
      if (session.remote) stopFittingStream(session.remote);
    }
    this.stopping = this.stopping
      .catch(() => undefined)
      .then(async () => {
        await this.ports.realtime.stop().catch(() => undefined);
        if (session) await this.stopOperation(session.operationId);
      });
    return this.stopping;
  }
  async stop(): Promise<void> {
    const stoppedGeneration = ++this.generation;
    this.selected = null;
    this.submission = null;
    if (this.pending) {
      this.pending.resolve({
        status: "stale",
        message: "연결이 종료되었습니다.",
      });
      this.pending = null;
    }
    this.recovery.clear();
    this.clearPresentation();
    await this.shutdown();
    if (this.generation === stoppedGeneration)
      this.state("idle", "연결을 종료했습니다.");
  }
  async reset(): Promise<void> {
    this.inputs.clear();
    this.existingOperations.clear();
    this.configuration = { mode: "saved_result" };
    await this.stop();
  }
  private gate(input: MirrorInputRegistration): string | null {
    const approval = this.configuration.liveApproval;
    if (!input.transferConsent)
      return "선택한 입력의 공급자 전송 동의가 없습니다.";
    if (
      !approval ||
      approval.ownerId !== input.snapshot.ownerId ||
      !uuid.test(approval.approvalId) ||
      !Number.isFinite(approval.validUntilMs) ||
      approval.validUntilMs <= this.ports.now() ||
      !Number.isFinite(approval.perRequestUsd) ||
      approval.perRequestUsd <= 0 ||
      !Number.isFinite(approval.totalUsd) ||
      approval.totalUsd < approval.perRequestUsd ||
      !Number.isSafeInteger(approval.maxGeneratedSeconds) ||
      approval.maxGeneratedSeconds <= 0
    )
      return "기존 실행 승인과 유효한 비용·시간 상한이 필요합니다.";
    const versions = [
      input.person,
      input.reference,
      ...[
        ...input.snapshot.outfit.items,
        ...(input.snapshot.outfit.externalItems ?? []),
      ].map((row) => ({ id: row.assetId, version: row.assetVersion })),
    ];
    if (
      versions.some(
        (asset) => approval.allowedAssetVersions[asset.id] !== asset.version,
      )
    )
      return "현재 전체 코디 입력의 자산 버전이 기존 승인에 포함되어 있지 않습니다.";
    return null;
  }
  private async reference(input: MirrorInputRegistration): Promise<Blob> {
    const response = await this.ports.fetch(input.reference.url!, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const mime = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .toLowerCase()
      .trim();
    if (!response.ok || !imageTypes.includes(mime))
      throw new Error("확인된 전체 코디 참조 이미지를 읽지 못했습니다.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("전체 코디 참조가 비어 있습니다.");
    return blob;
  }
  private restore(work: Work, input: MirrorInputRegistration): boolean {
    const retained = this.recovery.read(this.identity(work.snapshot, input));
    if (!retained || !this.current(work)) return false;
    this.emit("onResult", retained.result);
    this.emit("onRequest", retained.request);
    return true;
  }
  private async perform(work: Work): Promise<MirrorFittingOutcome> {
    const stale = (): MirrorFittingOutcome => ({
      status: "stale",
      message: "이전 선택의 결과는 적용하지 않았습니다.",
    });
    if (!this.current(work)) return stale();
    const input = this.inputs.get(key(work.snapshot));
    if (!input || !draftMatches(work.snapshot, work.draft)) {
      await this.shutdown();
      if (!this.current(work)) return stale();
      this.state(
        "blocked",
        "현재 인물·전체 코디와 확인된 입력 자산을 먼저 연결해 주세요.",
      );
      return { status: "blocked", message: "정확한 입력 자산 미등록" };
    }
    const existing = this.existingOperations.get(inputKey(input));
    if (existing) {
      await this.shutdown();
      if (!this.current(work)) return stale();
      const session: Session = {
        operationId: existing.operationId,
        mode: "live-batch",
        snapshot: work.snapshot,
        draft: work.draft,
        inputs: input,
        absoluteEndMs: 0,
        input: null,
        remote: null,
        detach: [],
        applied: false,
        providerReady: existing.providerReady,
      };
      this.session = session;
      this.emit("onRequest", { snapshot: work.snapshot, status: "processing" });
      this.state(
        "processing",
        "원 배치 작업을 재확인합니다. 새 유료 생성은 하지 않습니다.",
      );
      this.startBatchPolling(session);
      return { status: "processing", message: "원 배치 작업 재확인" };
    }

    const mode = this.configuration.mode;
    if (mode !== "saved_result") {
      const reason = this.gate(input);
      if (reason) {
        await this.shutdown();
        if (!this.current(work)) return stale();
        this.state("blocked", reason);
        return { status: "blocked", message: reason };
      }
    }
    this.state(
      "processing",
      mode === "saved_result"
        ? "일치하는 저장 결과를 확인합니다."
        : "승인된 실행 조건을 확인합니다.",
    );
    this.emit("onRequest", { snapshot: work.snapshot, status: "processing" });
    try {
      if (mode === "saved_result") {
        await this.shutdown();
        if (!this.current(work)) return stale();
        const found = await lookupSavedFitting(
          {
            draft: work.draft,
            snapshot: work.snapshot,
            person: input.person,
            reference: input.reference,
          },
          {
            request: this.ports.request,
            fetch: this.ports.fetch,
            isCurrent: () => this.current(work),
          },
        );
        if (!this.current(work) || found.status === "stale") return stale();
        if (found.status === "unavailable") {
          const restored = this.restore(work, input);
          if (!restored)
            this.emit("onRequest", {
              snapshot: work.snapshot,
              status: "unavailable",
            });
          this.state(
            "blocked",
            found.message + (restored ? " 이전 정상 결과를 유지합니다." : ""),
          );
          return { status: "blocked", message: found.message };
        }
        const url = this.ports.createObjectURL(found.blob);
        const result: FittingCandidate = {
          snapshot: work.snapshot,
          status: "ready",
          content: "fitting-result",
          origin: "saved",
          operationId: found.operationId,
          resultId: found.resultId,
          media: { kind: found.mediaKind, url },
        };
        try {
          this.recovery.replace(this.identity(work.snapshot, input), result);
        } catch (error) {
          this.ports.revokeObjectURL(url);
          throw error;
        }
        this.emit("onResult", result);
        this.emit("onRequest", {
          snapshot: work.snapshot,
          status: "completed",
        });
        this.state("ready", "저장된 피팅 결과 · 새 공급자 실행 없음");
        return { status: "ready", message: "저장된 피팅 결과" };
      }
      if (mode === "live-realtime" && this.canApplyTop(work, input))
        return await this.applyTop(work, input);
      await this.shutdown();
      if (!this.current(work)) return stale();
      const image =
        mode === "live-realtime" ? await this.reference(input) : null;
      if (!this.current(work)) return stale();
      const opened =
        mode === "live-realtime"
          ? await this.ports.openPerson(input.person)
          : null;
      if (!this.current(work)) {
        opened?.close();
        return stale();
      }
      let response: Record<string, unknown>;
      try {
        response = await this.ports.tryOn(
          work.draft,
          input.reference.id,
          input.person.id,
          mode === "live-batch" ? "batch" : "realtime",
        );
      } catch (error) {
        opened?.close();
        throw error;
      }
      const id =
        typeof response.operation_id === "string" &&
        uuid.test(response.operation_id)
          ? response.operation_id
          : null;
      if (!this.current(work)) {
        opened?.close();
        if (id) await this.stopOperation(id);
        return stale();
      }
      if (!id || response.mode !== "live") {
        opened?.close();
        if (id) await this.stopOperation(id);
        throw new Error("실제 실행 접수 상태가 확인되지 않았습니다.");
      }
      const result = response.result as Record<string, unknown> | undefined;
      const absoluteEndMs =
        mode === "live-realtime"
          ? Date.parse(String(result?.absolute_end_at))
          : 0;
      if (
        mode === "live-realtime" &&
        (!Number.isFinite(absoluteEndMs) ||
          absoluteEndMs <= this.ports.now() ||
          absoluteEndMs >
            this.ports.now() +
              this.configuration.liveApproval!.maxGeneratedSeconds * 1000 ||
          absoluteEndMs > this.configuration.liveApproval!.validUntilMs)
      ) {
        opened?.close();
        await this.stopOperation(id);
        throw new Error("검증된 세션 종료 상한이 없습니다.");
      }
      const session: Session = {
        operationId: id,
        mode,
        snapshot: work.snapshot,
        draft: work.draft,
        inputs: input,
        absoluteEndMs,
        input: opened,
        remote: null,
        detach: [],
        applied: mode === "live-realtime",
      };
      this.session = session;
      if (mode === "live-batch") {
        this.state(
          "processing",
          "배치 요청 접수 · 원 작업 상태와 결과를 확인합니다.",
        );
        this.startBatchPolling(session);
        return { status: "processing", message: "배치 요청 접수" };
      }
      const started = await this.ports.realtime.start({
        operationId: id,
        absoluteEndMs,
        maxReconnects: 0,
        inputStream: opened!.stream,
        look: {
          revision: work.draft.revision,
          prompt,
          image: image!,
          enhance: true,
        },
        requestToken: async (operationId, signal) => {
          const response = await this.ports.fetch(
            "/api/try-on/" + operationId + "/token",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
              signal,
              credentials: "same-origin",
            },
          );
          const value = await response.json();
          if (!response.ok)
            throw new Error(value.error?.message ?? "토큰 발급 불가");
          return value;
        },
        onRemoteStream: (stream) => this.receiveStream(session, stream),
        onState: (state) => {
          if (
            this.session === session &&
            fittingSnapshotsMatch(this.selected, session.snapshot)
          )
            this.state("processing", state);
        },
        onStopped: async (operationId) => {
          if (this.session === session) {
            this.session = null;
            this.submission = null;
            ++this.generation;
            session.detach.splice(0).forEach((detach) => detach());
            session.input?.close();
            if (session.remote) stopFittingStream(session.remote);
            this.clearPresentation();
            this.state(
              "idle",
              "실시간 세션이 종료되었습니다. 다시 선택하기 전에는 재실행하지 않습니다.",
            );
          }
          await this.stopOperation(operationId);
        },
      });
      if (!this.current(work) || this.session !== session) {
        await this.shutdown();
        return stale();
      }
      if (!started.connected)
        throw new Error("실시간 연결이 확인되지 않았습니다.");
      this.publishStream(session);
      return {
        status: "processing",
        message: "실시간 연결 · 영상 프레임 확인 대기",
      };
    } catch (error) {
      if (!this.current(work)) return stale();
      await this.shutdown();
      if (!this.current(work)) return stale();
      const restored = this.restore(work, input),
        message =
          error instanceof Error
            ? error.message
            : "피팅 요청을 확인하지 못했습니다.";
      if (!restored) {
        this.emit("onResult", null);
        this.emit("onRequest", {
          snapshot: work.snapshot,
          status: "unavailable",
        });
      }
      this.state(
        "error",
        message + (restored ? " 이전 정상 결과를 유지합니다." : ""),
      );
      return { status: "error", message };
    }
  }
  private canApplyTop(work: Work, input: MirrorInputRegistration): boolean {
    const session = this.session;
    if (
      !session ||
      session.mode !== "live-realtime" ||
      session.absoluteEndMs <= this.ports.now() ||
      session.snapshot.ownerId !== work.snapshot.ownerId ||
      session.snapshot.person.assetId !== work.snapshot.person.assetId ||
      session.snapshot.person.assetVersion !==
        work.snapshot.person.assetVersion ||
      session.inputs.person.id !== input.person.id ||
      session.inputs.person.version !== input.person.version ||
      session.draft.draftId !== work.draft.draftId ||
      work.draft.revision <= session.draft.revision
    )
      return false;
    const withoutTop = (snapshot: FittingSnapshot) =>
      JSON.stringify(
        [...snapshot.outfit.items, ...(snapshot.outfit.externalItems ?? [])]
          .filter((row) => row.slot !== "top")
          .sort((a, b) => a.slot.localeCompare(b.slot)),
      );
    return (
      withoutTop(session.snapshot) === withoutTop(work.snapshot) &&
      [
        ...work.snapshot.outfit.items,
        ...(work.snapshot.outfit.externalItems ?? []),
      ].some((row) => row.slot === "top")
    );
  }
  private async applyTop(
    work: Work,
    input: MirrorInputRegistration,
  ): Promise<MirrorFittingOutcome> {
    const session = this.session!;
    session.applied = false;
    this.emit("onStream", null);
    this.emit("onResult", null);
    const response = await this.ports.request(
      "/api/try-on/" + session.operationId + "/look",
      "PATCH",
      { draft: work.draft, reference_asset_id: input.reference.id },
    );
    if (!this.current(work) || this.session !== session)
      return { status: "stale", message: "더 최근 후보로 대체되었습니다." };
    if (
      response.operation_id !== session.operationId ||
      response.processing_status !== "look_ready" ||
      response.apply_status !== "not_applied" ||
      response.draft_revision !== work.draft.revision ||
      response.reference_asset_id !== input.reference.id ||
      response.reference_asset_version !== input.reference.version ||
      Date.parse(String(response.absolute_end_at)) !== session.absoluteEndMs
    )
      throw new Error("전체 코디 참조의 서버 검증이 일치하지 않습니다.");
    const image = await this.reference(input);
    if (!this.current(work) || this.session !== session)
      return { status: "stale", message: "더 최근 후보로 대체되었습니다." };
    const applied = await this.ports.realtime.applyLook({
      revision: work.draft.revision,
      prompt,
      image,
      enhance: true,
    });
    if (!this.current(work) || this.session !== session)
      return {
        status: "stale",
        message: "이전 후보 적용 완료는 표시하지 않았습니다.",
      };
    if (!applied)
      throw new Error("현재 세션의 전체 코디 전환을 확인하지 못했습니다.");
    session.snapshot = work.snapshot;
    session.draft = work.draft;
    session.inputs = input;
    session.applied = true;
    this.publishStream(session);
    this.state(
      "processing",
      "현재 전체 코디 참조 전송 완료 · 실시간 의류 표현은 확인이 필요합니다.",
    );
    return {
      status: "processing",
      message: "현재 세션의 전체 코디 참조 전송 완료",
    };
  }
  private receiveStream(session: Session, stream: MediaStream | null): void {
    if (this.session !== session) {
      if (stream) stopFittingStream(stream);
      return;
    }
    session.detach.splice(0).forEach((detach) => detach());
    if (session.remote && session.remote !== stream)
      stopFittingStream(session.remote);
    session.remote = stream;
    if (!stream) {
      this.emit("onStream", null);
      this.emit("onResult", null);
      return;
    }
    const ended = () => {
      if (
        !stream.getVideoTracks().some((track) => track.readyState === "live") &&
        this.session === session
      )
        void this.stop();
    };
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", ended);
      session.detach.push(() => track.removeEventListener("ended", ended));
    }
    this.publishStream(session);
  }
  private publishStream(session: Session): void {
    if (
      this.session !== session ||
      !session.applied ||
      !session.remote?.active ||
      !session.remote
        .getVideoTracks()
        .some((track) => track.readyState === "live") ||
      !fittingSnapshotsMatch(session.snapshot, this.selected)
    )
      return;
    this.emit("onStream", {
      stream: session.remote,
      snapshot: structuredClone(session.snapshot),
      operationId: session.operationId,
    });
    this.emit("onResult", {
      snapshot: structuredClone(session.snapshot),
      status: "ready",
      origin: "provider-realtime",
      content: "fitting-result",
      operationId: session.operationId,
      media: { kind: "stream", streamId: session.operationId },
    });
    this.emit("onRequest", {
      snapshot: structuredClone(session.snapshot),
      status: "processing",
    });
  }
  private clearPolling(): void {
    ++this.pollEpoch;
    for (const timer of this.pollTimers)
      (
        this.ports.cancelSchedule ??
        ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
      )(timer);
    this.pollTimers = [];
    this.polling = false;
  }
  private startBatchPolling(session: Session): void {
    this.clearPolling();
    this.polling = true;
    const epoch = this.pollEpoch,
      generation = this.generation,
      started = this.ports.now();
    let attempts = 0;
    const current = () =>
      this.polling &&
      epoch === this.pollEpoch &&
      generation === this.generation &&
      this.session === session &&
      fittingSnapshotsMatch(session.snapshot, this.selected);
    const schedule = (callback: () => void, ms: number) => {
      this.pollTimers.push(
        (this.ports.schedule ?? ((fn, delay) => setTimeout(fn, delay)))(
          callback,
          ms,
        ),
      );
    };
    const timeout = () => {
      if (!current()) return;
      this.clearPolling();
      this.state(
        "blocked",
        "배치 결과는 아직 확인 중입니다. 60초·최대 30회 조회를 마쳤습니다. 같은 코디를 다시 선택하면 원 작업만 재확인하며 새 생성은 하지 않습니다.",
      );
    };
    const poll = async () => {
      if (!current()) return;
      if (attempts >= 30 || this.ports.now() - started >= 60000) {
        timeout();
        return;
      }
      attempts++;
      try {
        if (session.providerReady === false) {
          const operation = await this.ports.request(
            "/api/operations/" + session.operationId,
            "GET",
          );
          if (!current()) return;
          if (operation.operation_id !== session.operationId)
            throw new Error("접수 확인 중인 원 작업이 일치하지 않습니다.");
          if (
            operation.processing_status === "succeeded" &&
            operation.result_asset_id
          ) {
            session.providerReady = true;
          } else if (
            typeof operation.provider_id === "string" &&
            operation.provider_id
          ) {
            session.providerReady = true;
          } else {
            if (
              ["failed", "cancelled"].includes(
                String(operation.processing_status),
              )
            ) {
              this.clearPolling();
              this.state(
                "error",
                "원 작업의 접수가 완료되지 않았습니다. 새 생성은 자동으로 재시도하지 않습니다.",
              );
              return;
            }
            this.state(
              "processing",
              "원 작업의 공급자 접수 여부를 확인 중입니다. 새 생성은 하지 않습니다.",
            );
            if (current())
              schedule(() => {
                void poll();
              }, 2000);
            return;
          }
        }

        const status = await this.ports.request(
          "/api/try-on/" + session.operationId + "/status",
          "GET",
        );
        if (!current()) return;
        if (status.operation_id !== session.operationId)
          throw new Error("원 배치 작업의 상태가 일치하지 않습니다.");
        if (
          ["failed", "cancelled"].includes(String(status.processing_status))
        ) {
          this.clearPolling();
          this.state(
            "error",
            "원 배치 작업이 완료되지 않았습니다. 새 유료 실행은 자동으로 재시도하지 않습니다.",
          );
          return;
        }
        const detail = status.result as Record<string, unknown> | undefined;
        if (
          status.processing_status === "succeeded" ||
          status.file_status === "acquired" ||
          detail?.provider_status === "completed"
        ) {
          await this.loadBatchResult(current);
          if (current()) this.clearPolling();
          return;
        }
        if (current())
          schedule(() => {
            void poll();
          }, 2000);
      } catch (error) {
        if (!current()) return;
        this.clearPolling();
        this.state(
          "error",
          (error instanceof Error ? error.message : "원 배치 작업 조회 실패") +
            " 새 생성은 하지 않았습니다.",
        );
      }
    };
    schedule(timeout, 60000);
    void poll();
  }

  /** Retrieve the existing operation only; never submit another creation request. */
  async loadBatchResult(
    isAllowed: () => boolean = () => true,
  ): Promise<MirrorFittingOutcome> {
    const session = this.session,
      generation = this.generation;
    if (
      !session ||
      session.mode !== "live-batch" ||
      !fittingSnapshotsMatch(session.snapshot, this.selected)
    )
      return {
        status: "blocked",
        message: "현재 코디의 배치 작업이 없습니다.",
      };
    const current = () =>
      isAllowed() &&
      generation === this.generation &&
      this.session === session &&
      fittingSnapshotsMatch(session.snapshot, this.selected);
    try {
      const response = await this.ports.fetch(
        "/api/try-on/" + session.operationId + "/result",
        { credentials: "same-origin", cache: "no-store" },
      );
      const mime = (response.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!response.ok || !outputTypes.includes(mime))
        throw new Error("배치 결과 파일을 아직 확인하지 못했습니다.");
      const blob = await response.blob();
      if (!current()) return { status: "stale", message: "이전 배치 결과" };
      if (!blob.size) throw new Error("결과 파일이 비어 있습니다.");
      const url = this.ports.createObjectURL(blob);
      const result: FittingCandidate = {
        snapshot: session.snapshot,
        origin: "provider-batch",
        content: "fitting-result",
        status: "ready",
        operationId: session.operationId,
        media: { kind: mime.startsWith("image/") ? "image" : "video", url },
      };
      try {
        this.recovery.replace(
          this.identity(session.snapshot, session.inputs),
          result,
        );
      } catch (error) {
        this.ports.revokeObjectURL(url);
        throw error;
      }
      this.emit("onResult", result);
      this.emit("onRequest", {
        snapshot: session.snapshot,
        status: "completed",
      });
      this.state("ready", "현재 코디의 배치 결과 확보 · 재생 확인 필요");
      return { status: "ready", message: "배치 결과 확보" };
    } catch (error) {
      if (!current()) return { status: "stale", message: "이전 배치 결과" };
      const message = error instanceof Error ? error.message : "결과 확인 실패";
      this.state("error", message);
      return { status: "error", message };
    }
  }
}
