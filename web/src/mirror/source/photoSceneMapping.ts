import {
  reviewedBindingFor,
  garmentDisplayPresentation,
} from "./lifeData/visualPresentation";
import geometry from "./data/mirror-geometry.json";
import type { Garment } from "./core/types";
import {
  PACK_ASSETS,
  PACK_CATALOG,
  PACK_PROFILE_ID,
  packAssetUrl,
} from "./wardrobePack";

/** These landmarks describe this photograph, never hardware or verified garment positions. */
export const PHOTO_SCENE_SOURCE = Object.freeze({
  sceneAssetVersion: "mirror-photo-20261009-v1",
  sourcePixelHash: geometry.source.rgb_pixel_sha256,
  sourceFileHash: geometry.source.sha256,
  physicalLocationVerified: false as const,
});
export const PHOTO_SCENARIO_A_GARMENT_ID = "O01";
export const PHOTO_SCENARIO_B_OUTFIT_IDS = Object.freeze([
  "LOOK01",
  "LOOK02",
  "LOOK03",
]);
export const PHOTO_TOP_CANDIDATE_IDS = Object.freeze(["T04", "T05", "T07"]);

export interface PhotoVisualZone {
  id: string;
  label: string;
  anchorIds: readonly string[];
  /** Exact aliases are a display correspondence, not a migration of stored locations. */
  locationAliases: readonly string[];
}
function zone(
  id: string,
  label: string,
  anchorId: string,
  locationAliases: string[],
): PhotoVisualZone {
  if (!geometry.led_anchors.some((anchor) => anchor.anchor_id === anchorId))
    throw new Error("사진 기준점이 없습니다: " + anchorId);
  return Object.freeze({
    id,
    label,
    anchorIds: Object.freeze([anchorId]),
    locationAliases: Object.freeze([label, ...locationAliases]),
  });
}
export const PHOTO_VISUAL_ZONES: readonly PhotoVisualZone[] = Object.freeze([
  zone("left-long-hanging", "왼쪽 긴 옷 행거", "L1_RAIL_GROUP", [
    "행거 B",
    "행거 B · 오른쪽 1번째",
    "행거 B · 오른쪽 2번째",
  ]),
  zone("left-upper-hanging", "왼쪽 안쪽 상단 행거", "L2_UPPER_GROUP", [
    "행거 A",
  ]),
  zone("left-lower-hanging", "왼쪽 안쪽 하단 행거", "L2_LOWER_GROUP", [
    "행거 D",
  ]),
  zone("left-long-drawer", "왼쪽 긴 옷 아래 서랍", "L1_DRAWER", ["서랍 E"]),
  zone("left-lower-drawer", "왼쪽 하의 아래 서랍", "L2_DRAWER", ["서랍 G"]),
  zone("right-inner-shelf-1", "오른쪽 안쪽 선반 1단", "R1_SHELF_01", [
    "선반 C",
  ]),
  zone("right-inner-shelf-2", "오른쪽 안쪽 선반 2단", "R1_SHELF_02", [
    "선반 F",
  ]),
  zone("right-inner-shelf-3", "오른쪽 안쪽 선반 3단", "R1_SHELF_03", [
    "선반 H",
  ]),
  zone("right-inner-shelf-4", "오른쪽 안쪽 선반 4단", "R1_SHELF_04", [
    "선반 J",
  ]),
  zone("right-inner-drawer-1", "오른쪽 안쪽 서랍 1단", "R1_DRAWER_01", []),
  zone("right-inner-drawer-2", "오른쪽 안쪽 서랍 2단", "R1_DRAWER_02", []),
  zone("right-inner-drawer-3", "오른쪽 안쪽 서랍 3단", "R1_DRAWER_03", []),
  zone("right-inner-drawer-4", "오른쪽 안쪽 서랍 4단", "R1_DRAWER_04", []),
  zone("right-inner-drawer-5", "오른쪽 안쪽 서랍 5단", "R1_DRAWER_05", []),
  zone("right-outer-shelf-1", "오른쪽 바깥 선반 1단", "R2_SHELF_01", []),
  zone("right-outer-shelf-2", "오른쪽 바깥 선반 2단", "R2_SHELF_02", []),
  zone("right-outer-shelf-3", "오른쪽 바깥 선반 3단", "R2_SHELF_03", []),
  zone("right-outer-shelf-4", "오른쪽 바깥 선반 4단", "R2_SHELF_04", []),
  zone("right-outer-shelf-5", "오른쪽 바깥 선반 5단", "R2_SHELF_05", []),
  zone("right-outer-shelf-6", "오른쪽 바깥 선반 6단", "R2_SHELF_06", []),
  zone("right-outer-shelf-7", "오른쪽 바깥 선반 7단", "R2_SHELF_07", []),
]);
const zonesById = new Map(PHOTO_VISUAL_ZONES.map((value) => [value.id, value]));
const zonesByLocation = new Map(
  PHOTO_VISUAL_ZONES.flatMap((value) =>
    value.locationAliases.map((alias) => [alias, value] as const),
  ),
);
if (
  zonesByLocation.size !==
  PHOTO_VISUAL_ZONES.reduce((n, value) => n + value.locationAliases.length, 0)
)
  throw new Error("사진 위치 별칭이 중복되었습니다.");

export interface PhotoDemoPlacement {
  garmentId: string;
  visualZoneId: string;
  reason: string;
}
/**
 * Explicit fixtures use the catalog storage type and the pictured kind of storage.
 * No photo garment identity, individual hanger number, color or array position is inferred.
 * Original source location_json is null and stays null.
 */
export const PHOTO_DEMO_PLACEMENTS: readonly PhotoDemoPlacement[] =
  Object.freeze(
    [
      {
        garmentId: "O01",
        visualZoneId: "left-long-hanging",
        reason: "트렌치코트의 긴 옷 보관 구역 시연",
      },
      {
        garmentId: "O03",
        visualZoneId: "left-long-hanging",
        reason: "긴 코트 보관 구역 시연",
      },
      {
        garmentId: "T01",
        visualZoneId: "left-upper-hanging",
        reason: "셔츠의 상단 행거 구역 시연",
      },
      {
        garmentId: "T03",
        visualZoneId: "left-upper-hanging",
        reason: "셔츠의 상단 행거 구역 시연",
      },
      {
        garmentId: "T04",
        visualZoneId: "left-upper-hanging",
        reason: "등록 예시와 같은 올리브 셔츠의 상단 행거 구역 시연",
      },
      {
        garmentId: "B01",
        visualZoneId: "left-lower-hanging",
        reason: "슬랙스의 하단 행거 구역 시연",
      },
      {
        garmentId: "B02",
        visualZoneId: "left-lower-hanging",
        reason: "치노팬츠의 하단 행거 구역 시연",
      },
      {
        garmentId: "B04",
        visualZoneId: "left-lower-hanging",
        reason: "와이드팬츠의 하단 행거 구역 시연",
      },
      {
        garmentId: "T05",
        visualZoneId: "right-inner-shelf-1",
        reason: "케이블 니트의 접은 상의 선반 구역 시연",
      },
      {
        garmentId: "T07",
        visualZoneId: "right-inner-shelf-3",
        reason: "맨투맨의 접은 상의 선반 구역 시연",
      },
      {
        garmentId: "B03",
        visualZoneId: "right-outer-shelf-4",
        reason: "접힌 데님이 보이는 선반 구역 시연",
      },
      {
        garmentId: "B07",
        visualZoneId: "right-inner-shelf-4",
        reason: "조거팬츠의 접은 하의 선반 구역 시연",
      },
      {
        garmentId: "O05",
        visualZoneId: "right-outer-shelf-3",
        reason: "원본 이미지가 니트 가디건인 의류의 접은 니트 구역 시연",
      },
    ].map((value) => Object.freeze(value)),
  );
const fixturesById = new Map(
  PHOTO_DEMO_PLACEMENTS.map((value) => [value.garmentId, value]),
);
if (fixturesById.size !== PHOTO_DEMO_PLACEMENTS.length)
  throw new Error("사진 시연 의류가 여러 구역에 중복 연결되었습니다.");

export type PhotoLocationSource =
  "user-input" | "existing-record" | "demo-fixture" | "unknown";
export type PhotoSourceAccuracy =
  | "reviewed-demo-example"
  | "packaged-demo-exact"
  | "registered-asset"
  | "asset-missing"
  | "packaged-source-mismatch"
  | "garment-missing"
  | "ambiguous-id";
export interface PhotoResolvedLocation {
  garmentId: string;
  garmentName: string;
  sourceLocation: string;
  locationSource: PhotoLocationSource;
  recordProvenance: Garment["provenance"]["location"] | null;
  visualZoneId: string | null;
  zoneLabel: string | null;
  anchorIds: string[];
  precision: "zone" | "unknown";
  sourceAccuracy: PhotoSourceAccuracy;
  sourceAsset: {
    id: string;
    version: number;
    url: string;
    isSyntheticDemo: boolean | null;
  } | null;
  photoGarmentIdentityVerified: false;
  physicalLocationVerified: false;
  /** User/record location still takes priority; its photo correspondence remains a demo. */
  displayLabel: string;
  reason: string;
}
export interface PhotoLocationResolution {
  anchorIds: string[];
  items: PhotoResolvedLocation[];
  unknownIds: string[];
  sceneAssetVersion: string;
  sourcePixelHash: string;
}

function inspectSource(
  garment: Garment,
): Pick<PhotoResolvedLocation, "sourceAccuracy" | "sourceAsset"> {
  const reviewed = reviewedBindingFor(garment),
    display = garmentDisplayPresentation(garment);
  if (reviewed && display.asset?.url)
    return {
      sourceAccuracy: "reviewed-demo-example",
      sourceAsset: {
        id: display.asset.id,
        version: display.asset.version,
        url: display.asset.url,
        isSyntheticDemo: true,
      },
    };
  const asset = garment.asset;
  const hasAsset =
    !!asset?.id &&
    Number.isSafeInteger(asset.version) &&
    asset.version > 0 &&
    !!asset.url &&
    !asset.needsReselection;
  const catalog = PACK_CATALOG.find((row) => row.garment_id === garment.id);
  if (garment.ownerId === PACK_PROFILE_ID && catalog) {
    const original = PACK_ASSETS.find((row) => row.id === catalog.asset_id);
    const adaptedCategory = ["A01", "A02", "A05"].includes(garment.id)
      ? "bag"
      : catalog.category;
    const exact =
      hasAsset &&
      original &&
      asset.id === original.id &&
      asset.version === original.asset_version &&
      asset.source === "packaged" &&
      asset.url === packAssetUrl(original.image_ref) &&
      garment.category === adaptedCategory;
    return {
      sourceAccuracy: exact
        ? "packaged-demo-exact"
        : "packaged-source-mismatch",
      sourceAsset: hasAsset
        ? {
            id: asset.id,
            version: asset.version,
            url: asset.url!,
            isSyntheticDemo: exact ? true : null,
          }
        : null,
    };
  }
  return {
    sourceAccuracy: hasAsset ? "registered-asset" : "asset-missing",
    sourceAsset: hasAsset
      ? {
          id: asset.id,
          version: asset.version,
          url: asset.url!,
          isSyntheticDemo: null,
        }
      : null,
  };
}

/** Pure, owner-scoped projection: no garment/event/geometry mutation or implicit location save. */
export function resolvePhotoLocations(
  garments: readonly Garment[],
  ownerId: string,
  ids: readonly string[],
  deviceScoped = false,
): PhotoLocationResolution {
  const items: PhotoResolvedLocation[] = [];
  for (const garmentId of new Set(ids)) {
    const matches = garments.filter(
      (value) =>
        value.id === garmentId && (deviceScoped || value.ownerId === ownerId),
    );
    const garment = matches.length === 1 ? matches[0] : null;
    const common = {
      garmentId,
      garmentName: garment?.name ?? "의류 확인 필요",
      sourceLocation: garment?.location ?? "",
      locationSource: "unknown" as PhotoLocationSource,
      recordProvenance: garment?.provenance.location ?? null,
      visualZoneId: null,
      zoneLabel: null,
      anchorIds: [] as string[],
      precision: "unknown" as const,
      sourceAccuracy:
        matches.length > 1
          ? ("ambiguous-id" as const)
          : ("garment-missing" as const),
      sourceAsset: null,
      photoGarmentIdentityVerified: false as const,
      physicalLocationVerified: false as const,
      displayLabel: "위치 확인 필요",
      reason: "이 프로필에서 하나의 의류 기록을 확인할 수 없습니다.",
    };
    if (!garment) {
      items.push(common);
      continue;
    }
    const source = inspectSource(garment);
    const row: PhotoResolvedLocation = { ...common, ...source };
    const recorded = garment.location.trim();
    // A user-cleared location is intentional too; never restore a fixture behind it.
    if (garment.provenance.location === "user" || recorded) {
      row.locationSource =
        garment.provenance.location === "user"
          ? "user-input"
          : "existing-record";
      const known =
        recorded && garment.provenance.location !== "unconfirmed"
          ? zonesByLocation.get(recorded)
          : undefined;
      if (known) {
        Object.assign(row, {
          visualZoneId: known.id,
          zoneLabel: known.label,
          anchorIds: [...known.anchorIds],
          precision: "zone",
          displayLabel: "시연 위치 · " + known.label,
          reason:
            "기존 위치 기록을 우선한 사진 구역 대응표입니다. 사진 속 동일 의류·실물 위치는 미검증입니다.",
        });
      } else {
        row.reason = recorded
          ? "기존 위치 기록을 보존했습니다. 이 사진과의 구역 대응이 확인되지 않아 LED를 켜지 않습니다."
          : "사용자가 비워 둔 위치를 보존했습니다. 시연 배치로 덮어쓰지 않습니다.";
      }
      items.push(row);
      continue;
    }
    const reviewed = reviewedBindingFor(garment),
      reviewedZone = reviewed?.scene
        ? zonesById.get(reviewed.scene.visualZoneId)
        : undefined;
    const reviewedScene =
      reviewed?.scene &&
      reviewed.scene.version === PHOTO_SCENE_SOURCE.sceneAssetVersion &&
      reviewedZone &&
      reviewed.scene.ledAnchorIds.length === reviewedZone.anchorIds.length &&
      reviewed.scene.ledAnchorIds.every((id) =>
        reviewedZone.anchorIds.includes(id),
      )
        ? {
            garmentId,
            visualZoneId: reviewed.scene.visualZoneId,
            reason: "검토된 공용 예시 이미지의 기존 장면 배치",
          }
        : undefined;
    const fixture =
      reviewedScene ??
      (garment.ownerId === PACK_PROFILE_ID &&
      garment.provenance.location === "unconfirmed" &&
      source.sourceAccuracy === "packaged-demo-exact"
        ? fixturesById.get(garmentId)
        : undefined);
    const visualZone = fixture && zonesById.get(fixture.visualZoneId);
    if (fixture && visualZone) {
      Object.assign(row, {
        locationSource: "demo-fixture",
        visualZoneId: visualZone.id,
        zoneLabel: visualZone.label,
        anchorIds: [...visualZone.anchorIds],
        precision: "zone",
        displayLabel: "시연 위치 · " + visualZone.label,
        reason:
          fixture.reason +
          "입니다. 원본 위치는 미확인이고 사진 속 의류와 동일한 제품이라는 뜻이 아닙니다.",
      });
    } else {
      row.reason =
        garment.category === "shoes"
          ? "사진에 신발 전용 보관 구역이 확인되지 않아 LED를 켜지 않습니다."
          : "현재 의류와 사진 구역을 연결할 근거가 없어 LED를 켜지 않습니다.";
    }
    items.push(row);
  }
  const requested = new Set(items.flatMap((item) => item.anchorIds));
  // Geometry order is only deterministic output order; it never selects a garment location.
  const anchorIds = geometry.led_anchors
    .filter((anchor) => requested.has(anchor.anchor_id))
    .map((anchor) => anchor.anchor_id);
  return {
    anchorIds,
    items,
    unknownIds: items
      .filter((item) => item.precision === "unknown")
      .map((item) => item.garmentId),
    sceneAssetVersion: PHOTO_SCENE_SOURCE.sceneAssetVersion,
    sourcePixelHash: PHOTO_SCENE_SOURCE.sourcePixelHash,
  };
}
