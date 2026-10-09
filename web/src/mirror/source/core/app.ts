import {
  clone,
  DemoError,
  DemoRepository,
  isISODate,
  stable,
} from "./repository";
import {
  completeOutfit,
  slotIsLocked,
  validateExternalSelections,
  hasExternalItems,
  sameOutfitComposition,
} from "./externalOutfits";
import { DEMO_DATE, emptyUI } from "./seed";
import {
  captureSelectionSnapshot,
  captureSelectionSubmission,
  selectionSnapshotDraft,
  selectionSnapshotIntent,
  selectionEventIntent,
  type CommitCurrentSelectionResult,
  type SelectionSubmission,
} from "./selectionScenario";
import {
  wearSnapshotDraft,
  wearSnapshotIntent,
  wearEventIntent,
  type WearCurrentOutfitResult,
} from "./wearScenario";
import { PreparedMockRunner, type MockRunner, type TryOnInput } from "./mock";
import {
  reviewGarmentIdentity,
  type AvailabilityConfirmation,
} from "../outfitReview";
import type { RemoteBackend } from "../integrations/backendClient";
import type {
  ActionOptions,
  ActionResult,
  Asset,
  CareGuide,
  Category,
  DemoEvent,
  DemoState,
  Garment,
  OperationName,
  OperationState,
  Outfit,
  OutfitConditions,
  OutfitDraft,
  OutfitItems,
  Receipt,
  RegistrationDraft,
  RegistrationField,
  SaveResult,
  Slot,
  StorageLike,
  TryOnResult,
} from "./types";

let sequence = 0;
const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
const owned = <T extends { ownerId: string }>(items: T[], ownerId: string) =>
  items.filter((item) => item.ownerId === ownerId);
const categories: Category[] = [
  "top",
  "bottom",
  "outer",
  "bag",
  "shoes",
  "hat",
  "accessory",
];
const registrationDefaults: Pick<RegistrationDraft, RegistrationField> = {
  name: "",
  category: "top",
  color: "",
  features: [],
  material: "",
  size: "",
  location: "",
  careNotes: "",
};
type ReceiptRequest<T extends { id: string }> = {
  ownerId: string;
  operation: string;
  intentKey: string;
  draftId: string;
  revision: number;
  snapshot: unknown;
  lookup: (state: DemoState, id: string) => T | undefined;
};
/** Local fixture profile only. Source package ownership remains in its unchanged import metadata. */
export interface LocalDemoProfileBundle {
  profile: { id: string; name: string };
  garments: Garment[];
  outfits: Outfit[];
  outfitDraft: OutfitDraft;
}
function matchingGarments(
  state: DemoState,
  ownerId: string,
  query: string,
  category: Category | "all",
): Garment[] {
  const normalized = query.trim().toLocaleLowerCase();
  return state.garments.filter(
    (g) =>
      (category === "all" || g.category === category) &&
      [g.name, g.color, g.location, ...g.features]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
  );
}
function refreshSearchResults(state: DemoState, ownerId: string): void {
  const ui = state.ui[ownerId];
  ui.searchResultIds = matchingGarments(
    state,
    ownerId,
    ui.query,
    ui.category,
  ).map((g) => g.id);
  if (ui.operations.search.status !== "processing")
    ui.operations.search = {
      status: ui.searchResultIds.length ? "success" : "no-result",
    };
}
function validateAsset(asset: Asset | null): void {
  if (!asset) return;
  if (
    !asset.id ||
    !Number.isInteger(asset.version) ||
    asset.version < 1 ||
    !["packaged", "upload", "storage"].includes(asset.source)
  )
    throw new DemoError("VALIDATION", "사진 참조가 올바르지 않습니다.");
  if (
    asset.url &&
    !(asset.source === "packaged"
      ? /^\/assets\/[a-zA-Z0-9._/-]+$/.test(asset.url) &&
        !asset.url.includes("..")
      : asset.source === "storage"
        ? /^\/api\/assets\/[a-f0-9-]{36}\/content$/.test(asset.url) ||
          (/^[a-f0-9-]{36}$/.test(asset.id) &&
            new RegExp(
              "^/local-storage/wardrobe-assets/assets/[a-f0-9-]{36}/[a-f0-9-]{36}/" +
                asset.id +
                "/[a-f0-9]{32}\\?",
            ).test(asset.url) &&
            !asset.url.includes(".."))
        : asset.url.startsWith("blob:"))
  )
    throw new DemoError(
      "VALIDATION",
      "프로젝트 자산 또는 현재 브라우저의 파일만 사용할 수 있습니다.",
    );
}

/** UI actions depend on these contracts only. Replace repository and prepared handlers with future adapters. */
export class DemoApp {
  private listeners = new Set<() => void>();
  private tokens: Record<string, number> = {};
  private tryOnGeneration = 0;
  private tryOnCleanups = new Set<() => void>();
  private sessionUrls = new Set<string>();
  private wearRequests = new Map<string, Promise<WearCurrentOutfitResult>>();
  private selectionRequests = new Map<
    string,
    Promise<CommitCurrentSelectionResult>
  >();
  private resetGeneration = 0;
  repository: DemoRepository;
  private localRepository?: DemoRepository;
  private remote?: RemoteBackend;
  private connectionRequest = 0;
  private draftQueue: Promise<void> = Promise.resolve();
  private draftStatus: "idle" | "saving" | "saved" | "error" = "idle";
  private draftMessage = "";
  get connection() {
    return {
      kind: this.remote ? "supabase" : "local",
      mode: this.remote?.mode ?? "mock",
      draftStatus: this.draftStatus,
      message: this.draftMessage,
    } as const;
  }
  async configureRemote(remote?: RemoteBackend) {
    const request = ++this.connectionRequest;
    if (!remote) {
      this.stopTryOn();
      this.resetGeneration++;
      this.remote = undefined;
      if (this.localRepository) this.repository = this.localRepository;
      this.localRepository = undefined;
      this.draftStatus = "idle";
      this.emit();
      return;
    }
    const next = await remote.state();
    if (request !== this.connectionRequest) return;
    this.stopTryOn();
    this.resetGeneration++;
    for (const k of Object.keys(this.tokens)) this.nextToken(k);
    this.localRepository ??= this.repository;
    this.repository = new DemoRepository(undefined, () => next);
    this.remote = remote;
    this.draftStatus = "saved";
    this.draftMessage = "";
    this.emit();
  }
  setBackendMode(mode: RemoteBackend["mode"]) {
    if (this.remote) this.remote.mode = mode;
    this.emit();
  }
  async reloadRemote() {
    if (!this.remote) return;
    await this.draftQueue;
    const remote = this.remote,
      owner = this.owner;
    const next = await remote.state();
    if (this.remote !== remote || this.owner !== owner) return;
    const ui = clone(this.ui());
    next.ui[owner] = {
      ...ui,
      searchResultIds: matchingGarments(next, owner, ui.query, ui.category).map(
        (g) => g.id,
      ),
    };
    this.repository = new DemoRepository(undefined, () => next);
    this.emit();
  }
  private makeDraftId(prefix: string) {
    return this.remote ? crypto.randomUUID() : id(prefix);
  }
  private queueDraft(draft: RegistrationDraft | OutfitDraft) {
    const remote = this.remote,
      generation = this.resetGeneration;
    if (!remote) return;
    const snapshot = clone(draft),
      current = () =>
        this.remote === remote && this.resetGeneration === generation;
    this.draftStatus = "saving";
    this.draftQueue = this.draftQueue
      .catch(() => {})
      .then(async () => {
        if (!current()) return;
        try {
          await remote.putDraft(snapshot);
          if (current()) {
            this.draftStatus = "saved";
            this.draftMessage = "";
          }
        } catch (e) {
          if (current()) {
            this.draftStatus = "error";
            this.draftMessage = (e as Error).message;
          }
        } finally {
          this.emit();
        }
      });
  }
  private applyRemoteSave<T extends Garment | Outfit | DemoEvent>(
    result: SaveResult<T>,
    kind: "garments" | "outfits" | "events",
    remote: RemoteBackend,
    generation: number,
  ) {
    if (
      this.remote !== remote ||
      this.resetGeneration !== generation ||
      result.entity.ownerId !== this.owner
    )
      return result;
    this.mutate((s) => {
      const list = s[kind] as T[];
      const index = list.findIndex((e) => e.id === result.entity.id);
      if (index < 0) list.push(result.entity);
      else if (!result.replayed) list[index] = result.entity;
      if (!s.receipts.some((r) => r.id === result.receipt.id))
        s.receipts.push(result.receipt);
      refreshSearchResults(s, this.owner);
    });
    return result;
  }
  constructor(
    storage?: StorageLike,
    seed?: () => DemoState,
    private runner: MockRunner = new PreparedMockRunner(),
  ) {
    this.repository = new DemoRepository(storage, seed);
  }
  get persistence() {
    return this.remote
      ? { status: "ready" as const }
      : this.repository.persistence;
  }
  getState = (): DemoState => this.repository.getState();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private mutate(fn: (next: DemoState) => void, durable = false) {
    const before = this.remote
      ? stable([this.registrationDraft(), this.outfitDraft()])
      : "";
    try {
      this.repository.commit(fn, durable && !this.remote);
    } finally {
      if (
        this.remote &&
        before !== stable([this.registrationDraft(), this.outfitDraft()])
      ) {
        for (const d of [this.registrationDraft(), this.outfitDraft()])
          if (d) this.queueDraft(d);
      }
      this.emit();
    }
  }
  private get owner() {
    return this.getState().activeProfileId;
  }
  garments(): Garment[] {
    return this.remote
      ? this.getState().garments
      : owned(this.getState().garments, this.owner);
  }
  outfits(): Outfit[] {
    return owned(this.getState().outfits, this.owner);
  }
  externalItems() {
    return owned(this.getState().externalItems ?? [], this.owner);
  }
  events(): DemoEvent[] {
    return owned(this.getState().events, this.owner);
  }
  receipts(): Receipt[] {
    return owned(this.getState().receipts, this.owner);
  }
  registrationDraft(): RegistrationDraft | undefined {
    return this.getState().registrationDrafts[this.owner];
  }
  outfitDraft(): OutfitDraft | undefined {
    return this.getState().outfitDrafts[this.owner];
  }
  previousOutfitDraft(): OutfitDraft | undefined {
    return this.getState().previousOutfitDrafts?.[this.owner]?.at(-1);
  }
  ui() {
    return this.getState().ui[this.owner];
  }
  garment(garmentId: string): Garment {
    const value = this.garments().find((g) => g.id === garmentId);
    if (!value)
      throw new DemoError(
        "NOT_FOUND",
        "현재 프로필에서 의류를 찾을 수 없습니다.",
      );
    return value;
  }
  outfit(outfitId: string): Outfit {
    const value = this.outfits().find((o) => o.id === outfitId);
    if (!value)
      throw new DemoError(
        "NOT_FOUND",
        "현재 프로필에서 코디를 찾을 수 없습니다.",
      );
    return value;
  }
  private nextToken(operation: string): number {
    return (this.tokens[operation] = (this.tokens[operation] ?? 0) + 1);
  }
  private status(
    ownerId: string,
    operation: OperationName,
    value: OperationState,
  ) {
    this.mutate((s) => {
      s.ui[ownerId].operations[operation] = value;
    });
  }
  private async mock(options: ActionOptions = {}) {
    await this.runner.simulate(options);
  }
  setScreen(screen: string) {
    if (screen !== "tryOn") this.stopTryOn();
    this.mutate((s) => {
      s.ui[this.owner].screen = screen;
    });
  }
  selectGarment(garmentId: string) {
    this.garment(garmentId);
    this.mutate((s) => {
      s.ui[this.owner].selectedGarmentId = garmentId;
    });
  }
  selectOutfit(outfitId: string) {
    this.outfit(outfitId);
    this.mutate((s) => {
      s.ui[this.owner].selectedOutfitId = outfitId;
    });
  }
  setCalendarDate(date: string): void {
    if (!isISODate(date))
      throw new DemoError("VALIDATION", "유효한 날짜를 선택해 주세요.");
    this.mutate((s) => {
      s.ui[this.owner].calendarDate = date;
    });
  }
  setActiveProfile(profileId: string) {
    if (this.remote && profileId !== this.owner)
      throw new DemoError(
        "CONFLICT",
        "현재 로그인에 허용된 프로필만 사용할 수 있어요.",
      );
    if (!this.getState().profiles.some((p) => p.id === profileId))
      throw new DemoError("NOT_FOUND", "존재하지 않는 시연 프로필입니다.");
    this.stopTryOn();
    for (const key of Object.keys(this.tokens)) this.nextToken(key);
    this.mutate((s) => {
      s.activeProfileId = profileId;
    });
  }
  installLocalDemoProfile(bundle: LocalDemoProfileBundle): {
    profileId: string;
    installed: boolean;
  } {
    if (this.remote)
      throw new DemoError(
        "CONFLICT",
        "시연팩은 로컬 시연 모드에서만 열 수 있습니다. 인증된 DB에는 가져오지 않았습니다.",
      );
    if (!bundle || typeof bundle !== "object")
      throw new DemoError("VALIDATION", "시연팩 구성을 확인할 수 없습니다.");
    const input = clone(bundle),
      profile = input.profile;
    const text = (value: unknown): value is string => typeof value === "string";
    const positive = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    const unique = (rows: { id: string }[]) =>
      rows.every((row) => !!row && text(row.id)) &&
      new Set(rows.map((row) => row.id)).size === rows.length;
    const invalid = () => {
      throw new DemoError(
        "VALIDATION",
        "시연팩의 소유자·의류·자산·코디 참조가 올바르지 않습니다. 기존 상태는 유지했습니다.",
      );
    };
    if (
      !profile ||
      !text(profile.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profile.id) ||
      ["constructor", "prototype", "__proto__"].includes(profile.id) ||
      !text(profile.name) ||
      !profile.name.trim() ||
      !Array.isArray(input.garments) ||
      !input.garments.length ||
      !Array.isArray(input.outfits) ||
      !unique(input.garments) ||
      !unique(input.outfits)
    )
      invalid();
    for (const garment of input.garments) {
      if (
        !garment ||
        !text(garment.id) ||
        !garment.id.trim() ||
        garment.ownerId !== profile.id ||
        !categories.includes(garment.category) ||
        !["name", "color", "material", "size", "location", "careNotes"].every(
          (key) => text(garment[key as keyof Garment]),
        ) ||
        !garment.name.trim() ||
        !Array.isArray(garment.features) ||
        !garment.features.every(text) ||
        !positive(garment.revision) ||
        !garment.provenance ||
        !["location", "size", "care"].every((key) =>
          ["demo", "user", "unconfirmed"].includes(
            garment.provenance[key as keyof Garment["provenance"]],
          ),
        )
      )
        invalid();
      if (
        !garment.asset ||
        !text(garment.asset.id) ||
        !garment.asset.id.trim() ||
        !positive(garment.asset.version) ||
        garment.asset.source !== "packaged" ||
        !text(garment.asset.url) ||
        !garment.asset.url ||
        garment.asset.needsReselection
      )
        invalid();
      validateAsset(garment.asset);
    }
    const validItems = (items: OutfitItems) =>
      !!items &&
      typeof items === "object" &&
      !Array.isArray(items) &&
      !!items.top &&
      !!items.bottom &&
      Object.entries(items).every(
        ([slot, id]) =>
          categories.includes(slot as Category) &&
          text(id) &&
          input.garments.some(
            (g) =>
              g.id === id && g.ownerId === profile.id && g.category === slot,
          ),
      );
    for (const outfit of input.outfits) {
      if (
        !outfit ||
        !text(outfit.id) ||
        !outfit.id.trim() ||
        outfit.ownerId !== profile.id ||
        !text(outfit.name) ||
        !positive(outfit.revision) ||
        !validItems(outfit.items) ||
        !outfit.assetVersions ||
        typeof outfit.assetVersions !== "object" ||
        Array.isArray(outfit.assetVersions) ||
        Object.keys(outfit.assetVersions).some(
          (id) => !Object.values(outfit.items).includes(id),
        ) ||
        Object.values(outfit.items).some(
          (id) =>
            input.garments.find((g) => g.id === id)?.asset?.version !==
            outfit.assetVersions[id],
        )
      )
        invalid();
    }
    const draft = input.outfitDraft;
    if (
      !draft ||
      !text(draft.draftId) ||
      !draft.draftId.trim() ||
      draft.ownerId !== profile.id ||
      !text(draft.name) ||
      !positive(draft.revision) ||
      typeof draft.topLocked !== "boolean" ||
      !validItems(draft.items) ||
      [draft.savedOutfitId, draft.sourceOutfitId].some(
        (id) =>
          id !== undefined && !input.outfits.some((outfit) => outfit.id === id),
      )
    )
      invalid();
    const state = this.getState(),
      existing = state.profiles.some((p) => p.id === profile.id);
    if (
      input.garments.some((g) =>
        state.garments.some(
          (old) => old.id === g.id && (!existing || old.ownerId !== profile.id),
        ),
      ) ||
      input.outfits.some((o) =>
        state.outfits.some(
          (old) => old.id === o.id && (!existing || old.ownerId !== profile.id),
        ),
      ) ||
      Object.values(state.outfitDrafts).some(
        (old) => old.draftId === draft.draftId && old.ownerId !== profile.id,
      )
    ) {
      throw new DemoError(
        "CONFLICT",
        "기존 ID와 시연팩 ID가 충돌합니다. 기존 항목을 덮어쓰거나 다른 소유자로 바꾸지 않았습니다.",
      );
    }
    if (existing) {
      // An already edited demo profile is reopened exactly as it stands, never seeded again.
      if (
        !state.ui[profile.id] ||
        input.garments.some(
          (g) =>
            !state.garments.some(
              (old) => old.id === g.id && old.ownerId === profile.id,
            ),
        ) ||
        input.outfits.some(
          (o) =>
            !state.outfits.some(
              (old) => old.id === o.id && old.ownerId === profile.id,
            ),
        )
      ) {
        throw new DemoError(
          "CONFLICT",
          "같은 시연 프로필의 기존 구성을 확인해야 합니다. 누락 항목을 임의로 다시 만들지 않았습니다.",
        );
      }
      this.setActiveProfile(profile.id);
      return { profileId: profile.id, installed: false };
    }
    const previousOwner = this.owner;
    // One durable write creates the profile, its rows and current selection together. No save/AI/wear/care receipt is fabricated.
    this.repository.commit((next) => {
      next.profiles.push(profile);
      next.garments.push(...input.garments);
      next.outfits.push(...input.outfits);
      next.outfitDrafts[profile.id] = draft;
      next.ui[profile.id] = {
        ...emptyUI(),
        screen: "outfit",
        searchResultIds: input.garments.map((g) => g.id),
        selectedOutfitId: draft.sourceOutfitId ?? null,
      };
      next.ui[previousOwner].operations.tryOn = { status: "idle" };
      next.activeProfileId = profile.id;
    }, true);
    this.stopTryOn();
    for (const key of Object.keys(this.tokens)) this.nextToken(key);
    this.emit();
    return { profileId: profile.id, installed: true };
  }
  setSearchFilters(filters: { query?: string; category?: Category | "all" }) {
    if (
      filters.category &&
      filters.category !== "all" &&
      !categories.includes(filters.category)
    )
      throw new DemoError("VALIDATION", "의류 종류가 올바르지 않습니다.");
    this.nextToken("search");
    this.mutate((s) => {
      Object.assign(s.ui[this.owner], filters);
      s.ui[this.owner].operations.search = { status: "idle" };
    });
  }
  async searchGarments(
    query: string,
    options?: ActionOptions,
  ): Promise<ActionResult<Garment[]>> {
    const ownerId = this.owner;
    const token = this.nextToken("search");
    const category = this.ui().category;
    this.mutate((s) => {
      s.ui[ownerId].query = query;
      s.ui[ownerId].operations.search = { status: "processing" };
    });
    const current = () =>
      this.owner === ownerId && this.tokens.search === token;
    try {
      await this.mock(options);
      if (!current())
        return {
          status: "stale",
          message: "이전 검색 결과는 적용하지 않았습니다.",
        };
      const results = matchingGarments(
        this.getState(),
        ownerId,
        query,
        category,
      );
      this.mutate((s) => {
        s.ui[ownerId].searchResultIds = results.map((g) => g.id);
        s.ui[ownerId].operations.search = {
          status: results.length ? "success" : "no-result",
        };
      });
      return results.length
        ? { status: "success", data: results }
        : { status: "no-result", message: "조건에 맞는 보유 의류가 없습니다." };
    } catch (error) {
      if (current())
        this.status(ownerId, "search", {
          status: "error",
          message: (error as Error).message,
        });
      throw error;
    }
  }
  beginRegistration(): RegistrationDraft {
    const existing = this.registrationDraft();
    if (existing) return existing;
    const draft: RegistrationDraft = {
      draftId: this.makeDraftId("registration"),
      ownerId: this.owner,
      revision: 1,
      asset: null,
      ...clone(registrationDefaults),
      manualFields: {},
      provenance: {
        location: "unconfirmed",
        size: "unconfirmed",
        care: "unconfirmed",
      },
    };
    this.mutate((s) => {
      s.registrationDrafts[this.owner] = draft;
    });
    return draft;
  }
  discardRegistration(): void {
    this.nextToken("analysis");
    const draft = this.registrationDraft(),
      remote = this.remote,
      generation = this.resetGeneration;
    this.mutate((s) => {
      delete s.registrationDrafts[this.owner];
      s.ui[this.owner].operations.analysis = { status: "idle" };
    });
    if (remote && draft) {
      this.draftStatus = "saving";
      this.draftQueue = this.draftQueue.then(async () => {
        if (this.remote !== remote || generation !== this.resetGeneration)
          return;
        try {
          await remote.discardDraft(draft);
          this.draftStatus = "saved";
        } catch (e) {
          this.draftStatus = "error";
          this.draftMessage = (e as Error).message;
        } finally {
          this.emit();
        }
      });
    }
  }
  editRegistration(
    patch: Partial<
      Pick<
        RegistrationDraft,
        | "name"
        | "category"
        | "color"
        | "features"
        | "material"
        | "size"
        | "location"
        | "careNotes"
      >
    >,
  ): RegistrationDraft {
    const draft = this.beginRegistration();
    if (patch.category && !categories.includes(patch.category))
      throw new DemoError("VALIDATION", "의류 종류를 선택해 주세요.");
    this.nextToken("analysis");
    this.mutate((s) => {
      const d = s.registrationDrafts[this.owner];
      Object.assign(d, clone(patch));
      d.manualFields ??= {};
      for (const key of Object.keys(patch) as RegistrationField[])
        d.manualFields[key] = true;
      d.revision = draft.revision + 1;
      if (patch.location !== undefined) d.provenance.location = "user";
      if (patch.size !== undefined) d.provenance.size = "user";
      if (patch.careNotes !== undefined) d.provenance.care = "user";
      s.ui[this.owner].operations.analysis = { status: "idle" };
      s.ui[this.owner].operations.saveGarment = { status: "idle" };
    });
    return this.registrationDraft()!;
  }
  replaceRegistrationPhoto(asset: Asset | null): RegistrationDraft {
    const draft = this.beginRegistration();
    if (asset === null) return draft;
    validateAsset(asset);
    this.nextToken("analysis");
    if (asset.source === "upload" && asset.url) this.sessionUrls.add(asset.url);
    this.mutate((s) => {
      const d = s.registrationDrafts[this.owner];
      if (d.asset?.id !== asset.id || d.asset?.version !== asset.version) {
        // Every manual edit is tagged. Remaining populated values came from analysis of the prior photo.
        Object.assign(
          d,
          Object.fromEntries(
            Object.entries(clone(registrationDefaults)).filter(
              ([key]) => !d.manualFields?.[key as RegistrationField],
            ),
          ),
        );
        if (!d.manualFields?.location) d.provenance.location = "unconfirmed";
        if (!d.manualFields?.size) d.provenance.size = "unconfirmed";
        if (!d.manualFields?.careNotes) d.provenance.care = "unconfirmed";
      }
      d.asset = clone(asset);
      d.revision++;
      s.ui[this.owner].operations.analysis = { status: "idle" };
      s.ui[this.owner].operations.saveGarment = { status: "idle" };
    });
    return this.registrationDraft()!;
  }
  async analyzeRegistration(
    options?: ActionOptions,
  ): Promise<ActionResult<RegistrationDraft>> {
    const draft = clone(this.beginRegistration());
    const ownerId = this.owner;
    const token = this.nextToken("analysis");
    this.status(ownerId, "analysis", { status: "processing" });
    const current = () =>
      this.owner === ownerId &&
      this.tokens.analysis === token &&
      this.registrationDraft()?.draftId === draft.draftId &&
      this.registrationDraft()?.revision === draft.revision;
    try {
      await this.draftQueue;
      const prepared = this.remote
        ? await this.remote.analyze(draft)
        : await this.runner.analyze(draft, options);
      if (!current())
        return {
          status: "stale",
          message: "사진 또는 입력이 변경되어 이전 분석을 적용하지 않았습니다.",
        };
      if (!prepared) {
        this.status(ownerId, "analysis", {
          status: "no-result",
          message:
            "이 입력에 맞는 분석 결과가 없습니다. 직접 입력한 값은 유지됩니다.",
        });
        return { status: "no-result", message: "준비 결과 없음 · 수동 입력" };
      }
      const source =
        this.remote?.mode === "live"
          ? "공급자의 분석 제안"
          : this.remote?.mode === "saved_result"
            ? "동일 입력의 저장된 분석 결과"
            : "선택한 시연 사진·버전과 일치하는 준비 결과";
      this.mutate((s) => {
        const d = s.registrationDrafts[ownerId];
        d.manualFields ??= {};
        Object.assign(
          d,
          Object.fromEntries(
            Object.entries(prepared).filter(
              ([key]) => !d.manualFields[key as RegistrationField],
            ),
          ),
        );
        d.revision++;
        s.ui[ownerId].operations.analysis = {
          status: "success",
          message: `${source}입니다. 수동 입력은 유지했습니다. 확인되지 않은 항목은 직접 확인해 주세요.`,
        };
      });
      return { status: "success", data: this.registrationDraft()! };
    } catch (error) {
      if (current())
        this.status(ownerId, "analysis", {
          status: "error",
          message: (error as Error).message,
        });
      throw error;
    }
  }
  private receiptLookup(
    state: DemoState,
    ownerId: string,
    operation: string,
    intentKey: string,
    draftId: string,
    revision: number,
    fingerprint: string,
  ): Receipt | undefined {
    const intent = state.intents[stable([ownerId, operation, intentKey])];
    if (intent && intent.fingerprint !== fingerprint)
      throw new DemoError(
        "CONFLICT",
        "같은 저장 키에 다른 내용이 전달되었습니다. 기존 저장을 변경하지 않았습니다.",
      );
    const receiptId =
      intent?.receiptId ??
      state.revisionReceipts[stable([ownerId, operation, draftId, revision])];
    const receipt = state.receipts.find((r) => r.id === receiptId);
    if (receipt && receipt.fingerprint !== fingerprint)
      throw new DemoError(
        "CONFLICT",
        "같은 초안 버전에 다른 내용이 전달되었습니다.",
      );
    return receipt;
  }
  private replayReceipt<T extends { id: string }>(
    args: ReceiptRequest<T>,
  ): SaveResult<T> | undefined {
    if (!args.intentKey.trim())
      throw new DemoError("VALIDATION", "저장 요청 키가 필요합니다.");
    const fingerprint = stable(args.snapshot);
    const previous = this.receiptLookup(
      this.getState(),
      args.ownerId,
      args.operation,
      args.intentKey,
      args.draftId,
      args.revision,
      fingerprint,
    );
    if (previous) {
      if (!args.lookup(this.getState(), previous.entityId))
        throw new DemoError(
          "CONFLICT",
          "저장 확인서와 결과가 일치하지 않습니다.",
        );
      const intentIndex = stable([
        args.ownerId,
        args.operation,
        args.intentKey,
      ]);
      if (!this.getState().intents[intentIndex])
        this.mutate((s) => {
          s.intents[intentIndex] = { fingerprint, receiptId: previous.id };
        }, true);
      return {
        entity: clone(previous.result) as unknown as T,
        receipt: clone(previous),
        replayed: true,
      };
    }
    return undefined;
  }
  private commitReceipt<T extends { id: string }>(
    args: ReceiptRequest<T> & {
      entity: T;
      insert: (state: DemoState, entity: T) => void;
    },
  ): SaveResult<T> {
    const replay = this.replayReceipt(args);
    if (replay) return replay;
    const fingerprint = stable(args.snapshot);
    const receipt: Receipt = {
      id: id("receipt"),
      ownerId: args.ownerId,
      operation: args.operation,
      entityId: args.entity.id,
      draftId: args.draftId,
      revision: args.revision,
      fingerprint,
      createdAt: new Date().toISOString(),
      result: clone(args.entity) as unknown as Receipt["result"],
    };
    this.mutate((s) => {
      args.insert(s, args.entity);
      s.receipts.push(receipt);
      s.intents[stable([args.ownerId, args.operation, args.intentKey])] = {
        fingerprint,
        receiptId: receipt.id,
      };
      s.revisionReceipts[
        stable([args.ownerId, args.operation, args.draftId, args.revision])
      ] = receipt.id;
    }, true);
    return {
      entity: clone(args.entity),
      receipt: clone(receipt),
      replayed: false,
    };
  }
  async saveGarment(
    intentKey: string,
    options?: ActionOptions,
  ): Promise<SaveResult<Garment>> {
    const snapshot = clone(this.beginRegistration());
    const ownerId = this.owner;
    const resetGeneration = this.resetGeneration;
    if (this.remote) {
      const remote = this.remote;
      await this.draftQueue;
      const result = await remote.saveGarment(snapshot, intentKey);
      this.applyRemoteSave(result, "garments", remote, resetGeneration);
      if (
        this.remote === remote &&
        this.resetGeneration === resetGeneration &&
        this.owner === ownerId &&
        this.registrationDraft()?.draftId === snapshot.draftId &&
        this.registrationDraft()?.revision === snapshot.revision
      )
        this.mutate((s) => {
          s.registrationDrafts[ownerId].savedGarmentId = result.entity.id;
        });
      return result;
    }
    if (!snapshot.name.trim())
      throw new DemoError("VALIDATION", "옷 이름을 입력해 주세요.");
    validateAsset(snapshot.asset);
    const request: ReceiptRequest<Garment> = {
      ownerId,
      operation: "saveGarment",
      intentKey,
      draftId: snapshot.draftId,
      revision: snapshot.revision,
      snapshot: {
        ...snapshot,
        savedGarmentId: undefined,
        asset: snapshot.asset
          ? {
              id: snapshot.asset.id,
              version: snapshot.asset.version,
              source: snapshot.asset.source,
            }
          : null,
      },
      lookup: (s, key) =>
        s.garments.find((g) => g.id === key && g.ownerId === ownerId),
    };
    try {
      const replay = this.replayReceipt(request);
      if (replay) {
        this.status(ownerId, "saveGarment", {
          status: "success",
          message: "기존 로컬 저장 확인서를 다시 확인했습니다.",
        });
        return replay;
      }
      this.status(ownerId, "saveGarment", { status: "processing" });
      await this.mock(options);
      if (resetGeneration !== this.resetGeneration)
        throw new DemoError(
          "CONFLICT",
          "초기화 또는 종료된 세션의 저장을 취소했습니다.",
        );
      const {
        draftId,
        savedGarmentId: _saved,
        manualFields: _manual,
        ...fields
      } = snapshot;
      const entity: Garment = {
        ...fields,
        id: id("garment"),
        name: fields.name.trim(),
      };
      const result = this.commitReceipt({
        ...request,
        entity,
        insert: (s, value) => {
          s.garments.push(value);
          const d = s.registrationDrafts[ownerId];
          if (d?.draftId === draftId && d.revision === snapshot.revision)
            d.savedGarmentId = value.id;
          refreshSearchResults(s, ownerId);
        },
      });
      if (
        this.getState().registrationDrafts[ownerId]?.draftId ===
          snapshot.draftId &&
        this.getState().registrationDrafts[ownerId]?.revision ===
          snapshot.revision
      )
        this.status(ownerId, "saveGarment", {
          status: "success",
          message: "로컬 저장 확인서가 생성되었습니다.",
        });
      return result;
    } catch (error) {
      if (
        resetGeneration === this.resetGeneration &&
        this.getState().registrationDrafts[ownerId]?.draftId ===
          snapshot.draftId &&
        this.getState().registrationDrafts[ownerId]?.revision ===
          snapshot.revision
      )
        this.status(ownerId, "saveGarment", {
          status: "error",
          message: (error as Error).message,
        });
      throw error;
    }
  }
  private ensureOutfitDraft(): OutfitDraft {
    const current = this.outfitDraft();
    if (current) return current;
    const draft: OutfitDraft = {
      draftId: this.makeDraftId("outfit-draft"),
      ownerId: this.owner,
      revision: 1,
      name: "나의 코디",
      items: {},
      topLocked: false,
    };
    this.mutate((s) => {
      s.outfitDrafts[this.owner] = draft;
    });
    return draft;
  }
  editOutfitName(name: string) {
    this.ensureOutfitDraft();
    this.nextToken("recommendation");
    this.mutate((s) => {
      const d = s.outfitDrafts[this.owner];
      d.name = name;
      d.revision++;
    });
  }
  setOutfitItem(slot: Slot, garmentId: string) {
    const garment = this.garment(garmentId);
    const draft = this.ensureOutfitDraft();
    if (garment.category !== slot)
      throw new DemoError(
        "VALIDATION",
        "선택한 옷의 종류와 코디 위치가 다릅니다.",
      );
    if (slotIsLocked(draft, slot) && draft.items[slot] !== garmentId)
      throw new DemoError(
        "CONFLICT",
        "고정된 품목입니다. 고정을 해제한 뒤 변경해 주세요.",
      );
    this.nextToken("recommendation");
    this.stopTryOn();
    this.mutate((s) => {
      const d = s.outfitDrafts[this.owner];
      d.items[slot] = garmentId;
      if (d.externalItems) delete d.externalItems[slot];
      d.revision++;
      s.ui[this.owner].operations.recommendation = { status: "idle" };
    });
  }
  startBlankOutfit() {
    const current = this.outfitDraft();
    this.nextToken("recommendation");
    this.stopTryOn();
    this.mutate((s) => {
      if (current) {
        s.previousOutfitDrafts ??= {};
        (s.previousOutfitDrafts[this.owner] ??= []).push(clone(current));
      }
      s.outfitDrafts[this.owner] = {
        draftId: this.makeDraftId("outfit-draft"),
        ownerId: this.owner,
        revision: 1,
        name: "나의 코디",
        items: {},
        topLocked: false,
      };
    });
  }
  toggleSlotLock(slot: Slot) {
    const draft = this.ensureOutfitDraft();
    if (!draft.items[slot] && !draft.externalItems?.[slot]) return;
    this.nextToken("recommendation");
    this.mutate((s) => {
      const d = s.outfitDrafts[this.owner];
      d.lockedSlots ??= {};
      if (slotIsLocked(d, slot)) {
        delete d.lockedSlots[slot];
        if (slot === "top") d.topLocked = false;
      } else {
        d.lockedSlots[slot] = true;
        if (slot === "top") d.topLocked = true;
      }
      d.revision++;
    });
  }
  removeOutfitItem(slot: Slot) {
    const draft = this.ensureOutfitDraft();
    if (slotIsLocked(draft, slot))
      throw new DemoError(
        "CONFLICT",
        "고정된 품목은 먼저 고정을 해제해 주세요.",
      );
    this.nextToken("recommendation");
    this.stopTryOn();
    this.mutate((s) => {
      const d = s.outfitDrafts[this.owner];
      delete d.items[slot];
      if (d.externalItems) delete d.externalItems[slot];
      d.revision++;
    });
  }
  setExternalOutfitItem(slot: Slot, externalItemId: string) {
    const draft = this.ensureOutfitDraft(),
      item = this.externalItems().find((item) => item.id === externalItemId);
    if (!item || (item.category && item.category !== slot))
      throw new DemoError(
        "VALIDATION",
        "현재 프로필과 선택 종류의 구매 후보를 확인해 주세요.",
      );
    if (
      slotIsLocked(draft, slot) &&
      draft.externalItems?.[slot]?.externalItemId !== externalItemId
    )
      throw new DemoError(
        "CONFLICT",
        "고정된 품목은 먼저 고정을 해제해 주세요.",
      );
    if (draft.externalItems?.[slot]?.externalItemId === externalItemId) return;
    this.nextToken("recommendation");
    this.stopTryOn();
    this.mutate((s) => {
      const d = s.outfitDrafts[this.owner];
      delete d.items[slot];
      d.externalItems ??= {};
      d.externalItems[slot] = {
        externalItemId: item.id,
        assetId: item.asset?.id ?? null,
        assetVersion: item.asset?.version ?? null,
        name: item.name,
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl,
      };
      d.revision++;
      s.ui[this.owner].operations.recommendation = { status: "idle" };
    });
  }
  replaceOutfitItem(slot: Slot, garmentId: string) {
    this.setOutfitItem(slot, garmentId);
  }
  toggleTopLock() {
    this.ensureOutfitDraft();
    this.nextToken("recommendation");
    this.mutate((s) => {
      const d = s.outfitDrafts[this.owner];
      d.topLocked = !d.topLocked;
      if (d.lockedSlots) delete d.lockedSlots.top;
      d.revision++;
    });
  }
  /** Open an owned recommendation for editing without saving a card or recording wear. */
  openOutfitProposal(items: OutfitItems, name: string): OutfitDraft {
    if (!items.top || !items.bottom || !name.trim())
      throw new DemoError(
        "VALIDATION",
        "상의·하의와 코디 이름을 확인해 주세요.",
      );
    for (const [slot, garmentId] of Object.entries(items)) {
      if (this.garment(garmentId).category !== slot)
        throw new DemoError(
          "VALIDATION",
          "추천 코디의 의류 종류가 일치하지 않습니다.",
        );
    }
    const current = this.outfitDraft();
    if (
      current &&
      !hasExternalItems(current) &&
      stable(current.items) === stable(items) &&
      current.name === name.trim()
    )
      return current;
    this.nextToken("recommendation");
    this.stopTryOn();
    const draft: OutfitDraft = {
      draftId: this.makeDraftId("outfit-draft"),
      ownerId: this.owner,
      revision: 1,
      name: name.trim(),
      items: clone(items),
      topLocked: false,
    };
    this.mutate((state) => {
      if (current) {
        state.previousOutfitDrafts ??= {};
        const previous = (state.previousOutfitDrafts[this.owner] ??= []);
        if (
          !previous.some(
            (saved) =>
              saved.draftId === current.draftId &&
              saved.revision === current.revision,
          )
        )
          previous.push(clone(current));
      }
      state.outfitDrafts[this.owner] = draft;
      state.ui[this.owner].operations.recommendation = { status: "idle" };
    });
    return this.outfitDraft()!;
  }
  loadOutfitDraft(outfitId: string) {
    const outfit = this.outfit(outfitId);
    const current = this.outfitDraft();
    this.nextToken("recommendation");
    this.stopTryOn();
    // Reopening the same unedited recommendation must not replace the original backup.
    if (
      current?.sourceOutfitId === outfitId &&
      sameOutfitComposition(current, outfit) &&
      current.name === outfit.name
    )
      return;
    this.mutate((s) => {
      if (current) {
        s.previousOutfitDrafts ??= {};
        const previous = (s.previousOutfitDrafts[this.owner] ??= []);
        if (
          !previous.some(
            (d) =>
              d.draftId === current.draftId && d.revision === current.revision,
          )
        )
          previous.push(clone(current));
      }
      s.outfitDrafts[this.owner] = {
        draftId: this.makeDraftId("outfit-draft"),
        ownerId: this.owner,
        name: outfit.name,
        items: clone(outfit.items),
        ...(outfit.externalItems
          ? { externalItems: clone(outfit.externalItems) }
          : {}),
        revision: 1,
        topLocked: false,
        sourceOutfitId: outfit.id,
      };
    });
  }
  resumePreviousDraft() {
    const previous = this.previousOutfitDraft();
    if (previous) validateExternalSelections(previous, this.externalItems());
    if (!previous)
      throw new DemoError("NOT_FOUND", "보관된 이전 코디 초안이 없습니다.");
    for (const [slot, garmentId] of Object.entries(previous.items)) {
      const garment = this.garment(garmentId);
      if (garment.category !== slot)
        throw new DemoError(
          "CONFLICT",
          "이전 초안의 의류를 다시 확인해 주세요.",
        );
    }
    this.nextToken("recommendation");
    this.stopTryOn();
    this.mutate((s) => {
      const current = s.outfitDrafts[this.owner];
      const stored = s.previousOutfitDrafts![this.owner];
      stored.pop();
      if (current) stored.push(clone(current));
      s.outfitDrafts[this.owner] = clone(previous);
      s.ui[this.owner].operations.recommendation = { status: "idle" };
    });
  }
  loadOutfit(outfitId: string) {
    this.loadOutfitDraft(outfitId);
  }
  invalidateOutfitRecommendation(): void {
    this.nextToken("recommendation");
    this.status(this.owner, "recommendation", { status: "idle" });
  }
  async proposeOutfit(
    conditions: OutfitConditions,
    reference?: string,
  ): Promise<
    ActionResult<{ source: OutfitDraft; items: OutfitItems; label: string }>
  > {
    const source = clone(this.ensureOutfitDraft()),
      owner = this.owner,
      repository = this.repository,
      token = this.nextToken("recommendation");
    if (hasExternalItems(source))
      return {
        status: "unavailable",
        message:
          "내 옷 추천은 구매 후보를 자동 교체하지 않아요. 직접 조합을 유지해 주세요.",
      };
    this.status(owner, "recommendation", { status: "processing" });
    try {
      await this.draftQueue;
      const items = this.remote
        ? await this.remote.recommend(source, conditions, reference)
        : reference
          ? null
          : await this.runner.recommend({
              conditions: clone(conditions),
              draft: source,
              garments: clone(this.garments()),
            });
      if (
        this.owner !== owner ||
        this.repository !== repository ||
        token !== this.tokens.recommendation ||
        this.outfitDraft()?.draftId !== source.draftId ||
        this.outfitDraft()?.revision !== source.revision
      )
        return {
          status: "stale",
          message: "바뀐 선택에 이전 제안을 적용하지 않았어요.",
        };
      if (!items) {
        this.status(owner, "recommendation", { status: "no-result" });
        return {
          status: "no-result",
          message:
            "현재 조건에 맞는 제안이 없어요. 직접 선택은 계속할 수 있어요.",
        };
      }
      for (const [slot, id] of Object.entries(items)) {
        if (this.garment(id).category !== slot)
          throw new DemoError(
            "VALIDATION",
            "추천 의류 참조를 확인할 수 없어요.",
          );
      }
      for (const slot of categories)
        if (slotIsLocked(source, slot) && source.items[slot] !== items[slot])
          return {
            status: "no-result",
            message: "고정한 품목과 다른 제안은 적용하지 않았어요.",
          };
      const label = this.remote
        ? "서버 의류 추천 · Mock 상황 정보"
        : this.connection.kind === "local" || this.connection.mode === "mock"
          ? "준비된 시연 제안"
          : this.connection.mode === "saved_result"
            ? "동일 입력의 저장 제안"
            : "현재 조건으로 받은 제안";
      this.status(owner, "recommendation", {
        status: "success",
        message: label,
      });
      return {
        status: "success",
        data: { source, items: clone(items), label },
      };
    } catch (e) {
      if (this.owner === owner && token === this.tokens.recommendation)
        this.status(owner, "recommendation", { status: "error" });
      throw e;
    }
  }
  applyOutfitSuggestion(source: OutfitDraft, items: OutfitItems) {
    const current = this.outfitDraft();
    if (
      !current ||
      source.ownerId !== this.owner ||
      current.draftId !== source.draftId ||
      current.revision !== source.revision
    )
      throw new DemoError(
        "CONFLICT",
        "선택이 바뀌었어요. 도움을 다시 요청해 주세요.",
      );
    for (const [slot, id] of Object.entries(items)) {
      if (this.garment(id).category !== slot)
        throw new DemoError("VALIDATION", "추천 의류 참조가 달라요.");
    }
    for (const slot of categories)
      if (slotIsLocked(current, slot) && current.items[slot] !== items[slot])
        throw new DemoError("CONFLICT", "고정한 품목을 유지해 주세요.");
    this.nextToken("recommendation");
    this.stopTryOn();
    this.mutate((s) => {
      s.outfitDrafts[this.owner].items = clone(items);
      s.outfitDrafts[this.owner].revision++;
    });
  }
  async generateOutfits(
    conditions: OutfitConditions,
    options?: ActionOptions,
    availabilityConfirmations?: AvailabilityConfirmation[],
  ): Promise<ActionResult<OutfitDraft>> {
    const snapshot = clone(this.ensureOutfitDraft());
    if (hasExternalItems(snapshot))
      return {
        status: "unavailable",
        message:
          "구매 후보를 포함한 초안은 내 옷 전용 추천으로 덮어쓰지 않아요.",
      };
    const ownerId = this.owner;
    const token = this.nextToken("recommendation");
    const confirmations =
      availabilityConfirmations === undefined
        ? undefined
        : clone(availabilityConfirmations);
    this.status(ownerId, "recommendation", { status: "processing" });
    const current = () =>
      this.owner === ownerId &&
      this.tokens.recommendation === token &&
      this.outfitDraft()?.draftId === snapshot.draftId &&
      this.outfitDraft()?.revision === snapshot.revision;
    try {
      await this.draftQueue;
      let items = this.remote
        ? await this.remote.recommend(
            snapshot,
            conditions,
            undefined,
            confirmations,
          )
        : await this.runner.recommend(
            {
              conditions: clone(conditions),
              draft: snapshot,
              garments: clone(this.garments()),
            },
            options,
          );
      if (!current())
        return {
          status: "stale",
          message: "선택 또는 프로필이 바뀌어 이전 추천을 적용하지 않았습니다.",
        };
      if (
        items &&
        confirmations !== undefined &&
        Object.entries(items).some(([slot, id]) => {
          const garment = this.garments().find((g) => g.id === id);
          return (
            !garment ||
            garment.category !== slot ||
            !confirmations.some(
              (item) =>
                item.garmentId === id &&
                item.status === "available" &&
                item.identity === reviewGarmentIdentity(garment),
            )
          );
        })
      ) {
        const message =
          "추천에 포함된 옷의 현재 사용 가능 여부를 먼저 확인해 주세요.";
        this.status(ownerId, "recommendation", {
          status: "no-result",
          message,
        });
        return { status: "no-result", message };
      }
      if (!items) {
        this.status(ownerId, "recommendation", {
          status: "no-result",
          message:
            "이 조건·선택에 대응하는 준비 추천이 없습니다. 보유 의류에서 직접 선택해 주세요.",
        });
        return {
          status: "no-result",
          message: "입력에 일치하는 준비 결과 없음",
        };
      }
      const source =
        this.remote?.mode === "live"
          ? "입력 조건과 보유 의류에 따른 공급자 제안"
          : this.remote?.mode === "saved_result"
            ? "동일 입력의 저장된 추천"
            : "시연 날씨·출근 조건에 맞춘 준비 결과";
      this.mutate((s) => {
        const d = s.outfitDrafts[ownerId];
        d.items = items;
        d.revision++;
        s.ui[ownerId].operations.recommendation = {
          status: "success",
          message: `${source}입니다.`,
        };
      });
      return { status: "success", data: this.outfitDraft()! };
    } catch (error) {
      if (current())
        this.status(ownerId, "recommendation", {
          status: "error",
          message: (error as Error).message,
        });
      throw error;
    }
  }
  async adaptStyleToWardrobe(
    reference: string,
    options?: ActionOptions,
    availabilityConfirmations?: AvailabilityConfirmation[],
  ): Promise<ActionResult<OutfitDraft>> {
    if (hasExternalItems(this.outfitDraft()))
      return {
        status: "unavailable",
        message: "구매 후보를 포함한 초안은 내 옷 재구성으로 덮어쓰지 않아요.",
      };
    if (this.remote) {
      const d = clone(this.ensureOutfitDraft()),
        remote = this.remote,
        owner = this.owner,
        token = this.nextToken("recommendation"),
        confirmations =
          availabilityConfirmations === undefined
            ? undefined
            : clone(availabilityConfirmations);
      await this.draftQueue;
      let items = await remote.recommend(
        d,
        {
          weather: "unavailable",
          temperatureC: 0,
          occasion: "style_reference",
        },
        reference,
        confirmations,
      );
      if (
        remote !== this.remote ||
        owner !== this.owner ||
        token !== this.tokens.recommendation ||
        this.outfitDraft()?.draftId !== d.draftId ||
        this.outfitDraft()?.revision !== d.revision ||
        stable(this.outfitDraft()?.items) !== stable(d.items)
      )
        return {
          status: "stale",
          message: "변경된 초안에 이전 결과를 적용하지 않았습니다.",
        };
      if (
        items &&
        confirmations !== undefined &&
        Object.entries(items).some(([slot, id]) => {
          const garment = this.garments().find((g) => g.id === id);
          return (
            !garment ||
            garment.category !== slot ||
            !confirmations.some(
              (item) =>
                item.garmentId === id &&
                item.status === "available" &&
                item.identity === reviewGarmentIdentity(garment),
            )
          );
        })
      )
        items = null;
      if (items) {
        this.mutate((s) => {
          s.outfitDrafts[this.owner].items = items;
          s.outfitDrafts[this.owner].revision++;
        });
        return { status: "success", data: this.outfitDraft()! };
      }
    } else await this.mock(options);
    return {
      status: "unavailable",
      message: "허용된 참고 자산과 이 입력에 맞는 결과가 필요합니다.",
    };
  }
  async saveOutfit(
    intentKey: string,
    options?: ActionOptions,
  ): Promise<SaveResult<Outfit>> {
    const snapshot = clone(this.ensureOutfitDraft());
    const ownerId = this.owner;
    const resetGeneration = this.resetGeneration;
    if (this.remote) {
      const remote = this.remote;
      await this.draftQueue;
      const result = await remote.saveOutfit(snapshot, intentKey);
      this.applyRemoteSave(result, "outfits", remote, resetGeneration);
      if (
        this.remote === remote &&
        this.resetGeneration === resetGeneration &&
        this.owner === ownerId &&
        this.outfitDraft()?.draftId === snapshot.draftId &&
        this.outfitDraft()?.revision === snapshot.revision
      )
        this.mutate((s) => {
          s.outfitDrafts[ownerId].savedOutfitId = result.entity.id;
        });
      return result;
    }
    if (!completeOutfit(snapshot))
      throw new DemoError("VALIDATION", "상의와 하의를 선택해 주세요.");
    validateExternalSelections(snapshot, this.externalItems());
    if (!snapshot.name.trim())
      throw new DemoError("VALIDATION", "코디 이름을 입력해 주세요.");
    const assetVersions: Record<string, number> = {};
    for (const [slot, key] of Object.entries(snapshot.items)) {
      const garment = this.garment(key);
      if (garment.category !== slot)
        throw new DemoError("VALIDATION", "코디 종류가 일치하지 않습니다.");
      assetVersions[key] = garment.asset?.version ?? 0;
    }
    const request: ReceiptRequest<Outfit> = {
      ownerId,
      operation: "saveOutfit",
      intentKey,
      draftId: snapshot.draftId,
      revision: snapshot.revision,
      snapshot: { ...snapshot, savedOutfitId: undefined, assetVersions },
      lookup: (s, key) =>
        s.outfits.find((o) => o.id === key && o.ownerId === ownerId),
    };
    try {
      const replay = this.replayReceipt(request);
      if (replay) {
        this.status(ownerId, "saveOutfit", {
          status: "success",
          message: "기존 코디 저장 확인서를 다시 확인했습니다.",
        });
        return replay;
      }
      this.status(ownerId, "saveOutfit", { status: "processing" });
      await this.mock(options);
      if (resetGeneration !== this.resetGeneration)
        throw new DemoError(
          "CONFLICT",
          "초기화 또는 종료된 세션의 저장을 취소했습니다.",
        );
      const entity: Outfit = {
        id: id("outfit"),
        ownerId,
        name: snapshot.name.trim(),
        items: clone(snapshot.items),
        ...(hasExternalItems(snapshot)
          ? { externalItems: clone(snapshot.externalItems) }
          : {}),
        revision: snapshot.revision,
        assetVersions,
      };
      const result = this.commitReceipt({
        ...request,
        entity,
        insert: (s, value) => {
          s.outfits.push(value);
          const d = s.outfitDrafts[ownerId];
          if (
            d?.draftId === snapshot.draftId &&
            d.revision === snapshot.revision
          )
            d.savedOutfitId = value.id;
        },
      });
      if (
        this.getState().outfitDrafts[ownerId]?.draftId === snapshot.draftId &&
        this.getState().outfitDrafts[ownerId]?.revision === snapshot.revision
      )
        this.status(ownerId, "saveOutfit", {
          status: "success",
          message: "코디를 저장했습니다. 실제 착용 기록은 만들지 않았습니다.",
        });
      return result;
    } catch (error) {
      if (
        resetGeneration === this.resetGeneration &&
        this.getState().outfitDrafts[ownerId]?.draftId === snapshot.draftId &&
        this.getState().outfitDrafts[ownerId]?.revision === snapshot.revision
      )
        this.status(ownerId, "saveOutfit", {
          status: "error",
          message: (error as Error).message,
        });
      throw error;
    }
  }
  async requestCareGuide(
    garmentId: string,
    options?: ActionOptions,
  ): Promise<ActionResult<CareGuide>> {
    const garment = clone(this.garment(garmentId));
    const ownerId = this.owner;
    const token = this.nextToken("careGuide");
    this.status(ownerId, "careGuide", { status: "processing" });
    try {
      const guide = this.remote
        ? await this.remote.care(garmentId)
        : await this.runner.careGuide(garment, options);
      if (ownerId !== this.owner || token !== this.tokens.careGuide)
        return {
          status: "stale",
          message: "이전 프로필·의류의 안내는 적용하지 않았습니다.",
        };
      this.status(ownerId, "careGuide", {
        status: guide.source === "prepared-demo" ? "success" : "no-result",
      });
      return { status: "success", data: guide };
    } catch (error) {
      if (ownerId === this.owner && token === this.tokens.careGuide)
        this.status(ownerId, "careGuide", {
          status: "error",
          message: (error as Error).message,
        });
      throw error;
    }
  }
  proposeMovement(garmentId: string, location: string) {
    this.garment(garmentId);
    return { garmentId, proposedLocation: location, confirmed: false as const };
  }
  private async recordEvent(
    kind: DemoEvent["kind"],
    targetId: string,
    value: string,
    date: string,
    intentKey: string,
    options?: ActionOptions,
  ): Promise<SaveResult<DemoEvent>> {
    const ownerId = this.owner;
    const resetGeneration = this.resetGeneration;
    if (!value.trim())
      throw new DemoError("VALIDATION", "기록 내용을 입력해 주세요.");
    if (this.remote) {
      const remote = this.remote;
      const result = await remote.recordEvent(
        kind,
        targetId,
        value,
        date,
        intentKey,
      );
      this.applyRemoteSave(result, "events", remote, resetGeneration);
      if (
        kind === "movement" &&
        !result.replayed &&
        this.remote === remote &&
        this.resetGeneration === resetGeneration &&
        this.owner === ownerId
      )
        this.mutate((s) => {
          const g = s.garments.find(
            (g) => g.id === targetId && g.ownerId === ownerId,
          );
          if (g) {
            g.location = value;
            g.provenance.location = "user";
            g.revision++;
          }
          refreshSearchResults(s, ownerId);
        });
      return result;
    }
    if (!isISODate(date))
      throw new DemoError("VALIDATION", "유효한 날짜를 선택해 주세요.");
    if (kind === "care" || kind === "movement") this.garment(targetId);
    else this.outfit(targetId);
    const snapshot = { ownerId, kind, targetId, value: value.trim(), date };
    const request: ReceiptRequest<DemoEvent> = {
      ownerId,
      operation: kind,
      intentKey,
      draftId: stable([kind, intentKey]),
      revision: 1,
      snapshot,
      lookup: (s, key) =>
        s.events.find((e) => e.id === key && e.ownerId === ownerId),
    };
    const replay = this.replayReceipt(request);
    if (replay) return replay;
    await this.mock(options);
    if (resetGeneration !== this.resetGeneration)
      throw new DemoError(
        "CONFLICT",
        "초기화 또는 종료된 세션의 기록을 취소했습니다.",
      );
    const entity: DemoEvent = {
      id: id("event"),
      ownerId,
      kind,
      value: value.trim(),
      date,
      ...(kind === "care" || kind === "movement"
        ? { garmentId: targetId }
        : { outfitId: targetId }),
    };
    return this.commitReceipt({
      ...request,
      entity,
      insert: (s, event) => {
        s.events.push(event);
        if (kind === "movement") {
          const garment = s.garments.find(
            (g) => g.id === targetId && g.ownerId === ownerId,
          )!;
          garment.location = value.trim();
          garment.provenance.location = "user";
          garment.revision++;
          refreshSearchResults(s, ownerId);
        }
      },
    });
  }
  private recordDate() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
  recordActualCare(
    garmentId: string,
    careType: string,
    intentKey: string,
    options?: ActionOptions,
  ) {
    return this.recordEvent(
      "care",
      garmentId,
      careType,
      this.recordDate(),
      intentKey,
      options,
    );
  }
  recordMovementConfirmed(
    garmentId: string,
    location: string,
    intentKey: string,
    options?: ActionOptions,
  ) {
    return this.recordEvent(
      "movement",
      garmentId,
      location,
      this.recordDate(),
      intentKey,
      options,
    );
  }
  planOutfit(
    outfitId: string,
    date: string,
    intentKey: string,
    options?: ActionOptions,
  ) {
    return this.recordEvent(
      "plan",
      outfitId,
      "코디 계획",
      date,
      intentKey,
      options,
    );
  }
  recordWear(
    outfitId: string,
    date: string,
    intentKey: string,
    options?: ActionOptions,
  ) {
    return this.recordEvent(
      "wear",
      outfitId,
      "실제 착용 확인",
      date,
      intentKey,
      options,
    );
  }
  /** B5 records a selected/planned outfit only. Actual wear remains an independent explicit action. */
  async commitCurrentSelection(
    date: string,
    options?: ActionOptions,
  ): Promise<CommitCurrentSelectionResult> {
    const draft = this.outfitDraft();
    if (!draft || draft.ownerId !== this.owner)
      throw new DemoError(
        "VALIDATION",
        "현재 사용자의 코디를 먼저 선택해 주세요.",
      );
    return this.commitSelection(
      captureSelectionSubmission(draft, date, this.garments()),
      options,
    );
  }
  /** Recover the originally submitted plan even when the current comparison draft has since changed. */
  async retrySelection(
    submission: SelectionSubmission,
    options?: ActionOptions,
  ): Promise<CommitCurrentSelectionResult> {
    return this.commitSelection(submission, options);
  }
  private async commitSelection(
    submission: SelectionSubmission,
    options?: ActionOptions,
  ): Promise<CommitCurrentSelectionResult> {
    const { submittedSnapshot, source } = clone(submission),
      date = submittedSnapshot.date;
    if (
      source.ownerId !== this.owner ||
      submittedSnapshot.ownerId !== this.owner ||
      !source.draftId ||
      source.revision !== submittedSnapshot.lookRevision
    )
      throw new DemoError(
        "VALIDATION",
        "현재 사용자에게 속한 원래 선택 기록만 다시 시도할 수 있어요.",
      );
    // Validate current ownership/categories, while preserving the original captured asset versions for retry.
    captureSelectionSnapshot(
      {
        ...source,
        name: "",
        items: submittedSnapshot.items,
        externalItems: submittedSnapshot.externalItems,
        topLocked: false,
      },
      date,
      this.garments(),
    );
    validateExternalSelections(
      {
        ownerId: this.owner,
        items: submittedSnapshot.items,
        externalItems: submittedSnapshot.externalItems,
      },
      this.externalItems(),
    );
    if (
      stable(Object.keys(submittedSnapshot.assetVersions).sort()) !==
        stable(Object.values(submittedSnapshot.items).sort()) ||
      Object.values(submittedSnapshot.assetVersions).some(
        (version) => !Number.isSafeInteger(version) || version < 0,
      )
    )
      throw new DemoError(
        "VALIDATION",
        "원래 선택에 포함된 사진 버전을 확인할 수 없어요.",
      );
    const ownerId = this.owner,
      generation = this.resetGeneration,
      sessionToken = (this.tokens.selectionSession ??= 0);
    const checkSession = () => {
      if (
        this.owner !== ownerId ||
        this.resetGeneration !== generation ||
        this.tokens.selectionSession !== sessionToken
      )
        throw new DemoError(
          "CONFLICT",
          "사용자 또는 세션이 바뀌어 이전 선택의 후속 저장을 중단했어요. 현재 코디는 유지했어요.",
        );
    };
    const key = stable([generation, sessionToken, submittedSnapshot]);
    const pending = this.selectionRequests.get(key);
    if (pending)
      return pending.then((result) => ({
        ...clone(result),
        source,
        replayed: true,
      }));
    const execute = async (): Promise<CommitCurrentSelectionResult> => {
      const snapshotDraft = await selectionSnapshotDraft(submittedSnapshot);
      checkSession();
      // Remote Outfit.revision is the DB draft revision; the receipt retains the submitted client look revision.
      const matches = (outfit: Outfit, receipt?: Receipt) =>
        outfit.ownerId === ownerId &&
        (this.remote
          ? (receipt?.revision ??
            this.receipts().find(
              (item) =>
                item.operation === "saveOutfit" && item.entityId === outfit.id,
            )?.revision ??
            outfit.revision)
          : outfit.revision) === submittedSnapshot.lookRevision &&
        sameOutfitComposition(outfit, submittedSnapshot) &&
        stable(outfit.assetVersions) ===
          stable(submittedSnapshot.assetVersions);
      const existing = this.events().find(
        (event) =>
          event.kind === "plan" &&
          event.date === date &&
          this.outfits().some(
            (outfit) => outfit.id === event.outfitId && matches(outfit),
          ),
      );
      if (existing) {
        const savedOutfit = clone(this.outfit(existing.outfitId!));
        return {
          event: clone(existing),
          savedOutfit,
          garmentIds: Object.values(savedOutfit.items),
          replayed: true,
          source,
          submittedSnapshot: clone(submittedSnapshot),
        };
      }
      const intentKey = selectionSnapshotIntent(snapshotDraft.draftId);
      let saved: SaveResult<Outfit>;
      if (this.remote) {
        const remote = this.remote;
        await this.draftQueue;
        checkSession();
        saved = await remote.saveOutfit(snapshotDraft, intentKey);
        // The existing remote contract resolves current asset versions; never mislabel a different result as the clicked snapshot.
        if (!matches(saved.entity, saved.receipt))
          throw new DemoError(
            "CONFLICT",
            "저장 응답의 코디 또는 사진 버전이 선택 시점과 달라요. 선택 기록은 추가하지 않았어요.",
          );
        this.applyRemoteSave(saved, "outfits", remote, generation);
      } else {
        const request: ReceiptRequest<Outfit> = {
          ownerId,
          operation: "saveOutfit",
          intentKey,
          draftId: snapshotDraft.draftId,
          revision: snapshotDraft.revision,
          snapshot: {
            ...snapshotDraft,
            assetVersions: submittedSnapshot.assetVersions,
          },
          lookup: (state, id) =>
            state.outfits.find(
              (outfit) => outfit.id === id && outfit.ownerId === ownerId,
            ),
        };
        const replay = this.replayReceipt(request);
        if (replay) saved = replay;
        else {
          await this.mock(options);
          checkSession();
          const entity: Outfit = {
            id: id("outfit"),
            ownerId,
            name: snapshotDraft.name,
            items: clone(submittedSnapshot.items),
            ...(hasExternalItems(submittedSnapshot)
              ? { externalItems: clone(submittedSnapshot.externalItems) }
              : {}),
            revision: submittedSnapshot.lookRevision,
            assetVersions: clone(submittedSnapshot.assetVersions),
          };
          saved = this.commitReceipt({
            ...request,
            entity,
            insert: (state, outfit) => {
              state.outfits.push(outfit);
            },
          });
        }
      }
      // Later draft edits do not change this submitted snapshot. A profile/session change stops the next write.
      checkSession();
      const recorded = await this.planOutfit(
        saved.entity.id,
        date,
        selectionEventIntent(snapshotDraft.draftId),
        options,
      );
      if (
        recorded.entity.ownerId !== ownerId ||
        recorded.entity.kind !== "plan" ||
        recorded.entity.date !== date ||
        recorded.entity.outfitId !== saved.entity.id
      )
        throw new DemoError(
          "CONFLICT",
          "저장된 선택 기록과 최종 코디의 연결을 확인할 수 없어요.",
        );
      return {
        event: clone(recorded.entity),
        savedOutfit: clone(saved.entity),
        garmentIds: Object.values(saved.entity.items),
        replayed: recorded.replayed,
        source,
        submittedSnapshot: clone(submittedSnapshot),
      };
    };
    const work = execute();
    this.selectionRequests.set(key, work);
    try {
      return await work;
    } finally {
      if (this.selectionRequests.get(key) === work)
        this.selectionRequests.delete(key);
    }
  }
  /** The single explicit wear action saves the clicked composition, then records actual wear. */
  async wearCurrentOutfit(
    date: string,
    options?: ActionOptions,
  ): Promise<WearCurrentOutfitResult> {
    if (!isISODate(date))
      throw new DemoError("VALIDATION", "유효한 착용 날짜를 선택해 주세요.");
    const draft = this.outfitDraft();
    if (hasExternalItems(draft))
      throw new DemoError(
        "VALIDATION",
        "구매 후보가 포함된 코디는 실제 착용으로 자동 기록하지 않습니다.",
      );
    if (!draft?.items.top || !draft.items.bottom)
      throw new DemoError("VALIDATION", "상의와 하의를 선택해 주세요.");
    const clicked = clone(draft),
      ownerId = this.owner,
      generation = this.resetGeneration;
    const sessionToken = (this.tokens.wearSession ??= 0);
    const source = {
      ownerId,
      draftId: clicked.draftId,
      revision: clicked.revision,
    };
    const assetVersions: Record<string, number> = {};
    for (const [slot, garmentId] of Object.entries(clicked.items)) {
      const garment = this.garment(garmentId);
      if (garment.category !== slot)
        throw new DemoError("VALIDATION", "코디 종류가 일치하지 않습니다.");
      assetVersions[garmentId] = garment.asset?.version ?? 0;
    }
    const current = () =>
      this.owner === ownerId &&
      this.resetGeneration === generation &&
      this.tokens.wearSession === sessionToken &&
      this.outfitDraft()?.draftId === clicked.draftId &&
      this.outfitDraft()?.revision === clicked.revision &&
      stable(this.outfitDraft()?.items) === stable(clicked.items);
    const checkCurrent = () => {
      if (!current())
        throw new DemoError(
          "CONFLICT",
          "코디 또는 프로필이 바뀌어 이전 착용 요청을 중단했어요. 현재 선택은 유지했어요.",
        );
    };
    const key = stable([
      generation,
      sessionToken,
      ownerId,
      date,
      clicked.items,
    ]);
    const pending = this.wearRequests.get(key);
    if (pending)
      return pending.then((result) => ({
        ...clone(result),
        source,
        replayed: true,
      }));
    const execute = async (): Promise<WearCurrentOutfitResult> => {
      const snapshot = await wearSnapshotDraft(ownerId, date, clicked.items);
      checkCurrent();
      // Reuse confirmed legacy/current events too, without making another saved card or LED command.
      const existing = this.events().find(
        (event) =>
          event.kind === "wear" &&
          event.date === date &&
          this.outfits().some(
            (outfit) =>
              outfit.id === event.outfitId &&
              stable(outfit.items) === stable(snapshot.items),
          ),
      );
      if (existing) {
        const savedOutfit = clone(this.outfit(existing.outfitId!));
        return {
          event: clone(existing),
          savedOutfit,
          garmentIds: Object.values(savedOutfit.items),
          replayed: true,
          source,
        };
      }
      const intentKey = wearSnapshotIntent(snapshot.draftId);
      let saved: SaveResult<Outfit>;
      if (this.remote) {
        const remote = this.remote;
        await this.draftQueue;
        checkCurrent();
        // The existing backend transaction persists this internal draft and its immutable outfit receipt.
        saved = await remote.saveOutfit(snapshot, intentKey);
        if (
          saved.entity.ownerId !== ownerId ||
          stable(saved.entity.items) !== stable(snapshot.items)
        )
          throw new DemoError(
            "CONFLICT",
            "저장된 착용 코디의 소유자와 구성을 확인할 수 없어요.",
          );
        this.applyRemoteSave(saved, "outfits", remote, generation);
      } else {
        const request: ReceiptRequest<Outfit> = {
          ownerId,
          operation: "saveOutfit",
          intentKey,
          draftId: snapshot.draftId,
          revision: snapshot.revision,
          snapshot: { ...snapshot, assetVersions },
          lookup: (state, id) =>
            state.outfits.find(
              (outfit) => outfit.id === id && outfit.ownerId === ownerId,
            ),
        };
        const replay = this.replayReceipt(request);
        if (replay) saved = replay;
        else {
          await this.mock(options);
          checkCurrent();
          const entity: Outfit = {
            id: id("outfit"),
            ownerId,
            name: snapshot.name,
            items: clone(snapshot.items),
            revision: 1,
            assetVersions,
          };
          saved = this.commitReceipt({
            ...request,
            entity,
            insert: (state, outfit) => {
              state.outfits.push(outfit);
            },
          });
        }
      }
      // A saved snapshot may remain after a failed/interrupted wear call. Retry uses the same receipt.
      checkCurrent();
      const recorded = await this.recordWear(
        saved.entity.id,
        date,
        wearEventIntent(snapshot.draftId),
        options,
      );
      if (
        recorded.entity.ownerId !== ownerId ||
        recorded.entity.kind !== "wear" ||
        recorded.entity.date !== date ||
        recorded.entity.outfitId !== saved.entity.id
      )
        throw new DemoError(
          "CONFLICT",
          "저장된 착용 기록과 최종 코디의 연결을 확인할 수 없어요.",
        );
      return {
        event: clone(recorded.entity),
        savedOutfit: clone(saved.entity),
        garmentIds: Object.values(saved.entity.items),
        replayed: recorded.replayed,
        source,
      };
    };
    const work = execute();
    this.wearRequests.set(key, work);
    try {
      return await work;
    } finally {
      if (this.wearRequests.get(key) === work) this.wearRequests.delete(key);
    }
  }
  /** Future media adapters register every video/timer/listener cleanup here. Current adapter creates none and never activates a camera. */
  registerTryOnCleanup(cleanup: () => void): () => void {
    this.tryOnCleanups.add(cleanup);
    return () => this.tryOnCleanups.delete(cleanup);
  }
  async startTryOn(
    outfitId?: string,
    options?: ActionOptions,
  ): Promise<TryOnResult | { status: "stale"; message: string }> {
    if (this.remote) {
      const remote = this.remote;
      const d = this.ensureOutfitDraft();
      const result = await remote.tryOn(d);
      return {
        status: "unavailable",
        message:
          typeof result.message === "string"
            ? result.message
            : "허용된 인물 영상·전체 코디 참조와 실행 승인이 필요합니다.",
      };
    }
    const source = outfitId ? this.outfit(outfitId) : this.ensureOutfitDraft();
    const garmentAssets: TryOnInput["outfit"]["garmentAssets"] = {};
    for (const [slot, key] of Object.entries(source.items)) {
      const garment = this.garment(key);
      if (garment.category !== slot)
        throw new DemoError(
          "VALIDATION",
          "피팅 코디의 종류가 일치하지 않습니다.",
        );
      garmentAssets[key] = {
        id: garment.asset?.id ?? null,
        version: garment.asset?.version ?? null,
      };
    }
    const input: TryOnInput = {
      ownerId: this.owner,
      personAsset: null,
      outfit: {
        id: outfitId ?? null,
        draftId: "draftId" in source ? source.draftId : null,
        revision: source.revision,
        items: clone(source.items),
        garmentAssets,
      },
    };
    this.stopTryOn();
    const ownerId = this.owner;
    const generation = ++this.tryOnGeneration;
    this.status(ownerId, "tryOn", { status: "processing" });
    const controller = new AbortController();
    const unregister = this.registerTryOnCleanup(() => controller.abort());
    try {
      const result = await this.runner.tryOn(input, options, controller.signal);
      if (generation !== this.tryOnGeneration || ownerId !== this.owner)
        return {
          status: "stale",
          message: "종료된 피팅 요청은 적용하지 않았습니다.",
        };
      this.status(ownerId, "tryOn", result);
      return result;
    } catch (error) {
      if (generation === this.tryOnGeneration)
        this.status(ownerId, "tryOn", {
          status: "error",
          message: (error as Error).message,
        });
      throw error;
    } finally {
      unregister();
    }
  }
  async applyTryOnLook(outfitId?: string, options?: ActionOptions) {
    return this.startTryOn(outfitId, options);
  }
  stopTryOn(): void {
    this.tryOnGeneration++;
    for (const cleanup of this.tryOnCleanups) {
      try {
        cleanup();
      } catch {
        /* Always release the remaining local resources. */
      }
    }
    if (this.ui()?.operations.tryOn.status !== "idle")
      this.status(this.owner, "tryOn", { status: "idle" });
  }
  resetDemo(): void {
    if (this.remote)
      throw new DemoError(
        "CONFLICT",
        "DB 연결 상태에서는 시연 데이터 초기화를 실행할 수 없습니다.",
      );
    this.stopTryOn();
    this.resetGeneration++;
    for (const key of Object.keys(this.tokens)) this.nextToken(key);
    try {
      this.repository.reset();
    } finally {
      this.emit();
    }
  }
  dispose(): void {
    this.stopTryOn();
    this.resetGeneration++;
    for (const key of Object.keys(this.tokens)) this.nextToken(key);
    for (const url of this.sessionUrls) {
      if (typeof URL !== "undefined") URL.revokeObjectURL(url);
    }
    this.sessionUrls.clear();
    this.listeners.clear();
  }
}

export function createDemoApp(storage?: StorageLike): DemoApp {
  if (storage) return new DemoApp(storage);
  try {
    return new DemoApp(
      typeof localStorage === "undefined" ? undefined : localStorage,
    );
  } catch {
    return new DemoApp();
  }
}
export { emptyUI };
