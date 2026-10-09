import { useEffect, useState } from "react";
import type { Asset, Garment } from "./core/types";
import { HorizontalPager } from "./HorizontalPager";
export const GARMENT_PAGE_SIZE = 12;
export function MirrorPhoto({
  asset,
  name,
}: {
  asset: Asset | null | undefined;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset?.id, asset?.version, asset?.url]);
  return asset?.url && !failed ? (
    <img
      src={asset.url}
      alt={name}
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="mg-photo-empty">사진 없음</span>
  );
}
export function garmentPages<T>(
  items: readonly T[],
  size = GARMENT_PAGE_SIZE,
): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    pages.push(items.slice(i, i + size));
  return pages;
}
export function MirrorGarmentGrid({
  garments,
  index,
  onIndexChange,
  onSelect,
  label = "의류 탐색",
  selectedId,
  pageSize = GARMENT_PAGE_SIZE,
}: {
  garments: Garment[];
  index: number;
  onIndexChange: (value: number) => void;
  onSelect: (garment: Garment) => void;
  label?: string;
  selectedId?: string;
  pageSize?: number;
}) {
  const pages = garmentPages(
    garments,
    Math.max(1, Math.min(24, Math.trunc(pageSize) || GARMENT_PAGE_SIZE)),
  );
  const valid = Math.max(0, Math.min(index, pages.length - 1));
  return pages.length ? (
    <HorizontalPager
      label={label}
      index={valid}
      onIndexChange={onIndexChange}
      peek={0}
    >
      {pages.map((page, i) => (
        <div className="mg-grid" key={i} data-garment-page={i}>
          {page.map((g) => (
            <button
              className="mg-cell"
              key={g.id}
              data-garment-id={g.id}
              aria-label={`${g.name} 선택`}
              aria-pressed={g.id === selectedId}
              onClick={() => onSelect(g)}
            >
              <MirrorPhoto asset={g.asset} name={g.name} />
              <span>{g.name}</span>
            </button>
          ))}
        </div>
      ))}
    </HorizontalPager>
  ) : (
    <p className="mx-glass">조건에 맞는 옷이 없어요.</p>
  );
}
