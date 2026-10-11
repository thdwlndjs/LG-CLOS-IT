import type { ExternalItem, Garment, OutfitDraft } from "./core/types";

export const VTON_SLOTS = [
  "top",
  "bottom",
  "outer",
  "dress",
  "shoes",
  "accessory",
] as const;
type Slot = (typeof VTON_SLOTS)[number];
export type RequestItem = {
  kind: "OWNED" | "LIKED";
  id: string;
  slot: string;
  position: 0;
  expected_asset_id: string;
  expected_source_version?: number;
};
export type VtonRequest = {
  client_context_id: string;
  draft_id: string;
  draft_revision: number;
  person_asset_id: string;
  provider: "MOCK";
  items: RequestItem[];
};
export type VtonSnapshot = {
  request_id: string;
  member_id: string;
  client_context_id: string;
  draft_id: string;
  draft_revision: number;
  contains_liked: boolean;
  input_fingerprint: string;
  items: Array<{ kind: "OWNED" | "LIKED"; id: string; slot: string }>;
};
export type VtonResult = {
  job_id: string;
  request_snapshot: VtonSnapshot;
  result_asset: any;
  is_mock: true;
  result_semantics: "MOCK_RECEIPT_NOT_REAL_TRY_ON";
  url: string;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Selective reuse of team itemKey/deep-freeze principles; no team storage or renderer. */
export const itemKey = (item: { kind: string; id: string }) =>
  `${item.kind}:${item.id}`;
export function captureRequest(
  draft: OutfitDraft,
  garments: Garment[],
  liked: ExternalItem[],
  person: string,
  context: string,
): VtonRequest {
  const items: RequestItem[] = [];
  const slots = new Set([
    ...Object.keys(draft.items),
    ...Object.keys(draft.externalItems || {}),
  ]);
  for (const slot of slots) {
    if (!VTON_SLOTS.includes(slot as Slot))
      throw Error("지원하지 않는 시착 슬롯입니다.");
    const ownedId = draft.items[slot as Slot],
      external = draft.externalItems?.[slot as Slot];
    if (ownedId && external)
      throw Error("동일 슬롯에 품목은 한 개만 선택하세요.");
    const source = ownedId
      ? garments.find((g) => g.id === ownedId)
      : liked.find(
          (i) =>
            i.id === external?.externalItemId && i.ownerId === draft.ownerId,
        );
    if (!source?.asset?.id || source.category !== slot)
      throw Error("현재 품목과 원본 이미지를 확인하세요.");
    items.push({
      kind: ownedId ? "OWNED" : "LIKED",
      id: source.id,
      slot: slot.toUpperCase(),
      position: 0,
      expected_asset_id: source.asset.id,
      ...(ownedId
        ? { expected_source_version: (source as Garment).revision }
        : {}),
    });
  }
  const keys = items.map(itemKey);
  if (items.length > 6 || new Set(keys).size !== keys.length)
    throw Error("중복 품목입니다.");
  if (
    slots.has("dress")
      ? slots.has("top") || slots.has("bottom")
      : !(slots.has("top") && slots.has("bottom"))
  )
    throw Error("상의·하의 또는 원피스 조합을 선택하세요.");
  if (!person || items.length === 0)
    throw Error("동의된 인물 사진을 선택하세요.");
  return freeze(
    structuredClone({
      client_context_id: context,
      draft_id: draft.draftId,
      draft_revision: draft.revision,
      person_asset_id: person,
      provider: "MOCK" as const,
      items,
    }),
  );
}

export function followup(result: VtonResult | null) {
  if (!result)
    return {
      allowed: false,
      message: "먼저 입어보기를 실행해 결과를 표시하세요.",
    };
  if (result.request_snapshot.contains_liked)
    return {
      allowed: false,
      message:
        "관심 의류가 포함된 시착 결과는 착용 확정·코디카드 생성이 불가능합니다.",
    };
  return {
    allowed: true,
    jobId: result.job_id,
    snapshot: result.request_snapshot,
    message:
      "표시된 결과의 보유 의류 Snapshot을 확인했습니다. 착용 확정은 D단계, 카드 생성은 F단계 연결 대기입니다.",
  };
}

type Client = {
  get: (path: string, options?: any) => Promise<any>;
  request: (path: string, options?: any) => Promise<any>;
};
type Intent = { key: string; body: VtonRequest; jobId?: string };
/** Draft remains outside this state machine; changing it never invalidates an in-flight result. */
export class PocVtonFlow {
  readonly context = crypto.randomUUID();
  pending: Intent | null = null;
  displayed: VtonResult | null = null;
  private ambiguous: Intent | null = null;
  private closed = false;
  private abort = new AbortController();
  constructor(
    private client: Client,
    private member: string,
    private active: () => boolean,
    private loadImage: (
      job: any,
      refresh: () => Promise<any>,
    ) => Promise<string>,
    private sleep = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, ms);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(id);
            reject(Error("화면 이탈"));
          },
          { once: true },
        );
      }),
  ) {}
  private current() {
    return !this.closed && this.active();
  }
  private cancel(jobId: string) {
    // Captured original credential client, never another profile's client.
    return this.client
      .request(`/integration/vton-jobs/${jobId}/cancel`, {
        method: "POST",
        key: crypto.randomUUID(),
      })
      .catch(() => undefined);
  }
  close() {
    this.closed = true;
    this.abort.abort();
    if (this.pending?.jobId) void this.cancel(this.pending.jobId);
    this.pending = this.ambiguous = null;
    this.displayed = null;
  }
  async execute(body: VtonRequest): Promise<VtonResult | null> {
    if (this.pending || !this.current()) return null;
    const intent = this.ambiguous || {
      key: crypto.randomUUID(),
      body: freeze(structuredClone(body)),
    };
    this.pending = intent; // synchronous latch before the first await
    let terminal = false;
    try {
      const accepted = await this.client.request("/integration/vton-jobs", {
        method: "POST",
        body: intent.body,
        key: intent.key,
      });
      intent.jobId = accepted.job_id;
      if (!this.current()) {
        void this.cancel(intent.jobId!);
        return null;
      }
      let job = await this.client.get(
        `/integration/vton-jobs/${intent.jobId}`,
        { signal: this.abort.signal },
      );
      let delay = 250;
      while (["QUEUED", "RUNNING"].includes(job.status)) {
        if (!this.current()) return null;
        await this.sleep(delay, this.abort.signal);
        delay = Math.min(2000, delay * 1.5);
        job = await this.client.get(`/integration/vton-jobs/${intent.jobId}`, {
          signal: this.abort.signal,
        });
      }
      terminal = true;
      if (!this.current()) return null;
      if (job.status !== "SUCCEEDED")
        throw Error(`Mock 처리 실패 (${job.error?.code || job.status})`);
      if (
        job.job_id !== intent.jobId ||
        job.request_snapshot.request_id !== intent.jobId ||
        job.request_snapshot.member_id !== this.member ||
        job.request_snapshot.client_context_id !== this.context ||
        !job.is_mock ||
        job.result_semantics !== "MOCK_RECEIPT_NOT_REAL_TRY_ON"
      )
        throw Error("결과의 요청·프로필 연결을 확인할 수 없습니다.");
      const url = await this.loadImage(job, () =>
        this.client.get(`/integration/vton-jobs/${intent.jobId}`),
      );
      if (!this.current()) return null;
      this.displayed = freeze({ ...job, url });
      return this.displayed;
    } catch (error) {
      const e = error as any;
      if (this.current() && !terminal && (!e.status || e.status >= 500))
        this.ambiguous = intent;
      throw error;
    } finally {
      if (terminal) this.ambiguous = null;
      if (this.pending === intent) this.pending = null;
    }
  }
}
