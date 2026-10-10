import { garmentDisplayPresentation } from "./lifeData/visualPresentation";
import type {
  Asset,
  ExternalItem,
  ExternalOutfitItems,
  Garment,
  OutfitItems,
  Slot,
} from "./core/types";
import { OUTFIT_SLOT_KEYS, OUTFIT_SLOT_NAMES } from "./core/externalOutfits";

/** Display-only view of an existing combination. No media fetch, persistence, or inferred replacement. */
export interface OutfitCardSnapshot {
  name: string;
  items: OutfitItems;
  externalItems?: ExternalOutfitItems;
  ownerId?: string;
  nameOrigin?: "auto" | "user" | "legacy";
  assetVersions?: Record<string, number>;
  assetIds?: Record<string, string | null>;
}
export interface OutfitCardSlot {
  slot: Slot;
  label: string;
  name: string;
  source: "owned" | "external";
  sourceLabel: string;
  garmentId?: string;
  externalItemId?: string;
  asset: Asset | null;
  example?: boolean;
  presentationRevision?: string;
  status:
    "ready" | "missing-photo" | "asset-changed" | "missing-item" | "conflict";
  notice: string;
}
export interface OutfitCardPresentation {
  title: string;
  description: string;
  slots: OutfitCardSlot[];
  previewKind: "composition";
  reuseStatus: "ready" | "needs-review" | "other-profile";
}
const brief = (value: string, max = 72) =>
  value.length > max ? value.slice(0, max - 1).trimEnd() + "…" : value;
/** Unknown old/user titles are never treated as generated copy. Callers persist this only for explicit auto titles. */
export function automaticOutfitTitle(
  outfit: {
    ownerId: string;
    items: OutfitItems;
    externalItems?: ExternalOutfitItems;
  },
  garments: readonly Garment[],
  deviceScoped = false,
): string {
  const names = OUTFIT_SLOT_KEYS.flatMap((slot) => {
    const id = outfit.items[slot],
      external = outfit.externalItems?.[slot];
    if (!id && !external) return [];
    if (id && external) return [`${OUTFIT_SLOT_NAMES[slot]} 확인 필요`];
    if (external)
      return [`${external.name.trim() || OUTFIT_SLOT_NAMES[slot]} (구매 후보)`];
    const candidates = garments.filter(
      (garment) =>
        garment.id === id &&
        (deviceScoped || garment.ownerId === outfit.ownerId) &&
        garment.category === slot,
    );
    return [
      candidates.length === 1
        ? candidates[0].name.trim() || OUTFIT_SLOT_NAMES[slot]
        : `${OUTFIT_SLOT_NAMES[slot]} 확인 필요`,
    ];
  });
  return names.length
    ? brief(
        names.slice(0, 2).join(" · ") +
          (names.length > 2 ? ` 외 ${names.length - 2}개` : ""),
      )
    : "선택한 옷 없음";
}
export function describeOutfitCard({
  outfit,
  ownerId,
  garments,
  externalItems = [],
  deviceScoped = false,
}: {
  outfit: OutfitCardSnapshot;
  ownerId: string;
  garments: readonly Garment[];
  externalItems?: readonly ExternalItem[];
  deviceScoped?: boolean;
}): OutfitCardPresentation {
  if (outfit.ownerId && outfit.ownerId !== ownerId)
    return {
      title: "다른 프로필 코디",
      description: "현재 프로필에서 확인할 수 없는 코디",
      slots: [],
      previewKind: "composition",
      reuseStatus: "other-profile",
    };
  const slots: OutfitCardSlot[] = OUTFIT_SLOT_KEYS.flatMap<OutfitCardSlot>(
    (slot) => {
      const id = outfit.items[slot],
        selected = outfit.externalItems?.[slot],
        label = OUTFIT_SLOT_NAMES[slot];
      if (!id && !selected) return [];
      const common = {
        slot,
        label,
        garmentId: id,
        externalItemId: selected?.externalItemId,
      };
      if (id && selected)
        return [
          {
            ...common,
            name: `${label} 구성 확인 필요`,
            source: "owned" as const,
            sourceLabel: "구성 확인 필요",
            asset: null,
            status: "conflict" as const,
            notice: "같은 칸에 두 출처가 연결되어 있어요.",
          },
        ];
      if (selected) {
        const matches = externalItems.filter(
            (item) =>
              item.ownerId === ownerId && item.id === selected.externalItemId,
          ),
          item = matches.length === 1 ? matches[0] : undefined;
        if (!item || (item.category && item.category !== slot))
          return [
            {
              ...common,
              name: `${label} 구매 후보 확인 필요`,
              source: "external" as const,
              sourceLabel: "구매 후보",
              asset: null,
              status: "missing-item" as const,
              notice: "현재 접근 가능한 같은 구매 후보를 확인해 주세요.",
            },
          ];
        const exact =
          (item.asset?.id ?? null) === selected.assetId &&
          (item.asset?.version ?? null) === selected.assetVersion &&
          item.sourceLabel === selected.sourceLabel &&
          item.sourceUrl === selected.sourceUrl;
        const available =
          exact && !item.asset?.needsReselection && !!item.asset?.url;
        return [
          {
            ...common,
            name: selected.name || item.name,
            source: "external" as const,
            sourceLabel: selected.sourceLabel,
            asset: available ? item.asset : null,
            status: !exact
              ? ("asset-changed" as const)
              : available
                ? ("ready" as const)
                : ("missing-photo" as const),
            notice: !exact ? "사진 확인 필요" : available ? "" : "사진 없음",
          },
        ];
      }
      const matches = garments.filter(
          (garment) =>
            (deviceScoped || garment.ownerId === ownerId) &&
            garment.id === id &&
            garment.category === slot,
        ),
        garment = matches.length === 1 ? matches[0] : undefined;
      if (!garment)
        return [
          {
            ...common,
            name: `${label} 의류 확인 필요`,
            source: "owned" as const,
            sourceLabel: "보유 의류",
            asset: null,
            status: "missing-item" as const,
            notice: "삭제되었거나 접근할 수 없는 의류예요.",
          },
        ];
      const asset = garment.asset,
        exact =
          (!outfit.assetVersions ||
            outfit.assetVersions[id!] === (asset?.version ?? 0)) &&
          (!outfit.assetIds ||
            outfit.assetIds[id!] === asset?.id ||
            (outfit.assetIds[id!] === null && !asset));
      const display = garmentDisplayPresentation(garment);
      const available =
        exact && !display.asset?.needsReselection && !!display.asset?.url;
      return [
        {
          ...common,
          name: garment.name,
          source: "owned" as const,
          sourceLabel: display.example
            ? "보유 의류 · 예시 이미지"
            : "보유 의류",
          example: display.example,
          presentationRevision: display.revision,
          asset: available ? display.asset : null,
          status: !exact
            ? ("asset-changed" as const)
            : available
              ? ("ready" as const)
              : ("missing-photo" as const),
          notice: !exact ? "사진 확인 필요" : available ? "" : "사진 없음",
        },
      ];
    },
  );
  const description =
    slots
      .map(
        (row) =>
          `${row.name}${row.source === "external" ? " (구매 후보)" : ""}${["missing-item", "conflict"].includes(row.status) ? "" : row.status === "asset-changed" ? " · 사진 확인 필요" : ""}`,
      )
      .join(" · ") || "선택한 옷 없음";
  const automatic = automaticOutfitTitle(
    { ...outfit, ownerId },
    garments,
    deviceScoped,
  );
  return {
    title:
      outfit.nameOrigin === "auto"
        ? automatic
        : outfit.name.trim() || automatic,
    description,
    slots,
    previewKind: "composition",
    reuseStatus: slots.some((row) =>
      ["missing-item", "asset-changed", "conflict"].includes(row.status),
    )
      ? "needs-review"
      : "ready",
  };
}
