import { useEffect, useId, useState } from "react";
import { api, currentDevice } from "./integrations/backendClient";
import { assetUrl } from "../../api.js";
import { bindGarmentImage } from "./imageBlobCache.js";
import { useCachedImage } from "./useCachedImage";
import type { Asset, Garment } from "./core/types";
import { maskViewBox } from "./sceneImageGeometry.js";

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
  mask,
}: {
  raw: any;
  style?: React.CSSProperties;
  itemId?: string;
  mask?: { width: number; height: number; path: string; crop?: number[]; scene_alignment?: "hanging" | "shelf" };
}) {
  const clipId = useId().replace(/:/g, "");
  const image = useCachedImage(asset(raw));
  if (image.url && mask) return (
    <svg style={style} data-scene-item-id={itemId} viewBox={maskViewBox(mask)}
      preserveAspectRatio={mask.scene_alignment === "shelf" ? "xMidYMax meet" : "xMidYMin meet"}>
      <defs><clipPath id={clipId}><path d={mask.path}/></clipPath></defs>
      <image href={image.url} width={mask.width} height={mask.height} clipPath={`url(#${clipId})`}/>
    </svg>
  );
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
  anchorIds = [],
  onSelect,
}: {
  garments: readonly Garment[];
  anchorIds?: readonly string[];
  onSelect?: (garment: Garment) => void;
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
          mask={item.image_mask}
          style={{
            position: "absolute",
            left: `${item.geometry.x * 100}%`,
            top: `${item.geometry.y * 100}%`,
            width: `${item.geometry.width * 100}%`,
            height: `${item.geometry.height * 100}%`,
            zIndex: item.geometry.z_index,
            objectFit: "contain",
            filter: "drop-shadow(2px 3px 2px #0004)",
          }}
        />
      ))}
      {onSelect && scene?.items.map((item: any) => (
        <button key={`hit:${item.garment_id}`} aria-label={`${item.name} 위치 보기`}
          data-scene-hit-id={item.garment_id} onClick={() => {
            const garment = garments.find(g => g.id === item.garment_id);
            if (garment) onSelect(garment);
          }} style={{position:"absolute",left:`${item.geometry.x*100}%`,top:`${item.geometry.y*100}%`,
            width:`${item.geometry.width*100}%`,height:`${item.geometry.height*100}%`,
            zIndex:200+item.geometry.z_index,background:"transparent",border:0,cursor:"pointer",pointerEvents:"auto"}} />
      ))}
      {scene?.items.filter((item: any) => item.anchor_id && anchorIds.includes(item.anchor_id)).map((item: any) => (
        <div key={`led:${item.garment_id}`} data-anchor-id={item.anchor_id} data-led="on"
          className="photo-scene-led" aria-label={`${item.name} 보관 슬롯`}
          style={{position:"absolute",left:`${item.geometry.x*100}%`,top:`${item.geometry.y*100}%`,
            width:`${item.geometry.width*100}%`,height:`${item.geometry.height*100}%`,
            zIndex:400, border:"2px solid #ffd97a",boxShadow:"0 0 12px #ffe096",borderRadius:4,pointerEvents:"none"}} />
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
