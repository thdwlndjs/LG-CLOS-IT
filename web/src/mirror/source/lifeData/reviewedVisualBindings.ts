/** Explicit display-only decisions after local PNG/hash/alpha inspection on 2026-10-10.
 * Generated examples do not establish brand, material, physical location or fitting identity.
 * Never join source refs to legacy refs or apply the unreviewed candidate table at runtime.
 */
export interface ReviewedVisualBinding {
  readonly sourceDataset: string;
  readonly sourceProfileRef: "PSU" | "PHW";
  readonly sourceGarmentRef: string;
  readonly sourceProductRef: string | null;
  readonly currentLocalProfileId: string;
  readonly currentCanonicalGarmentId: string;
  readonly expectedCategory: string;
  readonly expectedColor: string;
  readonly expectedName: string;
  readonly legacyCatalogDataset: string;
  readonly legacyCatalogRef: string;
  readonly asset: {
    readonly id: string;
    readonly version: number;
    readonly sha256: string;
    readonly displayUrl: string;
    readonly displaySha256: string;
  };
  readonly imageBindingKind: "explicit_example_image";
  readonly productIdentity: "demo_product" | "not_verified";
  readonly careApplicability:
    "demo_product_reference" | "insufficient_evidence";
  readonly scene: null | {
    readonly source: "PHOTO_DEMO_PLACEMENTS" | "PACK_PLACEMENT_EXACT_ALIAS";
    readonly version: string;
    readonly slotId: string;
    readonly visualZoneId: string;
    readonly ledAnchorIds: readonly string[];
    readonly physicalLocationVerified: false;
    readonly mappingPath: string;
  };
  readonly decisionReason: string;
  readonly remainingReview: string;
}
export interface PendingVisualBinding {
  readonly sourceDataset: string;
  readonly sourceProfileRef: "PSU" | "PHW";
  readonly sourceGarmentRef: string;
  readonly sourceProductRef: string | null;
  readonly currentLocalProfileId: string;
  readonly currentCanonicalGarmentId: string;
  readonly expectedCategory: string;
  readonly expectedColor: string;
  readonly expectedName: string;
  readonly candidateLegacyCatalogRef: string | null;
  readonly imageBindingKind: "pending";
  readonly status: "CONFLICT_REVIEW" | "TRUE_ASSET_GAP";
  readonly reason: string;
  readonly remainingReview: string;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const REVIEWED_VISUAL_BINDINGS: readonly ReviewedVisualBinding[] =
  freeze([
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PSU",
      sourceGarmentRef: "S02",
      sourceProductRef: "P01",
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S02",
      expectedCategory: "top",
      expectedColor: "white",
      expectedName: "화이트 옥스퍼드 셔츠",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "T01",
      asset: {
        id: "asset_T01_v1",
        version: 1,
        sha256:
          "d7dd5a5417a9dddbe3fd7bbe733bbf4bea617eb53f9374b3ee47c3d4907a5627",
        displayUrl: "/assets/wardrobe-pack/catalog/T01.png",
        displaySha256:
          "d7dd5a5417a9dddbe3fd7bbe733bbf4bea617eb53f9374b3ee47c3d4907a5627",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "demo_product",
      careApplicability: "demo_product_reference",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-upper-hanging",
        visualZoneId: "left-upper-hanging",
        ledAnchorIds: ["L2_UPPER_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[T01] -> PHOTO_VISUAL_ZONES[left-upper-hanging] -> L2_UPPER_GROUP",
      },
      decisionReason:
        "화이트 긴팔 버튼업, 포인트 칼라와 가슴 주머니를 직접 확인했다. 흰 셔츠의 예시 그림으로만 사용하며 옥스퍼드 조직이나 COS 상품 동일성은 확인하지 않았다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PSU",
      sourceGarmentRef: "S04",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S04",
      expectedCategory: "top",
      expectedColor: "grey",
      expectedName: "그레이 맨투맨",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "T07",
      asset: {
        id: "asset_T07_v1",
        version: 1,
        sha256:
          "6a438ff346a4ef77fa109fa40d63ae32cc7cc4f3b145f3b5c2252e782468e2aa",
        displayUrl: "/assets/wardrobe-pack/catalog/T07.png",
        displaySha256:
          "6a438ff346a4ef77fa109fa40d63ae32cc7cc4f3b145f3b5c2252e782468e2aa",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "right-inner-shelf-3",
        visualZoneId: "right-inner-shelf-3",
        ledAnchorIds: ["R1_SHELF_03"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[T07] -> PHOTO_VISUAL_ZONES[right-inner-shelf-3] -> R1_SHELF_03",
      },
      decisionReason:
        "밝은 멜란지 그레이 크루넥, 긴 소매와 목·소매·밑단 시보리를 확인했다. 그레이 맨투맨 시연 표현에 대응한다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PSU",
      sourceGarmentRef: "S09",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S09",
      expectedCategory: "bottom",
      expectedColor: "beige",
      expectedName: "베이지 치노",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "B02",
      asset: {
        id: "asset_B02_v1",
        version: 1,
        sha256:
          "03e9717f81ae41f6cc840e85001ee047295c97762846dc35d587295d93427db8",
        displayUrl: "/assets/wardrobe-pack/catalog/B02.png",
        displaySha256:
          "03e9717f81ae41f6cc840e85001ee047295c97762846dc35d587295d93427db8",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-lower-hanging",
        visualZoneId: "left-lower-hanging",
        ledAnchorIds: ["L2_LOWER_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[B02] -> PHOTO_VISUAL_ZONES[left-lower-hanging] -> L2_LOWER_GROUP",
      },
      decisionReason:
        "베이지 긴 바지, 평평한 앞판과 치노 주머니, 일자 실루엣을 확인했다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PSU",
      sourceGarmentRef: "S12",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S12",
      expectedCategory: "outer",
      expectedColor: "beige",
      expectedName: "베이지 트렌치",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "O01",
      asset: {
        id: "asset_O01_v1",
        version: 1,
        sha256:
          "340fecbd39661a5c259b2e6e010d567ed1d8b28fcdc767ecb48eab6d570c3dd9",
        displayUrl: "/assets/wardrobe-pack/catalog/O01.png",
        displaySha256:
          "340fecbd39661a5c259b2e6e010d567ed1d8b28fcdc767ecb48eab6d570c3dd9",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-long-hanging",
        visualZoneId: "left-long-hanging",
        ledAnchorIds: ["L1_RAIL_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[O01] -> PHOTO_VISUAL_ZONES[left-long-hanging] -> L1_RAIL_GROUP",
      },
      decisionReason:
        "베이지 더블 버튼 트렌치, 허리 벨트·견장·긴 기장을 확인했다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PSU",
      sourceGarmentRef: "S13",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S13",
      expectedCategory: "outer",
      expectedColor: "navy",
      expectedName: "네이비 재킷",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "O02",
      asset: {
        id: "asset_O02_v1",
        version: 1,
        sha256:
          "09b085af9dd5985d34de97770c00033c9cd10d365b3ab6815716b9657c131900",
        displayUrl: "/assets/wardrobe-pack/catalog/O02.png",
        displaySha256:
          "09b085af9dd5985d34de97770c00033c9cd10d365b3ab6815716b9657c131900",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PACK_PLACEMENT_EXACT_ALIAS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-hanger-a",
        visualZoneId: "left-upper-hanging",
        ledAnchorIds: ["L2_UPPER_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "PACK_PLACEMENT_GROUPS[O02] -> left-hanger-a -> MIRROR_COMPARTMENTS.label:행거 A -> PHOTO_VISUAL_ZONES.locationAliases:행거 A -> left-upper-hanging -> L2_UPPER_GROUP",
      },
      decisionReason:
        "네이비 짧은 재킷, 지퍼와 시보리의 봄버 형태를 확인했다. 원생활 항목은 재킷으로만 지정되어 있어 네이비 재킷 예시로 사용한다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PSU",
      sourceGarmentRef: "S15",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S15",
      expectedCategory: "shoes",
      expectedColor: "white",
      expectedName: "화이트 스니커즈",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "S01",
      asset: {
        id: "asset_S01_v1",
        version: 1,
        sha256:
          "6a6992adfc70e10fc2457d32802620576bedb6f1ea1070a1d1bf8706f23e7ebf",
        displayUrl: "/assets/wardrobe-pack/catalog/S01.png",
        displaySha256:
          "6a6992adfc70e10fc2457d32802620576bedb6f1ea1070a1d1bf8706f23e7ebf",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: null,
      decisionReason:
        "흰 로우톱 끈 스니커즈 한 켤레를 확인했다. 생활 S01 셔츠가 아닌 생활 S15에만 명시 대응한다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 사진 배경에 해당 신발·가방 전용 시연 위치가 없어 LED는 연결하지 않는다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PSU",
      sourceGarmentRef: "S16",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S16",
      expectedCategory: "accessory",
      expectedColor: "natural",
      expectedName: "캔버스 토트백",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "A02",
      asset: {
        id: "asset_A02_v1",
        version: 1,
        sha256:
          "6c87fbb32db9defab7a54d78b6519da034ecbcbbdd053f386bfdc0a6f6e9cb68",
        displayUrl: "/assets/wardrobe-pack/catalog/A02.png",
        displaySha256:
          "6c87fbb32db9defab7a54d78b6519da034ecbcbbdd053f386bfdc0a6f6e9cb68",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: null,
      decisionReason:
        "내추럴 캔버스풍 색, 짧은 손잡이 두 개와 사각 토트백 형태를 확인했다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 사진 배경에 해당 신발·가방 전용 시연 위치가 없어 LED는 연결하지 않는다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H01",
      sourceProductRef: "P01",
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H01",
      expectedCategory: "top",
      expectedColor: "white",
      expectedName: "화이트 옥스퍼드 셔츠",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "T01",
      asset: {
        id: "asset_T01_v1",
        version: 1,
        sha256:
          "d7dd5a5417a9dddbe3fd7bbe733bbf4bea617eb53f9374b3ee47c3d4907a5627",
        displayUrl: "/assets/wardrobe-pack/catalog/T01.png",
        displaySha256:
          "d7dd5a5417a9dddbe3fd7bbe733bbf4bea617eb53f9374b3ee47c3d4907a5627",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "demo_product",
      careApplicability: "demo_product_reference",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-upper-hanging",
        visualZoneId: "left-upper-hanging",
        ledAnchorIds: ["L2_UPPER_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[T01] -> PHOTO_VISUAL_ZONES[left-upper-hanging] -> L2_UPPER_GROUP",
      },
      decisionReason:
        "화이트 긴팔 버튼업, 포인트 칼라와 가슴 주머니를 확인했다. 생활 H01 셔츠에만 대응하며 옛 H01 모자와 연결하지 않는다. COS 실물 동일성은 미검증이다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H02",
      sourceProductRef: "P02",
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H02",
      expectedCategory: "top",
      expectedColor: "light_blue",
      expectedName: "라이트블루 옥스퍼드 셔츠",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "T03",
      asset: {
        id: "asset_T03_v1",
        version: 1,
        sha256:
          "4b0984486bff22676061263c6cdee41f58e57ffa2b945309c1b999b10cd2a643",
        displayUrl: "/assets/wardrobe-pack/catalog/T03.png",
        displaySha256:
          "4b0984486bff22676061263c6cdee41f58e57ffa2b945309c1b999b10cd2a643",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "demo_product",
      careApplicability: "demo_product_reference",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-upper-hanging",
        visualZoneId: "left-upper-hanging",
        ledAnchorIds: ["L2_UPPER_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[T03] -> PHOTO_VISUAL_ZONES[left-upper-hanging] -> L2_UPPER_GROUP",
      },
      decisionReason:
        "라이트블루 긴팔 버튼다운 칼라, 가슴 주머니와 옥스퍼드풍 표면을 확인했다. H&M 제품 사진이나 정확한 섬유의 증거로 사용하지 않는다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H07",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H07",
      expectedCategory: "top",
      expectedColor: "cream",
      expectedName: "크림 케이블 니트",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "T05",
      asset: {
        id: "asset_T05_v1",
        version: 1,
        sha256:
          "1cd67a1549187949e8ad3b80b2d8c2d5f0b1efebd8d4e9c8e0c9484a2eefc1e0",
        displayUrl: "/assets/wardrobe-pack/catalog/T05.png",
        displaySha256:
          "1cd67a1549187949e8ad3b80b2d8c2d5f0b1efebd8d4e9c8e0c9484a2eefc1e0",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "right-inner-shelf-1",
        visualZoneId: "right-inner-shelf-1",
        ledAnchorIds: ["R1_SHELF_01"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[T05] -> PHOTO_VISUAL_ZONES[right-inner-shelf-1] -> R1_SHELF_01",
      },
      decisionReason: "크림색 크루넥 니트의 몸판·소매 케이블 패턴을 확인했다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H09",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H09",
      expectedCategory: "bottom",
      expectedColor: "beige",
      expectedName: "베이지 치노",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "B02",
      asset: {
        id: "asset_B02_v1",
        version: 1,
        sha256:
          "03e9717f81ae41f6cc840e85001ee047295c97762846dc35d587295d93427db8",
        displayUrl: "/assets/wardrobe-pack/catalog/B02.png",
        displaySha256:
          "03e9717f81ae41f6cc840e85001ee047295c97762846dc35d587295d93427db8",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-lower-hanging",
        visualZoneId: "left-lower-hanging",
        ledAnchorIds: ["L2_LOWER_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[B02] -> PHOTO_VISUAL_ZONES[left-lower-hanging] -> L2_LOWER_GROUP",
      },
      decisionReason:
        "베이지 일자 치노의 형태와 색을 확인했다. PSU S09와 공유하는 것은 생성 파일뿐이며 의류와 이력을 합치지 않는다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H10",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H10",
      expectedCategory: "bottom",
      expectedColor: "indigo",
      expectedName: "인디고 스트레이트 데님",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "B03",
      asset: {
        id: "asset_B03_v1",
        version: 1,
        sha256:
          "9e2481f333c161afed02758ce494de8e0cc2b8dc531f61421cf5cb8a1625f8e0",
        displayUrl: "/assets/wardrobe-pack/catalog/B03.png",
        displaySha256:
          "9e2481f333c161afed02758ce494de8e0cc2b8dc531f61421cf5cb8a1625f8e0",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "right-outer-shelf-4",
        visualZoneId: "right-outer-shelf-4",
        ledAnchorIds: ["R2_SHELF_04"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[B03] -> PHOTO_VISUAL_ZONES[right-outer-shelf-4] -> R2_SHELF_04",
      },
      decisionReason:
        "짙은 인디고 긴 데님, 5포켓과 대비 스티치, 일자 실루엣을 확인했다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H13",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H13",
      expectedCategory: "outer",
      expectedColor: "beige",
      expectedName: "베이지 트렌치",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "O01",
      asset: {
        id: "asset_O01_v1",
        version: 1,
        sha256:
          "340fecbd39661a5c259b2e6e010d567ed1d8b28fcdc767ecb48eab6d570c3dd9",
        displayUrl: "/assets/wardrobe-pack/catalog/O01.png",
        displaySha256:
          "340fecbd39661a5c259b2e6e010d567ed1d8b28fcdc767ecb48eab6d570c3dd9",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: {
        source: "PHOTO_DEMO_PLACEMENTS",
        version: "mirror-photo-20261009-v1",
        slotId: "left-long-hanging",
        visualZoneId: "left-long-hanging",
        ledAnchorIds: ["L1_RAIL_GROUP"],
        physicalLocationVerified: false,
        mappingPath:
          "photoSceneMapping.PHOTO_DEMO_PLACEMENTS[O01] -> PHOTO_VISUAL_ZONES[left-long-hanging] -> L1_RAIL_GROUP",
      },
      decisionReason:
        "베이지 벨트 트렌치의 긴 기장과 더블 버튼을 확인했다. PSU S12와 별개의 생활 의류를 유지한다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 장면 배치는 로컬 시연 구역만 의미한다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H15",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H15",
      expectedCategory: "shoes",
      expectedColor: "brown",
      expectedName: "브라운 앵클부츠",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "S04",
      asset: {
        id: "asset_S04_v1",
        version: 1,
        sha256:
          "9f35d1037167fbfc4af9a8e8bca16572e37da87574a2008400f2bd3ff4a3375d",
        displayUrl: "/assets/wardrobe-pack/catalog/S04.png",
        displaySha256:
          "9f35d1037167fbfc4af9a8e8bca16572e37da87574a2008400f2bd3ff4a3375d",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: null,
      decisionReason:
        "다크브라운 앵클 길이 부츠 한 켤레, 옆 밴드와 당김 고리를 확인했다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 사진 배경에 해당 신발·가방 전용 시연 위치가 없어 LED는 연결하지 않는다.",
    },
    {
      sourceDataset: "scprep-20261009-v1",
      sourceProfileRef: "PHW",
      sourceGarmentRef: "H16",
      sourceProductRef: null,
      currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
      currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H16",
      expectedCategory: "accessory",
      expectedColor: "black",
      expectedName: "블랙 백팩",
      legacyCatalogDataset: "SmartCloset_Wardrobe_Pack_v1_20261008",
      legacyCatalogRef: "A05",
      asset: {
        id: "asset_A05_v1",
        version: 1,
        sha256:
          "7a98d9c02e547c478d36bcb0712e60150e66dd57711bb3eef51b21ced1989f9d",
        displayUrl: "/assets/wardrobe-pack/catalog/A05.png",
        displaySha256:
          "7a98d9c02e547c478d36bcb0712e60150e66dd57711bb3eef51b21ced1989f9d",
      },
      imageBindingKind: "explicit_example_image",
      productIdentity: "not_verified",
      careApplicability: "insufficient_evidence",
      scene: null,
      decisionReason:
        "블랙 직물풍 백팩, 앞 지퍼 주머니와 양 어깨끈을 확인했다.",
      remainingReview:
        "생성 예시 그림이며 실제 상품·섬유·실물 라벨·피팅·물리 위치를 검증하지 않는다. 사진 배경에 해당 신발·가방 전용 시연 위치가 없어 LED는 연결하지 않는다.",
    },
  ]);

export const PENDING_VISUAL_BINDINGS: readonly PendingVisualBinding[] = freeze([
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S01",
    sourceProductRef: "P04",
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S01",
    expectedCategory: "top",
    expectedColor: "beige",
    expectedName: "베이지 포플린 셔츠",
    candidateLegacyCatalogRef: "T02",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "T02는 아이보리이며 거친 린넨풍 조직과 구김이 뚜렷하다. 베이지 포플린 설정과 색·표면이 다르므로 대체하지 않는다.",
    remainingReview:
      "베이지 포플린 표현에 맞는 기존 생성 자산 또는 별도 검토가 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S03",
    sourceProductRef: "P06",
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S03",
    expectedCategory: "top",
    expectedColor: "cream",
    expectedName: "크림 크롭 카디건",
    candidateLegacyCatalogRef: "O05",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "O05는 허리 아래로 내려오는 긴 몸판, 브이넥과 패치 주머니의 카디건이다. 크림 크롭 카디건의 짧은 기장과 다르다.",
    remainingReview: "크림 크롭 기장에 맞는 시각 자료가 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S05",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S05",
    expectedCategory: "top",
    expectedColor: "black",
    expectedName: "블랙 반소매 티셔츠",
    candidateLegacyCatalogRef: null,
    imageBindingKind: "pending",
    status: "TRUE_ASSET_GAP",
    reason:
      "T06은 네이비 반팔이고 T12는 블랙 긴팔 모크넥이다. 둘 다 블랙 반소매 티셔츠가 아니다.",
    remainingReview: "블랙 반소매 티셔츠 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S06",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S06",
    expectedCategory: "top",
    expectedColor: "navy",
    expectedName: "네이비 니트",
    candidateLegacyCatalogRef: null,
    imageBindingKind: "pending",
    status: "TRUE_ASSET_GAP",
    reason:
      "검토한 카탈로그의 니트는 크림 케이블이며 네이비 상의 T06은 저지 반팔이다. 추가 burgundy-knit도 색이 다르다.",
    remainingReview: "네이비 니트 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S07",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S07",
    expectedCategory: "top",
    expectedColor: "blue_stripe",
    expectedName: "블루 스트라이프 블라우스",
    candidateLegacyCatalogRef: "T08",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason: "T08은 아이보리·네이비 가로줄 크루넥 티셔츠이며 블라우스가 아니다.",
    remainingReview: "블루 스트라이프 블라우스 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S08",
    sourceProductRef: "P05",
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S08",
    expectedCategory: "bottom",
    expectedColor: "black",
    expectedName: "블랙 테일러드 데님",
    candidateLegacyCatalogRef: null,
    imageBindingKind: "pending",
    status: "TRUE_ASSET_GAP",
    reason:
      "B01은 블랙 정장형 주름 슬랙스, B03은 인디고 데님이다. 블랙 데님의 색과 바지 구조를 함께 충족하지 않는다.",
    remainingReview: "블랙 테일러드 데님 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S10",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S10",
    expectedCategory: "bottom",
    expectedColor: "navy",
    expectedName: "네이비 미디 스커트",
    candidateLegacyCatalogRef: "B05",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "B05는 차콜 그레이의 칼주름 스커트이다. 네이비 미디 스커트로 표시하면 색을 바꿔 주장하게 된다.",
    remainingReview: "네이비 미디 스커트 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S11",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S11",
    expectedCategory: "bottom",
    expectedColor: "charcoal",
    expectedName: "차콜 와이드 슬랙스",
    candidateLegacyCatalogRef: null,
    imageBindingKind: "pending",
    status: "TRUE_ASSET_GAP",
    reason:
      "B01은 블랙 일자 슬랙스이고 B04는 밝은 린넨풍 와이드 바지다. 차콜 와이드 슬랙스의 색·폭을 함께 충족하지 않는다.",
    remainingReview: "차콜 와이드 슬랙스 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PSU",
    sourceGarmentRef: "S14",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PSU",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:S14",
    expectedCategory: "dress",
    expectedColor: "blue",
    expectedName: "여름용 원피스",
    candidateLegacyCatalogRef: "D01",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "D01은 블랙 민소매 원피스이며 생활 설정은 블루다. 원피스 종류만으로 색 충돌을 무시하지 않는다.",
    remainingReview: "블루 여름 원피스 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H03",
    sourceProductRef: "P07",
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H03",
    expectedCategory: "top",
    expectedColor: "dark_grey",
    expectedName: "다크그레이 맨투맨",
    candidateLegacyCatalogRef: "T07",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "T07은 밝은 멜란지 그레이다. 추가 gray-sweatshirt.png도 밝은 그레이이며 generated_demo가 아닌 PNGimg 원본이다. 다크그레이 상품의 그림으로 연결하지 않는다.",
    remainingReview: "다크그레이 맨투맨 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H04",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H04",
    expectedCategory: "top",
    expectedColor: "olive",
    expectedName: "올리브 오버셔츠",
    candidateLegacyCatalogRef: "T04",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "T04는 올리브 일반 셔츠로, 길고 둥근 셔츠 밑단과 몸에 가까운 핏이 보인다. 오버셔츠의 여유 있는 겉옷 실루엣을 확인할 수 없다.",
    remainingReview:
      "올리브 오버셔츠의 실루엣이 맞는 자산 또는 예시 적합성 추가 검토가 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H05",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H05",
    expectedCategory: "top",
    expectedColor: "white",
    expectedName: "화이트 반소매 티셔츠",
    candidateLegacyCatalogRef: null,
    imageBindingKind: "pending",
    status: "TRUE_ASSET_GAP",
    reason:
      "화이트 셔츠 T01은 긴팔 버튼업이다. 흰 반소매 티셔츠에 대응하는 생성 자산이 없다.",
    remainingReview: "화이트 반소매 티셔츠 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H06",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H06",
    expectedCategory: "top",
    expectedColor: "black",
    expectedName: "블랙 후드",
    candidateLegacyCatalogRef: "T09",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason: "T09는 워싱된 차콜 회색 후드로 보이며 블랙과 구분된다.",
    remainingReview: "블랙 후드 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H08",
    sourceProductRef: "P03",
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H08",
    expectedCategory: "bottom",
    expectedColor: "black",
    expectedName: "블랙 트윌 팬츠",
    candidateLegacyCatalogRef: "B01",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "B01은 정장형 앞주름과 프레스 선이 뚜렷한 슬랙스이다. 지정된 블랙 트윌 팬츠의 같은 실루엣·제품이라는 근거가 부족하다.",
    remainingReview:
      "블랙 트윌 팬츠에 맞는 그림 또는 명시적 형태 검토가 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H11",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H11",
    expectedCategory: "bottom",
    expectedColor: "navy",
    expectedName: "네이비 여름 팬츠",
    candidateLegacyCatalogRef: null,
    imageBindingKind: "pending",
    status: "TRUE_ASSET_GAP",
    reason:
      "카탈로그에는 네이비 여름 긴바지가 없다. B03은 인디고 데님, B08은 쇼츠다.",
    remainingReview: "네이비 여름 긴바지 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H12",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H12",
    expectedCategory: "outer",
    expectedColor: "navy",
    expectedName: "네이비 블레이저",
    candidateLegacyCatalogRef: "O04",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "O04는 차콜 그레이 블레이저다. O02는 네이비지만 지퍼 봄버 재킷이므로 어느 것도 네이비 블레이저가 아니다.",
    remainingReview: "네이비 블레이저 자산이 필요하다.",
  },
  {
    sourceDataset: "scprep-20261009-v1",
    sourceProfileRef: "PHW",
    sourceGarmentRef: "H14",
    sourceProductRef: null,
    currentLocalProfileId: "local:scprep-20261009-v1:profile:PHW",
    currentCanonicalGarmentId: "local:scprep-20261009-v1:garment:H14",
    expectedCategory: "outer",
    expectedColor: "olive",
    expectedName: "올리브 가벼운 재킷",
    candidateLegacyCatalogRef: "O08",
    imageBindingKind: "pending",
    status: "CONFLICT_REVIEW",
    reason:
      "O08은 밝은 세이지색 후드 바람막이다. 생활 항목의 올리브 재킷과 색·후드 형태 대응이 미확인이다.",
    remainingReview: "올리브 가벼운 재킷과 맞는 자산이 필요하다.",
  },
]);
