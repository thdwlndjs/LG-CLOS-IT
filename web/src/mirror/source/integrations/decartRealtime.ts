import {
  createDecartClient,
  models,
  noopLogger,
  type RealTimeClient,
  type RealTimeClientConnectOptions,
  type DecartClientOptions,
} from "@decartai/sdk";

export interface RealtimeLook {
  revision: number;
  prompt: string;
  image: Blob;
  enhance: boolean;
}
export interface RealtimeToken {
  apiKey: string;
  expiresAt: string;
  absoluteEndMs: number;
}
export interface RealtimeStart {
  operationId: string;
  absoluteEndMs: number;
  maxReconnects: number;
  inputStream: MediaStream;
  look: RealtimeLook;
  requestToken: (
    operationId: string,
    signal: AbortSignal,
  ) => Promise<RealtimeToken>;
  onRemoteStream: (stream: MediaStream | null) => void;
  onState: (state: string) => void;
  onStopped: (operationId: string) => Promise<void>;
  stopRecording?: () => void;
}
export interface RealtimeSdk {
  realtime: {
    connect(
      stream: MediaStream,
      options: RealTimeClientConnectOptions,
    ): Promise<RealTimeClient>;
  };
}
type ClientFactory = (options: DecartClientOptions) => RealtimeSdk;
/** Constructing/importing this module never requests camera access or a token. */
export class DecartRealtimeController {
  private generation = 0;
  private current: RealtimeStart | null = null;
  private client: RealTimeClient | null = null;
  private remote: MediaStream | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private detach: Array<() => void> = [];
  private lookRevision = -1;
  private updateQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly factory: ClientFactory = createDecartClient,
    private readonly now: () => number = Date.now,
  ) {}
  static cameraConstraints(): MediaStreamConstraints {
    const model = models.realtime("lucy-vton-3.6");
    return {
      audio: false,
      video: { width: model.width, height: model.height, frameRate: model.fps },
    };
  }
  async start(input: RealtimeStart) {
    if (
      this.current ||
      input.absoluteEndMs <= this.now() ||
      !Number.isInteger(input.maxReconnects) ||
      input.maxReconnects < 0 ||
      input.maxReconnects > 3 ||
      !input.inputStream.getVideoTracks().length ||
      input.inputStream.getAudioTracks().length ||
      !input.look.image.size
    )
      throw new Error("invalid_realtime_start");
    this.current = input;
    this.controller = new AbortController();
    this.lookRevision = input.look.revision;
    const generation = ++this.generation,
      abort = this.controller;
    const valid = () =>
      this.generation === generation &&
      this.current === input &&
      !abort.signal.aborted &&
      this.now() < input.absoluteEndMs;
    let dials = 0;
    const sdk = this.factory({
      realtimeBaseUrl: "wss://api3.decart.ai",
      telemetry: false,
      logger: noopLogger,
      apiKeyProvider: async () => {
        if (!valid() || dials >= input.maxReconnects + 1)
          throw new Error("realtime_limit_reached");
        dials++;
        const token = await input.requestToken(input.operationId, abort.signal);
        if (
          !valid() ||
          token.absoluteEndMs !== input.absoluteEndMs ||
          Date.parse(token.expiresAt) <= this.now()
        )
          throw new Error("realtime_stopped_or_expired");
        return token.apiKey; // Memory only; never logged or persisted.
      },
    });
    const stopSafely = () => {
      void this.stop().catch(() => input.onState("stop_confirmation_pending"));
    };
    this.timer = setTimeout(
      stopSafely,
      Math.max(0, input.absoluteEndMs - this.now()),
    );
    const onEnded = stopSafely;
    for (const track of input.inputStream.getTracks()) {
      track.addEventListener("ended", onEnded);
      this.detach.push(() => track.removeEventListener("ended", onEnded));
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", onEnded);
      this.detach.push(() => window.removeEventListener("pagehide", onEnded));
    }
    input.onState("connecting");
    try {
      const client = await sdk.realtime.connect(input.inputStream, {
        model: models.realtime("lucy-vton-3.6"),
        resolution: "720p",
        retries: 0,
        initialState: {
          prompt: { text: input.look.prompt, enhance: input.look.enhance },
          image: input.look.image,
        },
        onRemoteStream: (stream) => {
          if (!valid()) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          if (this.remote && this.remote !== stream)
            this.remote.getTracks().forEach((track) => track.stop());
          this.remote = stream;
          input.onRemoteStream(stream);
        },
        onConnectionChange: (state) => {
          if (valid()) input.onState(state);
        },
      });
      if (!valid()) {
        client.disconnect();
        return { connected: false as const };
      }
      this.client = client;
      const terminal = stopSafely;
      client.on("sessionEnded", terminal);
      client.on("error", terminal);
      this.detach.push(
        () => client.off("sessionEnded", terminal),
        () => client.off("error", terminal),
      );
      return { connected: true as const, providerSessionId: client.sessionId };
    } catch {
      if (this.generation === generation) await this.stop();
      throw new Error("realtime_connection_failed");
    }
  }
  applyLook(look: RealtimeLook): Promise<boolean> {
    if (
      !this.current ||
      !this.client ||
      look.revision <= this.lookRevision ||
      !look.image.size
    )
      return Promise.resolve(false);
    this.lookRevision = look.revision;
    const generation = this.generation;
    let applied = false;
    this.updateQueue = this.updateQueue
      .catch(() => undefined)
      .then(async () => {
        if (
          generation !== this.generation ||
          !this.client ||
          !this.current ||
          this.now() >= this.current.absoluteEndMs
        )
          return;
        // SDK set replaces the whole state: send all three values every time.
        await this.client.set({
          prompt: look.prompt,
          image: look.image,
          enhance: look.enhance,
        });
        applied = generation === this.generation;
      });
    return this.updateQueue.then(() => applied);
  }
  async stop() {
    const current = this.current;
    ++this.generation;
    this.current = null;
    this.controller?.abort();
    this.controller = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.detach.splice(0).forEach((remove) => remove());
    this.client?.disconnect();
    this.client = null;
    this.remote?.getTracks().forEach((track) => track.stop());
    this.remote = null;
    current?.inputStream.getTracks().forEach((track) => track.stop());
    current?.stopRecording?.();
    current?.onRemoteStream(null);
    current?.onState("stopped");
    if (current) await current.onStopped(current.operationId);
  }
}
