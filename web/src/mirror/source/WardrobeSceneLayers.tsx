import { useEffect, useState } from "react";
import { api, currentDevice } from "./integrations/backendClient";
import { assetUrl } from "../../api.js";
import { bindGarmentImage } from "./imageBlobCache.js";
import { useCachedImage } from "./useCachedImage";
import type { Asset, Garment } from "./core/types";

function asset(raw: any): Asset {
  return {
    id: raw.asset_id,
    version: 1,
    source: "storage",
    url: assetUrl(raw.read_url),
    expiresAt: raw.expires_at,
  };
}
function SceneImage({
  raw,
  style,
  itemId,
}: {
  raw: any;
  style?: React.CSSProperties;
  itemId?: string;
}) {
  const image = useCachedImage(asset(raw));
  return image.url ? (
    <img
      data-scene-item-id={itemId}
      src={image.url}
      alt=""
      style={style}
      draggable={false}
    />
  ) : (
    <span data-scene-image-status={image.failed ? "failed" : "loading"} />
  );
}
export function WardrobeSceneLayers({
  garments,
}: {
  garments: readonly Garment[];
}) {
  const [scene, setScene] = useState<any>(null);
  const [error, setError] = useState("");
  const device = currentDevice();
  const revision = garments
    .map((g) => `${g.id}:${g.revision}:${g.location}`)
    .sort()
    .join("|");
  useEffect(() => {
    let active = true;
    setScene(null);
    setError("");
    if (!device) return;
    const path = `/integration/devices/${device}/scene`;
    api()
      .get(path)
      .then((value: any) => {
        if (!active || currentDevice() !== device) return;
        if (value.frame)
          bindGarmentImage(
            `scene-frame:${device}`,
            { id: value.frame.asset_id },
            async () => {
              if (!active || currentDevice() !== device)
                throw Error("Scene session changed");
              const fresh: any = await api().get(path);
              if (
                !active ||
                currentDevice() !== device ||
                fresh.frame?.asset_id !== value.frame.asset_id
              )
                throw Error("Scene image changed");
              return asset(fresh.frame);
            },
          );
        setScene(value);
      })
      .catch(() => {
        if (active) setError("옷장 위치·에셋을 확인할 수 없습니다.");
      });
    return () => {
      active = false;
    };
  }, [device, revision]);
  return (
    <div
      className="photo-db-scene"
      data-scene-status={scene?.quality_status ?? "unavailable"}
    >
      {scene?.frame && (
        <SceneImage
          raw={scene.frame}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
      )}
      {scene?.items.map((item: any) => (
        <SceneImage
          key={item.garment_id}
          itemId={item.garment_id}
          raw={item.image}
          style={{
            position: "absolute",
            left: `${item.geometry.x * 100}%`,
            top: `${item.geometry.y * 100}%`,
            width: `${item.geometry.width * 100}%`,
            height: `${item.geometry.height * 100}%`,
            zIndex: item.geometry.z_index,
            objectFit: "contain",
          }}
        />
      ))}
      {!scene?.frame && (
        <span className="photo-scene-status">
          {error ||
            "빈 옷장 원본·슬롯 승인 대기 · 의류 위치를 임의 표시하지 않습니다."}
        </span>
      )}
      {scene?.blocked.length > 0 && (
        <span className="photo-scene-status">
          표시 보류 {scene.blocked.length}개 · 위치·사진 확인 필요
        </span>
      )}
    </div>
  );
}
