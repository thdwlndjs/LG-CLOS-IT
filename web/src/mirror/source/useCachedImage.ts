import { useEffect, useState, useSyncExternalStore } from "react";
import type { Asset } from "./core/types";
import {
  cachedImage,
  loadCachedImage,
  imageCacheRevision,
  subscribeImageCache,
} from "./imageBlobCache.js";
/** Cache owns Object URLs; consumers must never revoke a shared URL. */
export function useCachedImage(
  asset: Asset | null | undefined,
  enabled = true,
) {
  useSyncExternalStore(
    subscribeImageCache,
    imageCacheRevision,
    imageCacheRevision,
  );
  const key = asset ? `${asset.id}:${asset.version}` : "";
  const [result, setResult] = useState<{ key: string; failed: boolean } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    if (!asset || asset.source !== "storage" || !enabled) return;
    setResult(null);
    loadCachedImage(asset)
      .then(() => {
        if (active) setResult({ key, failed: false });
      })
      .catch(() => {
        if (active) setResult({ key, failed: true });
      });
    return () => {
      active = false;
    };
  }, [key, asset?.url, enabled]);
  return {
    url: asset?.source === "storage" ? cachedImage(asset) : asset?.url,
    failed: result?.key === key && result.failed,
  };
}
