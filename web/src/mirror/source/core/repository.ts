import { createSeed, STORAGE_KEY } from "./seed";
import type {
  Asset,
  DemoEvent,
  DemoState,
  Garment,
  Outfit,
  Persistence,
  RegistrationDraft,
  StorageLike,
} from "./types";

export class DemoError extends Error {
  constructor(
    public code:
      "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "STORAGE" | "MOCK_FAILURE",
    message: string,
  ) {
    super(message);
    this.name = "DemoError";
  }
}
export const clone = <T,>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;
export const isISODate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function isValidState(value: unknown): value is DemoState {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown): v is string => typeof v === "string";
  const positive = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v > 0;
  const unique = (items: { id: string }[]) =>
    new Set(items.map((i) => i.id)).size === items.length;
  if (!record(value)) return false;
  const s = value as unknown as DemoState;
  if (
    s.schemaVersion !== 1 ||
    typeof s.activeProfileId !== "string" ||
    !Array.isArray(s.profiles) ||
    !Array.isArray(s.garments) ||
    !Array.isArray(s.outfits) ||
    !Array.isArray(s.events) ||
    !Array.isArray(s.receipts)
  )
    return false;
  if (
    ![
      s.registrationDrafts,
      s.outfitDrafts,
      s.ui,
      s.intents,
      s.revisionReceipts,
    ].every(record)
  )
    return false;
  if (
    s.profiles.some(
      (p) => !record(p) || !text(p.id) || !p.id || !text(p.name),
    ) ||
    !unique(s.profiles)
  )
    return false;
  if (!s.profiles.some((p) => p.id === s.activeProfileId)) return false;
  const profileIds = new Set(s.profiles.map((p) => p.id));
  const categories = new Set([
    "top",
    "bottom",
    "outer",
    "bag",
    "shoes",
    "hat",
    "accessory",
    "dress",
  ]);
  const validAsset = (a: unknown): a is Asset | null =>
    a === null ||
    (record(a) &&
      text(a.id) &&
      !!a.id &&
      positive(a.version) &&
      ["packaged", "upload"].includes(a.source as string) &&
      (a.needsReselection === undefined ||
        typeof a.needsReselection === "boolean") &&
      (a.url === null ||
        (text(a.url) &&
          (a.source === "upload"
            ? a.url.startsWith("blob:")
            : /^\/assets\/[a-zA-Z0-9._/-]+$/.test(a.url) &&
              !a.url.includes("..")))));
  const validGarmentFields = (g: unknown): g is Garment | RegistrationDraft =>
    record(g) &&
    profileIds.has(g.ownerId as string) &&
    categories.has(g.category as string) &&
    ["name", "color", "material", "size", "location", "careNotes"].every((k) =>
      text(g[k]),
    ) &&
    Array.isArray(g.features) &&
    g.features.every(text) &&
    record(g.provenance) &&
    ["location", "size", "care"].every((k) =>
      ["demo", "user", "unconfirmed"].includes(
        (g.provenance as Record<string, string>)[k],
      ),
    ) &&
    positive(g.revision) &&
    validAsset(g.asset);
  const validGarment = (g: unknown): g is Garment =>
    validGarmentFields(g) && "id" in g && text(g.id) && !!g.id;
  if (!s.garments.every(validGarment) || !unique(s.garments)) return false;
  const externalSelections = (
    ownerId: string,
    items: unknown,
    external: unknown,
  ) =>
    external === undefined ||
    (record(external) &&
      Object.entries(external).every(
        ([slot, raw]) =>
          categories.has(slot) &&
          record(raw) &&
          text(raw.externalItemId) &&
          text(raw.name) &&
          text(raw.sourceLabel) &&
          (raw.sourceUrl === null ||
            (text(raw.sourceUrl) && raw.sourceUrl.startsWith("https://"))) &&
          !(items as Record<string, unknown>)[slot] &&
          ((raw.assetId === null && raw.assetVersion === null) ||
            (text(raw.assetId) && positive(raw.assetVersion))) &&
          (s.externalItems ?? []).some(
            (item) =>
              item.id === raw.externalItemId && item.ownerId === ownerId,
          ),
      ));
  if (
    s.externalItems !== undefined &&
    (!Array.isArray(s.externalItems) ||
      !unique(s.externalItems) ||
      s.externalItems.some(
        (item) =>
          !record(item) ||
          !text(item.id) ||
          !profileIds.has(item.ownerId) ||
          !text(item.name) ||
          !text(item.sourceLabel) ||
          !(
            item.sourceUrl === null ||
            (text(item.sourceUrl) && item.sourceUrl.startsWith("https://"))
          ) ||
          !validAsset(item.asset) ||
          (item.category !== undefined && !categories.has(item.category)),
      ))
  )
    return false;
  const ownedItems = (ownerId: string, items: unknown) =>
    record(items) &&
    Object.entries(items).every(
      ([slot, id]) =>
        categories.has(slot) &&
        text(id) &&
        s.garments.some(
          (g) => g.id === id && g.ownerId === ownerId && g.category === slot,
        ),
    );
  const outfitMetadata = (o: Record<string, unknown>) =>
    (o.nameOrigin === undefined ||
      ["auto", "user", "legacy"].includes(String(o.nameOrigin))) &&
    (o.purpose === undefined ||
      ["card", "selection", "wear"].includes(String(o.purpose))) &&
    (o.assetIds === undefined ||
      (record(o.assetIds) &&
        Object.entries(o.assetIds).every(
          ([id, value]) =>
            Object.values(o.items as Record<string, string>).includes(id) &&
            (value === null || text(value)),
        ))) &&
    (o.assetVersions === undefined ||
      (record(o.assetVersions) &&
        Object.entries(o.assetVersions).every(
          ([id, value]) =>
            Object.values(o.items as Record<string, string>).includes(id) &&
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0,
        ))) &&
    (o.recordContext === undefined ||
      (record(o.recordContext) &&
        ["selection", "wear"].includes(String(o.recordContext.kind)) &&
        isISODate(o.recordContext.date) &&
        text(o.recordContext.sourceDraftId) &&
        positive(o.recordContext.sourceRevision) &&
        text(o.recordContext.intentId) &&
        (o.recordContext.intentKey === undefined ||
          text(o.recordContext.intentKey))));
  const validOutfit = (o: unknown): o is Outfit =>
    record(o) &&
    text(o.id) &&
    !!o.id &&
    profileIds.has(o.ownerId as string) &&
    text(o.name) &&
    positive(o.revision) &&
    outfitMetadata(o) &&
    ownedItems(o.ownerId as string, o.items) &&
    externalSelections(o.ownerId as string, o.items, o.externalItems) &&
    record(o.assetVersions) &&
    Object.values(o.items as Record<string, string>).every(
      (key) =>
        typeof (o.assetVersions as Record<string, unknown>)[key] === "number" &&
        Number.isInteger((o.assetVersions as Record<string, number>)[key]) &&
        (o.assetVersions as Record<string, number>)[key] >= 0,
    ) &&
    Object.keys(o.assetVersions).every((key) =>
      Object.values(o.items as Record<string, string>).includes(key),
    );
  if (!s.outfits.every(validOutfit) || !unique(s.outfits)) return false;
  const validEvent = (e: unknown): e is DemoEvent =>
    record(e) &&
    text(e.id) &&
    !!e.id &&
    profileIds.has(e.ownerId as string) &&
    ["care", "movement", "plan", "wear"].includes(e.kind as string) &&
    text(e.value) &&
    isISODate(e.date) &&
    (e.kind === "care" || e.kind === "movement"
      ? (e.garmentId !== undefined
          ? s.garments.some(
              (g) => g.id === e.garmentId && g.ownerId === e.ownerId,
            )
          : Array.isArray(e.garmentIds) && e.garmentIds.length > 0) &&
        (e.garmentIds === undefined ||
          (Array.isArray(e.garmentIds) &&
            e.garmentIds.length > 0 &&
            new Set(e.garmentIds).size === e.garmentIds.length &&
            e.garmentIds.every((id) =>
              s.garments.some((g) => g.id === id && g.ownerId === e.ownerId),
            )))
      : s.outfits.some((o) => o.id === e.outfitId && o.ownerId === e.ownerId));
  if (!s.events.every(validEvent) || !unique(s.events)) return false;
  for (const p of s.profiles) {
    const ui = s.ui[p.id];
    if (
      !record(ui) ||
      !text(ui.query) ||
      !text(ui.screen) ||
      !Array.isArray(ui.searchResultIds) ||
      !record(ui.operations) ||
      !["all", ...categories].includes(ui.category)
    )
      return false;
    if (ui.calendarDate !== undefined && !isISODate(ui.calendarDate))
      return false;
    if (
      ui.searchResultIds.some(
        (key) => !s.garments.some((g) => g.id === key && g.ownerId === p.id),
      )
    )
      return false;
    if (
      ui.selectedGarmentId !== null &&
      !s.garments.some(
        (g) => g.id === ui.selectedGarmentId && g.ownerId === p.id,
      )
    )
      return false;
    if (
      ui.selectedOutfitId !== null &&
      !s.outfits.some((o) => o.id === ui.selectedOutfitId && o.ownerId === p.id)
    )
      return false;
    if (
      [
        "search",
        "analysis",
        "recommendation",
        "saveGarment",
        "saveOutfit",
        "careGuide",
        "tryOn",
      ].some((key) => {
        const operation = ui.operations[key as keyof typeof ui.operations];
        return (
          !record(operation) ||
          ![
            "idle",
            "processing",
            "success",
            "error",
            "no-result",
            "unavailable",
            "reviewing",
          ].includes(operation.status) ||
          (operation.message !== undefined && !text(operation.message))
        );
      })
    )
      return false;
  }
  if (Object.keys(s.ui).some((key) => !profileIds.has(key))) return false;
  const validDraft = (owner: string, d: unknown) =>
    record(d) &&
    profileIds.has(owner) &&
    d.ownerId === owner &&
    text(d.draftId) &&
    positive(d.revision) &&
    text(d.name) &&
    typeof d.topLocked === "boolean" &&
    outfitMetadata(d) &&
    ownedItems(owner, d.items) &&
    externalSelections(owner, d.items, d.externalItems) &&
    (d.lockedSlots === undefined ||
      (record(d.lockedSlots) &&
        Object.entries(d.lockedSlots).every(
          ([slot, locked]) => categories.has(slot) && locked === true,
        ))) &&
    (d.savedOutfitId === undefined ||
      s.outfits.some((o) => o.id === d.savedOutfitId && o.ownerId === owner)) &&
    (d.sourceOutfitId === undefined ||
      s.outfits.some((o) => o.id === d.sourceOutfitId && o.ownerId === owner));
  if (
    Object.entries(s.outfitDrafts).some(([owner, d]) => !validDraft(owner, d))
  )
    return false;
  if (
    s.previousOutfitDrafts !== undefined &&
    (!record(s.previousOutfitDrafts) ||
      Object.entries(s.previousOutfitDrafts).some(
        ([owner, drafts]) =>
          !profileIds.has(owner) ||
          !Array.isArray(drafts) ||
          drafts.some((d) => !validDraft(owner, d)),
      ))
  )
    return false;
  if (
    Object.entries(s.registrationDrafts).some(
      ([owner, d]) =>
        !validGarmentFields(d) ||
        !profileIds.has(owner) ||
        d.ownerId !== owner ||
        !text(d.draftId) ||
        !record(d.manualFields) ||
        Object.entries(d.manualFields).some(
          ([key, value]) =>
            ![
              "name",
              "category",
              "color",
              "features",
              "material",
              "size",
              "location",
              "careNotes",
            ].includes(key) || value !== true,
        ) ||
        (d.savedGarmentId !== undefined &&
          !s.garments.some(
            (g) => g.id === d.savedGarmentId && g.ownerId === owner,
          )),
    )
  )
    return false;
  if (
    s.receipts.some(
      (r) =>
        !record(r) ||
        !text(r.id) ||
        !profileIds.has(r.ownerId) ||
        !text(r.fingerprint) ||
        !text(r.draftId) ||
        !positive(r.revision) ||
        !text(r.createdAt) ||
        Number.isNaN(Date.parse(r.createdAt)) ||
        !record(r.result) ||
        r.result.id !== r.entityId ||
        r.result.ownerId !== r.ownerId ||
        (r.operation === "saveGarment"
          ? !validGarment(r.result) ||
            !s.garments.some(
              (g) => g.id === r.entityId && g.ownerId === r.ownerId,
            )
          : r.operation === "saveOutfit"
            ? !validOutfit(r.result) ||
              !s.outfits.some(
                (o) => o.id === r.entityId && o.ownerId === r.ownerId,
              )
            : !validEvent(r.result) ||
              r.result.kind !== r.operation ||
              !s.events.some(
                (e) => e.id === r.entityId && e.ownerId === r.ownerId,
              )),
    )
  )
    return false;
  if (!unique(s.receipts)) return false;
  if (
    Object.values(s.intents).some(
      (i) =>
        !record(i) ||
        !text(i.fingerprint) ||
        !s.receipts.some(
          (r) => r.id === i.receiptId && r.fingerprint === i.fingerprint,
        ),
    )
  )
    return false;
  if (
    Object.values(s.revisionReceipts).some(
      (key) => !s.receipts.some((r) => r.id === key),
    )
  )
    return false;
  return true;
}

// Blob URLs only live for the current browser session. Never persist image bytes or stale URLs.
function serializable(state: DemoState): DemoState {
  const next = clone(state);
  for (const item of [
    ...next.garments,
    ...(next.externalItems ?? []),
    ...Object.values(next.registrationDrafts),
  ]) {
    if (item.asset?.source === "upload")
      item.asset = { ...item.asset, url: null, needsReselection: true };
  }
  for (const receipt of next.receipts)
    if (receipt.operation === "saveGarment") {
      const garment = receipt.result as Garment;
      if (garment.asset?.source === "upload")
        garment.asset = { ...garment.asset, url: null, needsReselection: true };
    }
  for (const ui of Object.values(next.ui)) {
    for (const operation of Object.values(ui.operations))
      if (
        operation.status === "processing" ||
        operation.status === "reviewing"
      ) {
        operation.status = "idle";
        operation.message =
          "새로고침으로 요청이 중단되었습니다. 다시 실행해 주세요.";
      }
    ui.operations.tryOn = { status: "idle" };
  }
  return next;
}

/** One versioned, project-scoped state write contains both entity and receipt. This is local-only persistence, not a server transaction. */
export class DemoRepository {
  private state: DemoState;
  persistence: Persistence = { status: "ready" };
  private blockedCorrupt = false;
  constructor(
    private storage?: StorageLike,
    private seed: () => DemoState = createSeed,
  ) {
    this.state = seed();
    if (!storage) {
      this.persistence = {
        status: "memory-only",
        reason: "unavailable",
        message: "로컬 저장소에 접근할 수 없어 메모리에서만 편집 중입니다.",
      };
      return;
    }
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const loaded: unknown = JSON.parse(raw);
        if (!isValidState(loaded)) throw new Error("invalid state");
        this.state = serializable(loaded);
      }
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message === "invalid state")
      ) {
        this.blockedCorrupt = true;
        this.persistence = {
          status: "memory-only",
          reason: "corrupt",
          message:
            "데모 저장 데이터가 손상되었습니다. 원문을 덮어쓰지 않았습니다. 발표자 도구에서 명시적으로 초기화해 주세요.",
        };
      } else
        this.persistence = {
          status: "memory-only",
          reason: "unavailable",
          message: "로컬 저장소 읽기가 불가합니다. 메모리에서만 편집 중입니다.",
        };
    }
  }
  getState(): DemoState {
    return this.state;
  }
  commit(mutator: (next: DemoState) => void, durable = false): void {
    const next = clone(this.state);
    mutator(next);
    if (!this.persist(next) && durable)
      throw new DemoError(
        "STORAGE",
        this.persistence.message ?? "로컬 저장에 실패했습니다.",
      );
    this.state = next;
  }
  private persist(next: DemoState): boolean {
    if (this.blockedCorrupt) return false;
    if (!this.storage) return false;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serializable(next)));
      this.persistence = { status: "ready" };
      return true;
    } catch (error) {
      const quota =
        error instanceof Error && /quota/i.test(error.name + error.message);
      this.persistence = {
        status: "memory-only",
        reason: quota ? "quota" : "unavailable",
        message: quota
          ? "로컬 저장 용량이 부족합니다. 편집 내용은 메모리에만 있습니다. 저장은 완료되지 않았습니다."
          : "로컬 저장이 차단되었습니다. 편집 내용은 메모리에만 있습니다. 저장은 완료되지 않았습니다.",
      };
      return false;
    }
  }
  reset(): void {
    const previous = this.blockedCorrupt;
    this.blockedCorrupt = false;
    const next = this.seed();
    if (!this.persist(next)) {
      this.blockedCorrupt = previous;
      throw new DemoError(
        "STORAGE",
        "초기화 결과를 저장하지 못했습니다. 기존 상태를 유지합니다.",
      );
    }
    this.state = next;
  }
}
