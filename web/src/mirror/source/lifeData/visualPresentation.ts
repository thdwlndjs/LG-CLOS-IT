import type { Asset, Garment } from "../core/types";
import { localLifeFingerprint } from "./visualFingerprint";
import { REVIEWED_VISUAL_BINDINGS } from "./reviewedVisualBindings";

export const VISUAL_REPAIR_VERSION = "life-visual-care-20261010-v1";
export const VISUAL_BINDINGS_FINGERPRINT = localLifeFingerprint(
  REVIEWED_VISUAL_BINDINGS,
);
export interface GarmentDisplayBinding {
  repairVersion: string;
  manifestFingerprint: string;
  canonicalGarmentId: string;
  profileId: string;
  legacyCatalogRef: string;
}
export function reviewedBindingFor(garment: Garment) {
  const marker = garment.displayBinding;
  if (
    !marker ||
    garment.asset !== null ||
    marker.repairVersion !== VISUAL_REPAIR_VERSION ||
    marker.manifestFingerprint !== VISUAL_BINDINGS_FINGERPRINT ||
    marker.canonicalGarmentId !== garment.id ||
    marker.profileId !== garment.ownerId
  )
    return null;
  const matches = REVIEWED_VISUAL_BINDINGS.filter(
    (row) =>
      row.currentCanonicalGarmentId === garment.id &&
      row.currentLocalProfileId === garment.ownerId &&
      row.legacyCatalogRef === marker.legacyCatalogRef &&
      row.expectedCategory === garment.category &&
      row.expectedColor === garment.color,
  );
  return matches.length === 1 ? matches[0] : null;
}
/** Presentation only. Never replaces Garment.asset, a fitting input, or an outfit snapshot. */
export function garmentDisplayPresentation(garment: Garment): {
  asset: Asset | null;
  example: boolean;
  revision: string;
  binding: ReturnType<typeof reviewedBindingFor>;
} {
  if (garment.asset)
    return {
      asset: garment.asset,
      example: false,
      revision: `original:${garment.asset.id}:${garment.asset.version}`,
      binding: null,
    };
  const binding = reviewedBindingFor(garment);
  if (!binding)
    return {
      asset: null,
      example: false,
      revision: "unconnected",
      binding: null,
    };
  return {
    asset: {
      id: binding.asset.id,
      version: binding.asset.version,
      source: "packaged",
      url: binding.asset.displayUrl,
    },
    example: true,
    revision: `${VISUAL_REPAIR_VERSION}:${binding.asset.displaySha256}`,
    binding,
  };
}
