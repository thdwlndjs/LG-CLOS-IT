import { DemoError } from "./repository";
import type { Garment, OutfitDraft } from "./types";
/** Capture an exact reference, or reject a stale selection instead of substituting a newer photo. */
export function outfitAssetRefs(
  outfit: Pick<OutfitDraft, "ownerId" | "items" | "assetIds" | "assetVersions">,
  garments: readonly Garment[],
  deviceScoped = false,
) {
  const assetIds: Record<string, string | null> = {},
    assetVersions: Record<string, number> = {};
  for (const [slot, id] of Object.entries(outfit.items)) {
    const found = garments.filter(
        (g) => g.id === id && (deviceScoped || g.ownerId === outfit.ownerId),
      ),
      garment = found[0];
    if (found.length !== 1 || garment.category !== slot)
      throw new DemoError(
        "VALIDATION",
        "현재 사용자에게 허용된 같은 의류를 확인해 주세요.",
      );
    const assetId = garment.asset?.id ?? null,
      version = garment.asset?.version ?? 0;
    if (
      (outfit.assetIds &&
        Object.hasOwn(outfit.assetIds, id) &&
        outfit.assetIds[id] !== assetId) ||
      (outfit.assetVersions &&
        Object.hasOwn(outfit.assetVersions, id) &&
        outfit.assetVersions[id] !== version)
    )
      throw new DemoError(
        "CONFLICT",
        "선택한 의류 사진이 바뀌었어요. 같은 의류의 현재 사진을 다시 확인해 주세요.",
      );
    assetIds[id] = assetId;
    assetVersions[id] = version;
  }
  return { assetIds, assetVersions };
}
