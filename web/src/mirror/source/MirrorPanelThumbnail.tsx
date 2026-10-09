import type { DemoApp } from "./core/app";
import type { Outfit } from "./core/types";

/** Composition from stored IDs and versions. Never borrow another look's fitting or updated image. */
export function MirrorOutfitThumbnail({
  app,
  outfit,
}: {
  app: DemoApp;
  outfit: Pick<Outfit, "name" | "items" | "externalItems"> & {
    assetVersions?: Record<string, number>;
  };
}) {
  const garments = app.garments(),
    external = app.externalItems();
  return (
    <div
      className="mx-panel-composition"
      aria-label={`${outfit.name} 구성 의류`}
    >
      {Object.entries(outfit.items).map(([slot, id]) => {
        const garment = garments.find((item) => item.id === id),
          asset = garment?.asset,
          exact =
            !!asset &&
            (!outfit.assetVersions ||
              outfit.assetVersions[id] === asset.version);
        return (
          <span data-slot={slot} data-garment-id={id} key={slot}>
            {exact && asset.url ? (
              <img src={asset.url} alt={garment!.name} draggable={false} />
            ) : (
              <small>{garment?.name ?? "의류 정보 확인 필요"}</small>
            )}
          </span>
        );
      })}
      {Object.entries(outfit.externalItems ?? {}).map(([slot, item]) => {
        const asset = external.find(
            (candidate) => candidate.id === item.externalItemId,
          )?.asset,
          exact =
            asset &&
            asset.id === item.assetId &&
            asset.version === item.assetVersion;
        return (
          <span
            data-slot={slot}
            data-external-item-id={item.externalItemId}
            className="mx-external-composition"
            key={`external-${slot}`}
          >
            {exact && asset.url ? (
              <img
                src={asset.url}
                alt={`${item.name} · 구매 후보`}
                draggable={false}
              />
            ) : (
              <small>{item.name}</small>
            )}
            <em>구매 후보</em>
          </span>
        );
      })}
    </div>
  );
}
