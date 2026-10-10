import type { GarmentDisplayBinding } from "../lifeData/visualPresentation";
import type { LifeProfileData } from "../lifeSnapshot";
import type { CareEvidenceItem } from "../careEvidence";
export type Category =
  "top" | "bottom" | "outer" | "bag" | "shoes" | "hat" | "accessory" | "dress";
export type Slot = Category;
export type Asset = {
  id: string;
  version: number;
  source: "packaged" | "upload" | "storage";
  url: string | null;
  expiresAt?: string;
  needsReselection?: boolean;
};
export type Provenance = "demo" | "user" | "unconfirmed";
export interface Garment {
  /** null is an explicit display clear; undefined has never been bound. Fitting asset remains independent. */
  displayBinding?: GarmentDisplayBinding | null;
  id: string;
  ownerId: string;
  asset: Asset | null;
  name: string;
  category: Category;
  color: string;
  features: string[];
  material: string;
  size: string;
  location: string;
  provenance: { location: Provenance; size: Provenance; care: Provenance };
  careNotes: string;
  revision: number;
}
export type RegistrationField =
  | "name"
  | "category"
  | "color"
  | "features"
  | "material"
  | "size"
  | "location"
  | "careNotes";
export interface RegistrationDraft extends Omit<Garment, "id"> {
  draftId: string;
  savedGarmentId?: string;
  manualFields: Partial<Record<RegistrationField, true>>;
}
export type OutfitItems = Partial<Record<Slot, string>>;
/** Existing external catalogue record; never an owned garment or a location. */
export interface ExternalItem {
  id: string;
  ownerId: string;
  name: string;
  asset: Asset | null;
  sourceLabel: string;
  sourceUrl: string | null;
  category?: Slot;
}
export interface ExternalOutfitItem {
  externalItemId: string;
  assetId: string | null;
  assetVersion: number | null;
  name: string;
  sourceLabel: string;
  sourceUrl: string | null;
}
export type ExternalOutfitItems = Partial<Record<Slot, ExternalOutfitItem>>;
export type OutfitNameOrigin = "auto" | "user" | "legacy";
export type OutfitPurpose = "card" | "selection" | "wear";
export interface OutfitRecordContext {
  kind: "selection" | "wear";
  date: string;
  sourceDraftId: string;
  sourceRevision: number;
  intentKey?: string;
  intentId: string;
}
export interface OutfitDraft {
  nameOrigin?: OutfitNameOrigin;
  purpose?: OutfitPurpose;
  assetIds?: Record<string, string | null>;
  assetVersions?: Record<string, number>;
  recordContext?: OutfitRecordContext;
  draftId: string;
  ownerId: string;
  revision: number;
  name: string;
  items: OutfitItems;
  topLocked: boolean;
  lockedSlots?: Partial<Record<Slot, true>>;
  externalItems?: ExternalOutfitItems;
  savedOutfitId?: string;
  sourceOutfitId?: string;
}
export interface Outfit {
  cardAsset?: Asset;
  nameOrigin?: OutfitNameOrigin;
  purpose?: OutfitPurpose;
  assetIds?: Record<string, string | null>;
  id: string;
  ownerId: string;
  name: string;
  items: OutfitItems;
  revision: number;
  assetVersions: Record<string, number>;
  externalItems?: ExternalOutfitItems;
}
// Existing FastAPI-rendered card image remains available.
export type EventKind = "care" | "movement" | "plan" | "wear";
/** Optional read metadata preserves event time, revision and source without changing existing actions. */
export interface DemoEvent {
  id: string;
  ownerId: string;
  kind: EventKind;
  garmentId?: string;
  outfitId?: string;
  value: string;
  date: string;
  occurredAt?: string;
  timePrecision?: "date" | "instant";
  scheduledAt?: string;
  garmentIds?: string[];
  inputSource?: string;
  sourceEventKey?: string;
  sourceRef?: string;
  revision?: number;
  voided?: boolean;
  lifeKind?: string;
  details?: Record<string, unknown>;
}
export interface Receipt {
  id: string;
  ownerId: string;
  operation: string;
  entityId: string;
  draftId: string;
  revision: number;
  fingerprint: string;
  createdAt: string;
  result: Garment | Outfit | DemoEvent;
}
export type OperationName =
  | "search"
  | "analysis"
  | "recommendation"
  | "saveGarment"
  | "saveOutfit"
  | "careGuide"
  | "tryOn";
export type OperationState = {
  status:
    | "idle"
    | "processing"
    | "success"
    | "error"
    | "no-result"
    | "unavailable"
    | "reviewing";
  message?: string;
};
export interface ProfileUI {
  query: string;
  category: Category | "all";
  searchResultIds: string[];
  selectedGarmentId: string | null;
  selectedOutfitId: string | null;
  screen: string;
  calendarDate?: string;
  operations: Record<OperationName, OperationState>;
}
export interface DemoState {
  localRepairs?: Record<
    string,
    {
      version: string;
      sourceFingerprint: string;
      appliedAt: string;
      changedIds: string[];
      conflicts: { id: string; reason: string }[];
    }
  >;
  localDatasets?: Record<
    string,
    { version: string; sourceFingerprint: string; installedAt: string }
  >;
  lifeData?: Record<string, LifeProfileData>;
  careEvidence?: CareEvidenceItem[];
  schemaVersion: 1;
  activeProfileId: string;
  profiles: { id: string; name: string }[];
  garments: Garment[];
  outfits: Outfit[];
  events: DemoEvent[];
  externalItems?: ExternalItem[];
  registrationDrafts: Record<string, RegistrationDraft>;
  outfitDrafts: Record<string, OutfitDraft>;
  previousOutfitDrafts?: Record<string, OutfitDraft[]>;
  ui: Record<string, ProfileUI>;
  receipts: Receipt[];
  intents: Record<string, { fingerprint: string; receiptId: string }>;
  revisionReceipts: Record<string, string>;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export type Persistence = {
  status: "ready" | "memory-only";
  reason?: "unavailable" | "quota" | "corrupt";
  message?: string;
};
export type ActionOptions = { delayMs?: number; fail?: boolean };
export type RecordActionOptions = ActionOptions & { intentKey?: string };
export type ActionResult<T> =
  | { status: "success"; data: T }
  | { status: "no-result" | "stale" | "unavailable"; message: string };
export type SaveResult<T> = { entity: T; receipt: Receipt; replayed: boolean };
export type OutfitConditions = {
  weather: string;
  temperatureC: number;
  occasion: string;
};
export interface CareGuide {
  garmentId: string;
  title: string;
  advice: string;
  source:
    "prepared-demo" | "unconfirmed" | "provider" | "local-evidence-summary";
  actualCareRecorded: false;
}
export interface TryOnResult {
  status: "unavailable";
  message: string;
}
