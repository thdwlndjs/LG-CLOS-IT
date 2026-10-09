import catalog from "./data/wardrobe-pack/catalog.json";
import assets from "./data/wardrobe-pack/assets.json";
import garments from "./data/wardrobe-pack/garments.json";
import outfits from "./data/wardrobe-pack/outfits.json";
import outfitItems from "./data/wardrobe-pack/outfit_items.json";
import savedResults from "./data/wardrobe-pack/saved_results.json";
import people from "./data/wardrobe-pack/person_references.json";
import registrations from "./data/wardrobe-pack/registration_examples.json";
import manifest from "./data/wardrobe-pack/manifest.json";
import type { LocalDemoProfileBundle } from "./core/app";
import type {
  Asset,
  Category,
  Garment,
  Outfit,
  OutfitItems,
} from "./core/types";
import {
  fittingSnapshotsMatch,
  type FittingCandidate,
  type FittingSnapshot,
  type MirrorPerson,
} from "./mirrorScene";

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Package IDs are local fixtures. They are never converted into authenticated profile/storage IDs. */
export const PACK_PROFILE_ID = "wardrobe-pack-demo";
export const PACK_STATIC_LABEL = "준비된 정적 착장 예시";
/** Preserve the unbound source owner/location and synthetic evidence rather than rewriting source JSON. */
export const PACK_METADATA = freeze({
  catalog,
  assets,
  garments,
  outfits,
  outfitItems,
  savedResults,
  people,
  registrations,
  manifest,
});
export const PACK_CATALOG = PACK_METADATA.catalog;
export const PACK_ASSETS = PACK_METADATA.assets;

export function packAssetUrl(imageRef: string): string {
  if (!/^assets\/(catalog|demo)\/[A-Za-z0-9_-]+\.png$/.test(imageRef))
    throw new Error("시연팩의 로컬 이미지 경로가 올바르지 않습니다.");
  return `/assets/wardrobe-pack/${imageRef.slice("assets/".length)}`;
}
function assetById(id: string): Asset {
  const rows = assets.filter((asset) => asset.id === id);
  if (rows.length !== 1)
    throw new Error(`시연팩 자산 참조를 확인할 수 없습니다: ${id}`);
  const row = rows[0];
  if (
    !Number.isSafeInteger(row.asset_version) ||
    row.asset_version < 1 ||
    !/^[a-f0-9]{64}$/.test(row.sha256)
  )
    throw new Error("시연팩 자산 버전 또는 체크섬이 올바르지 않습니다.");
  return {
    id: row.id,
    version: row.asset_version,
    source: "packaged",
    url: packAssetUrl(row.image_ref),
  };
}

const person = people.find((row) => row.id === "DEMO_PERSON01")!;
const personAsset = assetById(person.reference_asset_id);
export const PACK_PERSON: MirrorPerson & { label: string } = freeze({
  id: person.id,
  referenceAssetId: personAsset.id,
  version: personAsset.version,
  url: personAsset.url,
  ownerId: PACK_PROFILE_ID,
  label: "팩 예시 인물 · 생성된 시연 이미지",
});
/** Dress remains a read-only source category; no DB/category meaning is changed to make it selectable. */
export const PACK_READ_ONLY_ITEMS = freeze(
  catalog
    .filter((row) => row.category === "dress")
    .map((row) => ({
      ...row,
      asset: assetById(row.asset_id),
      reason:
        "원피스는 현재 코디 슬롯에 포함되지 않아 원본 미리보기만 제공합니다.",
    })),
);
export const PACK_REGISTRATION_EXAMPLE = freeze({
  ...registrations[0],
  asset: assetById(registrations[0].asset_id),
});

const supportedCategories: readonly Category[] = [
  "top",
  "bottom",
  "outer",
  "bag",
  "shoes",
  "hat",
  "accessory",
];
const bagIds = new Set(["A01", "A02", "A05"]);
function categoryFor(row: (typeof catalog)[number]): Category | null {
  if (row.category === "dress") return null;
  if (bagIds.has(row.garment_id)) return "bag";
  if (!supportedCategories.includes(row.category as Category))
    throw new Error(`지원하지 않는 시연팩 분류: ${row.category}`);
  return row.category as Category;
}

/** A new mutable derived bundle; raw owner_id/location fields above remain null. */
export function createWardrobePackBundle(): LocalDemoProfileBundle {
  const converted: Garment[] = catalog.flatMap((row) => {
    const category = categoryFor(row);
    if (!category) return [];
    const asset = assetById(row.asset_id),
      source = garments.find((garment) => garment.id === row.garment_id);
    if (
      !source ||
      source.asset_id !== asset.id ||
      row.asset_version !== asset.version
    )
      throw new Error("시연팩 의류와 자산 참조가 일치하지 않습니다.");
    return [
      {
        id: row.garment_id,
        ownerId: PACK_PROFILE_ID,
        asset,
        name: row.name,
        category,
        color: row.colors.map((color) => color.label_ko).join(" · "),
        features: [
          row.subcategory_ko,
          row.description_ko,
          ...row.season_tags,
          ...row.style_tags,
        ],
        // A visual texture prompt is not a verified material composition, size, care label or physical location.
        material: "",
        size: "",
        location: "",
        careNotes: "",
        provenance: {
          location: "unconfirmed",
          size: "unconfirmed",
          care: "unconfirmed",
        },
        revision: 1,
      },
    ];
  });
  const convertedOutfits: Outfit[] = outfits.map((row) => {
    const items = Object.fromEntries(
      row.snapshot_json.items.map((item) => [item.slot, item.garment_id]),
    ) as OutfitItems;
    return {
      id: row.id,
      ownerId: PACK_PROFILE_ID,
      name: row.title,
      items,
      revision: 1,
      assetVersions: Object.fromEntries(
        row.snapshot_json.items.map((item) => [
          item.garment_id,
          item.asset_version,
        ]),
      ),
    };
  });
  const initial = convertedOutfits.find((row) => row.id === "LOOK02")!;
  return {
    profile: { id: PACK_PROFILE_ID, name: "의류팩 시연 · 생성된 예시" },
    garments: converted,
    outfits: convertedOutfits,
    outfitDraft: {
      draftId: "wardrobe-pack-draft-LOOK02",
      ownerId: PACK_PROFILE_ID,
      revision: 1,
      name: initial.name,
      items: { ...initial.items },
      topLocked: false,
      sourceOutfitId: initial.id,
    },
  };
}

/** REGISTER01 demonstrates recognition of existing T04, never an implicit new garment or care evidence. */
export function matchPackRegistration(
  assetId: string,
  version: number,
): { status: "existing-item"; garmentId: string; exampleId: string } | null {
  const row = registrations.find(
    (example) =>
      example.asset_id === assetId && example.same_item_already_in_catalog,
  );
  const asset = assets.find((item) => item.id === assetId);
  return row && asset?.asset_version === version
    ? {
        status: "existing-item",
        garmentId: row.expected_garment_id,
        exampleId: row.id,
      }
    : null;
}

/**
 * This is a deterministic local illustration lookup, not an AI/provider receipt.
 * Only after exact full-item/person/version matching is a fresh display request bound to the prepared image.
 * A separately supplied current snapshot rejects late A completions after selection B.
 */
export function matchPreparedPackResult(
  snapshot: FittingSnapshot | null,
  currentSnapshot: FittingSnapshot | null = snapshot,
): FittingCandidate | null {
  if (
    !snapshot ||
    snapshot.outfit.externalItems?.length ||
    snapshot.ownerId !== PACK_PROFILE_ID ||
    !fittingSnapshotsMatch(snapshot, currentSnapshot) ||
    !Number.isSafeInteger(snapshot.requestVersion) ||
    snapshot.requestVersion < 1 ||
    !Number.isSafeInteger(snapshot.outfit.revision) ||
    snapshot.outfit.revision < 1 ||
    (!snapshot.outfit.draftId && !snapshot.outfit.outfitId) ||
    snapshot.person.assetId !== personAsset.id ||
    snapshot.person.assetVersion !== personAsset.version
  )
    return null;
  const matching = outfits.filter(
    (outfit) =>
      outfit.snapshot_json.person_ref === person.id &&
      outfit.snapshot_json.items.length === snapshot.outfit.items.length &&
      outfit.snapshot_json.items.every((item) => {
        const asset = assets.find((row) => row.id === item.asset_id);
        return (
          asset?.asset_version === item.asset_version &&
          asset.sha256 === item.asset_sha256 &&
          snapshot.outfit.items.some(
            (current) =>
              current.slot === item.slot &&
              current.garmentId === item.garment_id &&
              current.assetId === item.asset_id &&
              current.assetVersion === item.asset_version,
          )
        );
      }),
  );
  if (matching.length !== 1) return null;
  const outfit = matching[0],
    results = savedResults.filter(
      (row) =>
        row.outfit_id === outfit.id &&
        row.person_ref === person.id &&
        row.person_reference_asset_id === personAsset.id &&
        row.outfit_signature === outfit.snapshot_json.outfit_signature &&
        row.mode === "saved_result" &&
        row.render_type === "static_image" &&
        row.match_policy ===
          "exact_person_and_full_snapshot_and_asset_versions",
    );
  if (results.length !== 1) return null;
  const result = results[0],
    asset = assetById(result.result_asset_id);
  return {
    snapshot: structuredClone(snapshot),
    origin: "prepared-static",
    content: "fitting-result",
    status: "ready",
    media: { kind: "image", url: asset.url! },
    resultId: result.id,
  };
}
