/** Logical interchange only. These refs are never database IDs or transfer approvals. */
export type JsonObject = Record<string, unknown>;
export interface PackEntity extends JsonObject {
  ref: string;
}
export interface PackProfile extends PackEntity {
  display_name: string;
  allowed_profile_refs: string[];
  profile_kind: string;
}
export interface PackGarment extends PackEntity {
  owner_ref: string;
  product_ref: string | null;
  name: string;
  category: string;
  colour: string;
  size: string | null;
  material: string | null;
}
export interface PackProduct extends PackEntity {
  source_ref: string;
  category: string;
  display_name_ko: string;
}
export interface PackExternal extends PackEntity {
  owner_ref: string;
  product_ref: string;
  source_ref: string;
  source_url: string;
  ownership: string;
  led_anchor_ref: null;
}
export interface PackOutfit extends PackEntity {
  owner_ref: string;
  title: string;
  items: { slot: string; kind: "owned" | "external"; ref: string }[];
  created_at: string;
}
export interface PackEvent extends PackEntity {
  owner_ref: string;
  kind: string;
  occurred_at: string;
  outfit_ref: string | null;
  garment_refs: string[];
  details: JsonObject;
  input_source: string;
  source_event_key: string;
}
export interface PackEvidence extends PackEntity {
  owner_ref: string;
  garment_ref: string;
  product_ref: string;
  source_ref: string;
  evidence_kind: string;
  structured_care: JsonObject | null;
}
export interface PackPreference extends PackEntity {
  profile_ref: string;
  kind: string;
}
export interface PackContext extends PackEntity {
  profile_ref: string;
  as_of: string;
  timezone: string;
  weather: JsonObject;
}
export interface PackSource extends PackEntity {
  product_ref: string;
  url: string;
  retrieval_level: string;
  retrieved_date: string;
  short_excerpt: string;
}
export interface LifeDataPack {
  manifest: {
    namespace: string;
    version: string;
    counts: Record<string, number>;
    [key: string]: unknown;
  };
  profiles: PackProfile[];
  garments: PackGarment[];
  products: PackProduct[];
  external_items: PackExternal[];
  outfits: PackOutfit[];
  activity_events: PackEvent[];
  evidence_bindings: PackEvidence[];
  preferences: PackPreference[];
  contexts: PackContext[];
  sources: PackSource[];
  asset_intake: JsonObject[];
}
export interface ReviewedAssetBinding {
  id: string;
  version: number;
  ownerId: string;
  reviewed: boolean;
  permissionReviewed: boolean;
}
export interface RuntimeBindings {
  namespace: string;
  profiles: Record<
    string,
    { profileId: string; authSubject: string; reviewed: boolean }
  >;
  garments: Record<
    string,
    {
      id: string;
      ownerId: string;
      reviewed: boolean;
      action: "bind_existing" | "create_reviewed" | "create_fixture";
      asset?: ReviewedAssetBinding | null;
      location?: { value: string; anchorId: string; reviewed: boolean };
    }
  >;
  externalItems: Record<
    string,
    {
      id: string;
      ownerId: string;
      reviewed: boolean;
      action: "bind_existing" | "create_reviewed" | "create_fixture";
      asset?: ReviewedAssetBinding | null;
    }
  >;
  /** Source-to-item identity review is distinct from a photo or an owner binding. */
  evidence?: Record<
    string,
    { reviewed: boolean; garmentId: string; sourceRef: string }
  >;
}
export interface ImportTarget {
  environment: "unknown" | "remote" | "isolated";
  projectId: string | null;
  schemaVersions: string[];
  allowAssetlessFixture?: boolean;
}
export type EntityType =
  | "profile"
  | "product"
  | "source"
  | "garment"
  | "external"
  | "evidence"
  | "outfit"
  | "event"
  | "preference"
  | "context"
  | "asset_request";
export type PlanStatus =
  | "CREATE"
  | "LINK"
  | "UNCHANGED"
  | "CONFLICT"
  | "UNRESOLVED"
  | "DEFERRED"
  | "REFERENCE";
export interface ExistingImportRecord {
  key: string;
  runtimeId: string;
  ownerId: string | null;
  sourceHash: string;
  appliedRowHash: string;
  currentRowHash: string;
  deleted?: boolean;
}
export interface DatabaseSnapshot {
  assets?: {
    id: string;
    ownerId: string;
    version: number;
    status: string;
    kind: string;
  }[];
  sceneAnchors?: { id: string; garmentId: string; location: string }[];
  profiles?: { id: string }[];
  garments?: {
    id: string;
    ownerId: string;
    assetId: string | null;
    assetVersion: number | null;
  }[];
  externalItems?: { id: string; ownerId: string }[];
  imports?: ExistingImportRecord[];
}
export interface PlanItem {
  entity: EntityType;
  ref: string;
  key: string;
  sourceHash: string;
  ownerId: string | null;
  runtimeId: string | null;
  status: PlanStatus;
  reasons: string[];
  table: string | null;
  row: JsonObject | null;
  relatedRows?: { table: string; row: JsonObject }[];
}
export interface ValidationIssue {
  code: string;
  entity: string;
  ref: string;
  detail: string;
}
export interface ImportPlan {
  mode: "dry_run";
  namespace: string;
  version: string;
  target: ImportTarget;
  writeEnabled: false;
  valid: boolean;
  issues: ValidationIssue[];
  items: PlanItem[];
  counts: Record<PlanStatus, number>;
  schemaMapping: SchemaMapping[];
  applyBlockers: string[];
}
export interface SchemaMapping {
  logical: string;
  table: string | null;
  existingWritePath: string | null;
  normalization: string;
  limitation: string | null;
}
