import type { Asset } from "./core/types";
import type { FittingSnapshot } from "./mirrorScene";
import { stable } from "./core/repository";

/** Content equality never grants display permission. Keep snapshot/request epoch guards separate. */
export function fittingContentKey(snapshot: FittingSnapshot): string {
  return stable({
    ownerId: snapshot.ownerId,
    person: snapshot.person,
    owned: snapshot.outfit.items
      .map((row) => ({ ...row, source: "owned" }))
      .sort((a, b) => a.slot.localeCompare(b.slot)),
    external: (snapshot.outfit.externalItems ?? [])
      .map((row) => ({ ...row, source: "external" }))
      .sort((a, b) => a.slot.localeCompare(b.slot)),
  });
}
export function privateFittingInputKey(asset: Asset): string {
  return stable({ id: asset.id, version: asset.version, source: asset.source });
}
