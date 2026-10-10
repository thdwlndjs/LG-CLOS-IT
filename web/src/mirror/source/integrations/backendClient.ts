import { createClient, assetUrl, upload, listAll } from "../../../api.js";
import { emptyUI } from "../core/seed";
import type {
  Asset,
  DemoState,
  Garment,
  Outfit,
  RegistrationDraft,
  OutfitDraft,
  SaveResult,
  DemoEvent,
  OutfitConditions,
  OutfitItems,
  CareGuide,
} from "../core/types";
import type { AvailabilityConfirmation } from "../outfitReview";
export type BackendMode = "mock" | "saved_result" | "live";
export interface BackendDiagnostic {
  stage: "auth" | "database";
  upstream_status?: number;
  upstream_code?: string;
}
export class BackendError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public diagnostic?: BackendDiagnostic,
  ) {
    super(message);
  }
}
const listeners = new Set<() => void>();
export function onBackendSessionExpired(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
let token = "",
  member: any = null,
  deviceId = "",
  stationId = "",
  stationCredential = "";
const drafts = new Map<string, RegistrationDraft | OutfitDraft>();
const receiptKeys = new Map<string, string>();
const savedResults = new Map<string, SaveResult<any>>();
const garmentVersions = new Map<string, number>();
let sessionGeneration = 0;
let httpClient: ReturnType<typeof createClient> | null = null;
let clientToken: string | null = null;
export const rawApi = () => {
  if (!httpClient || clientToken !== token) {
    clientToken = token;
    const expectedToken = token;
    httpClient = createClient(token, () => {
      if (token !== expectedToken) return;
      token = "";
      member = null;
      deviceId = "";
      sessionGeneration++;
      for (const fn of listeners) fn();
    });
  }
  return httpClient;
};
export const api = () => ({
  get: rawApi().get,
  send: (method: string, path: string, body: any, options: any = {}) =>
    rawApi().request(path, { method, body, ...options }),
});
export function currentDevice() {
  return deviceId;
}
export function currentMember() {
  return member;
}
export function bindStation(id: string, credential: string) {
  stationId = id;
  stationCredential = credential;
}
export function mapGarment(g: any): Garment {
  const knownLocation =
    !g.stale && g.location_confidence != null && g.location_confidence >= 0.9;
  return {
    id: g.id,
    ownerId: g.owner_id,
    name: g.name || `${g.color} ${g.category}`,
    category: g.category.toLowerCase(),
    color: g.color,
    features: [],
    material: g.material || "",
    size: "",
    location: knownLocation ? g.location_label || "" : "",
    careNotes: g.care_label || "",
    revision: g.version,
    asset: g.image
      ? {
          id: g.image.asset_id,
          version: 1,
          source: "storage",
          url: assetUrl(g.image.read_url),
        }
      : null,
    provenance: {
      location: knownLocation ? "user" : "unconfirmed",
      size: "unconfirmed",
      care: g.care_label ? "user" : "unconfirmed",
    },
  };
}
const mapOutfit = (o: any, garments: Garment[]): Outfit => ({
  id: o.id,
  ownerId: o.member_id,
  name: o.title,
  revision: o.version,
  items: Object.fromEntries(
    o.items.map((i: any) => [i.slot.toLowerCase(), i.garment_id]),
  ),
  assetVersions: Object.fromEntries(
    o.items.map((i: any) => [
      i.garment_id,
      garments.find((g) => g.id === i.garment_id)?.asset?.version || 0,
    ]),
  ),
});
export interface RemoteBackend {
  mode: BackendMode;
  state(): Promise<DemoState>;
  putDraft(d: RegistrationDraft | OutfitDraft): Promise<void>;
  discardDraft(d: RegistrationDraft | OutfitDraft): Promise<void>;
  saveGarment(d: RegistrationDraft, k: string): Promise<SaveResult<Garment>>;
  saveOutfit(d: OutfitDraft, k: string): Promise<SaveResult<Outfit>>;
  recordEvent(
    kind: DemoEvent["kind"],
    target: string,
    value: string,
    date: string,
    k: string,
  ): Promise<SaveResult<DemoEvent>>;
  analyze(d: RegistrationDraft): Promise<Partial<RegistrationDraft> | null>;
  recommend(
    d: OutfitDraft,
    c: OutfitConditions,
    r?: string,
    a?: AvailabilityConfirmation[],
  ): Promise<OutfitItems | null>;
  care(id: string): Promise<CareGuide>;
  tryOn(
    d: OutfitDraft,
    r?: string,
    p?: string,
    m?: "batch" | "realtime",
  ): Promise<Record<string, unknown>>;
}
export class HttpRemoteBackend implements RemoteBackend {
  mode: BackendMode = "mock";
  async request<T = unknown>(
    path: string,
    _method = "GET",
    _body?: unknown,
  ): Promise<T> {
    const match = path.match(/^\/api\/garments\/([a-f0-9-]{36})\/evidence$/i);
    if (match && _method === "GET") {
      const g: any = await api().get(`/garments/${match[1]}`);
      if (g.owner_id !== member?.id)
        throw new BackendError("forbidden", "소유자 관리 근거를 확인하세요.");
      return { ownerId: member.id, garmentId: g.id, evidence: [] } as T;
    }
    throw new BackendError(
      "unsupported_contract",
      "현재 백엔드에서 지원하지 않는 참고 구현 기능입니다.",
    );
  }
  bindSession(_id?: string) {}
  async config() {
    return {
      project_ref: "Sprint 7 FastAPI",
      database_configured: true,
      ai_mode: "mock" as BackendMode,
      live_enabled: false,
      key_present: {},
    };
  }
  async authStatus() {
    return {
      project_ref: "Sprint 7",
      email_password_enabled: true,
      email_confirmation_required: false,
    };
  }
  async signup(_email: string, _password: string): Promise<any> {
    throw new BackendError(
      "configuration_required",
      "계정은 관리자가 기존 사용자에 연결해 발급합니다.",
    );
  }
  async resendConfirmation(_email: string): Promise<any> {
    throw new BackendError(
      "configuration_required",
      "메일 가입을 제공하지 않습니다.",
    );
  }
  async login(login: string, password: string) {
    const r: any = await api().send("POST", "/integration/login", {
      login,
      password,
      ...(stationId
        ? { station_id: stationId, station_credential: stationCredential }
        : {}),
    });
    return this.acceptLogin(r);
  }
  async demoLogin() {
    bindStation("", "");
    const r: any = await api().send("POST", "/integration/demo-login", {});
    return this.acceptLogin(r);
  }
  private acceptLogin(r: any) {
    token = r.access_token;
    member = r.member;
    sessionGeneration++;
    drafts.clear();
    receiptKeys.clear();
    savedResults.clear();
    garmentVersions.clear();
    stationCredential = "";
    return { authenticated: true, user_id: member.id };
  }
  async logout() {
    try {
      if (token) await api().send("POST", "/integration/logout", {});
    } finally {
      token = "";
      member = null;
      sessionGeneration++;
      deviceId = "";
      drafts.clear();
      receiptKeys.clear();
      savedResults.clear();
      garmentVersions.clear();
    }
    return { authenticated: false, revocation: "confirmed" as const };
  }
  async session() {
    if (!token || !member) return { authenticated: false, user_id: "" };
    await api().get("/integration/devices");
    return { authenticated: true, user_id: member.id };
  }
  async state(): Promise<DemoState> {
    if (!member) throw new BackendError("unauthorized", "로그인이 필요합니다.");
    const generation = sessionGeneration;
    const account = member;
    const devices: any = await api().get("/integration/devices");
    deviceId = devices.items[0]?.id || "";
    const raw = await listAll(api(), "/garments", {});
    for (const g of raw) garmentVersions.set(g.id, g.version);
    const garments = raw
      .filter((g: any) => g.device_id === deviceId)
      .map(mapGarment);
    const rawOutfits = await listAll(api(), "/outfits", {});
    const cards: any[] = await listAll(api(), "/cards", {});
    const history: any[] = await listAll(api(), "/history", {
      timezone: "Asia/Seoul",
    });
    const careSchedules: any[] = await listAll(api(), "/care-schedules", {});
    const liked: any = await api().get("/integration/shopping/liked");
    const outfits = rawOutfits
      .filter(
        (o: any) =>
          o.status === "SAVED" ||
          cards.some((c) => c.is_saved && c.outfit_id === o.id),
      )
      .map((o: any) => mapOutfit(o, garments));
    for (const o of outfits) {
      const card = cards.find(
        (c) => c.outfit_id === o.id && c.is_saved && c.image_asset,
      );
      if (card)
        o.cardAsset = {
          id: card.image_asset.asset_id,
          version: 1,
          source: "storage",
          url: assetUrl(card.image_asset.read_url),
        };
    }

    // Project immutable server wear composition separately from mutable saved cards.
    for (const h of history.filter(
      (h) => h.kind === "WEAR" && h.status === "CONFIRMED" && h.items_snapshot,
    )) {
      const original = rawOutfits.find((o) => o.id === h.outfit_id);
      const snapshot = mapOutfit(
        {
          id: `history:${h.id}`,
          member_id: account.id,
          title: original?.title || "실제 착용 기록",
          version: original?.version || 1,
          items: h.items_snapshot,
        },
        garments,
      );
      snapshot.purpose = "wear";
      outfits.push(snapshot);
    }
    if (generation !== sessionGeneration || member !== account)
      throw new BackendError(
        "unauthorized",
        "계정이 변경되어 이전 응답을 폐기했습니다.",
      );
    const events: DemoEvent[] = history
      .filter(
        (h) =>
          ["WEAR", "CARE"].includes(h.kind) &&
          !["CANCELLED", "NOT_DONE"].includes(h.status),
      )
      .map((h) => ({
        id: h.id,
        ownerId: member.id,
        kind: h.kind === "WEAR" ? "wear" : "care",
        outfitId:
          h.kind === "WEAR" && h.items_snapshot
            ? `history:${h.id}`
            : h.outfit_id || undefined,
        garmentId: h.garment_id || undefined,
        date: h.local_date,
        value:
          h.kind === "CARE"
            ? (
                {
                  WASH: "세탁 완료",
                  DRY: "건조 완료",
                  CLEAN: "전문 관리 완료",
                } as Record<string, string>
              )[
                careSchedules.find((s) => s.care_event_id === h.id)?.care_type
              ] || h.description
            : h.description,
        occurredAt: h.occurred_at,
        timePrecision: "instant" as const,
        inputSource: "user_confirmed",
        sourceEventKey: h.id,
        garmentIds: h.items_snapshot?.map((i: any) => i.garment_id),
      }));
    const ui = emptyUI();
    ui.calendarDate = new Date().toISOString().slice(0, 10);
    ui.searchResultIds = garments.map((g) => g.id);
    const state: DemoState = {
      schemaVersion: 1,
      activeProfileId: member.id,
      profiles: [{ id: member.id, name: member.display_name }],
      garments,
      outfits,
      events,
      externalItems: liked.items.map((item: any) => ({
        id: item.id,
        ownerId: account.id,
        name: item.name,
        category: item.category.toLowerCase(),
        asset: null,
        sourceLabel: item.source_label + " · LIKED · 보유 의류 아님",
        sourceUrl: null,
      })),
      registrationDrafts: {},
      outfitDrafts: {},
      ui: { [member.id]: ui },
      receipts: [],
      intents: {},
      revisionReceipts: {},
    };
    for (const d of drafts.values()) {
      if (d.ownerId !== member.id) continue;
      if ("category" in d) state.registrationDrafts[member.id] = d;
      else state.outfitDrafts[member.id] = d;
    }
    return state;
  }
  async putDraft(d: RegistrationDraft | OutfitDraft) {
    drafts.set(d.draftId, structuredClone(d));
  }
  async discardDraft(d: RegistrationDraft | OutfitDraft) {
    drafts.delete(d.draftId);
  }
  private key(intent: string) {
    if (!receiptKeys.has(intent)) receiptKeys.set(intent, crypto.randomUUID());
    return receiptKeys.get(intent)!;
  }
  private saved<T extends Garment | Outfit | DemoEvent>(
    entity: T,
    d: any,
    intent: string,
    operation: string,
  ): SaveResult<T> {
    return {
      entity,
      replayed: false,
      receipt: {
        id: this.key(intent),
        ownerId: member.id,
        operation,
        entityId: entity.id,
        draftId: d.draftId,
        revision: d.revision,
        fingerprint: intent,
        createdAt: new Date().toISOString(),
        result: entity,
      },
    };
  }
  async saveGarment(d: RegistrationDraft, intent: string) {
    const previous = savedResults.get(intent);
    if (previous) return { ...previous, replayed: true } as SaveResult<Garment>;
    if (!deviceId) throw new Error("접근 가능한 옷장이 없습니다.");
    if (["bag", "hat"].includes(d.category))
      throw new Error("가방·모자 분류는 API 계약 결정을 확인해야 합니다.");
    const body = {
      owner_id: member.id,
      device_id: deviceId,
      name: d.name.trim() || null,
      category: d.category.toUpperCase(),
      color: d.color.trim(),
      material: d.material || null,
      care_label: d.careNotes || null,
      ...(d.manualFields.location ? { location_id: d.location || null } : {}),
      ...(d.asset ? { image_asset_id: d.asset.id } : {}),
    };
    const r: any = await api().send(
      d.savedGarmentId ? "PATCH" : "POST",
      d.savedGarmentId ? `/garments/${d.savedGarmentId}` : "/garments",
      body,
      {
        ...(d.savedGarmentId
          ? { version: garmentVersions.get(d.savedGarmentId) }
          : { key: this.key(intent) }),
      },
    );
    garmentVersions.set(r.id, r.version);
    const result = this.saved(mapGarment(r), d, intent, "saveGarment");
    savedResults.set(intent, result);
    return result;
  }
  async saveOutfit(d: OutfitDraft, intent: string) {
    const previous = savedResults.get(intent);
    if (previous) return { ...previous, replayed: true } as SaveResult<Outfit>;
    if (
      !(d.items.dress
        ? !d.items.top && !d.items.bottom
        : d.items.top && d.items.bottom)
    )
      throw new Error("상의·하의 또는 원피스를 선택하세요.");
    if (Object.keys(d.externalItems || {}).length)
      throw new Error("LIKED 상품은 코디·카드로 저장하지 않습니다.");
    const body = {
      title: d.name || "Untitled Look",
      status: "SAVED",
      items: Object.entries(d.items).map(([slot, id]) => ({
        slot: slot.toUpperCase(),
        garment_id: id,
        position: 0,
      })),
    };
    const r: any = await api().send("POST", "/outfits", body, {
      key: this.key(intent),
    });
    const garments = (await listAll(api(), "/garments", {})).map(mapGarment);
    const result = this.saved(mapOutfit(r, garments), d, intent, "saveOutfit");
    savedResults.set(intent, result);
    return result;
  }
  async recordEvent(
    _kind: DemoEvent["kind"],
    _target: string,
    _value: string,
    _date: string,
    _intent: string,
  ): Promise<SaveResult<DemoEvent>> {
    throw new Error(
      "명시적 서버 기록 API를 사용하세요. 착용 예정은 미확정 계약입니다.",
    );
  }
  async analyze(_d: RegistrationDraft) {
    return null;
  }
  async recommend(
    d: OutfitDraft,
    _c: OutfitConditions,
    _r?: string,
    _a?: AvailabilityConfirmation[],
  ) {
    if (_r)
      throw new BackendError(
        "unsupported_contract",
        "현재 API는 참고 사진 기반 재구성을 지원하지 않습니다. 보유 의류 추천을 이용하세요.",
      );
    const context: any = await api().send("POST", "/context-snapshots", {
      member_id: member.id,
      timezone: "Asia/Seoul",
      mode: "MOCK",
    });
    const r: any = await api().send("POST", "/outfit-recommendations", {
      member_id: member.id,
      context_snapshot_id: context.id,
      constraints: {},
      limit: 5,
    });
    const o = r.candidates[0]?.outfit;
    const proposed = o
      ? Object.fromEntries(
          o.items.map((i: any) => [i.slot.toLowerCase(), i.garment_id]),
        )
      : null;
    if (proposed) {
      for (const [slot, locked] of Object.entries(d.lockedSlots || {}))
        if (locked && d.items[slot as keyof OutfitItems])
          proposed[slot] = d.items[slot as keyof OutfitItems];
      if (d.topLocked && d.items.top) proposed.top = d.items.top;
    }
    return proposed;
  }
  async care(id: string): Promise<CareGuide> {
    const r: any = await api().get(`/garments/${id}/care-guide`);
    return {
      garmentId: id,
      title: "케어 가이드",
      advice: [...r.instructions, ...r.warnings].join("\n"),
      source: "provider",
      actualCareRecorded: false,
    };
  }
  async tryOn(
    _d: OutfitDraft,
    _r?: string,
    _p?: string,
    _m?: "batch" | "realtime",
  ): Promise<Record<string, unknown>> {
    throw new Error(
      "Mock 피팅 패널에서 동의된 인물 사진과 함께 실행하세요. 유료 API는 호출하지 않습니다.",
    );
  }
  async upload(
    file: File,
    kind = "garment",
    _providers: string[] = [],
  ): Promise<Asset> {
    const r: any = await upload(
      rawApi(),
      file,
      kind === "garment" ? "GARMENT" : "PERSON_VTON",
    );
    return {
      id: r.asset_id,
      version: 1,
      source: "storage",
      url: assetUrl(r.read_url),
    };
  }
}
