import { useState } from "react";
import type { Asset } from "./core/types";
import type { DemoApp } from "./core/app";
import { MirrorPhoto } from "./MirrorGarmentGrid";
import {
  describeOutfitCard,
  type OutfitCardSnapshot,
  type OutfitCardSlot,
} from "./outfitCardPresentation";
import "./mirror-card.css";

/** Every surface renders the same captured IDs and versions. No implicit fitting lookup or cover capture. */
export function MirrorOutfitThumbnail({
  app,
  outfit,
  className = "",
  loadEnabled = true,
}: {
  app: DemoApp;
  outfit: OutfitCardSnapshot & { cardAsset?: Asset };
  className?: string;
  loadEnabled?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = outfit.cardAsset;
  const card = describeOutfitCard({
    outfit,
    ownerId: app.getState().activeProfileId,
    garments: app.garments(),
    externalItems: app.externalItems(),
    deviceScoped: app.connection.kind === "supabase",
  });
  if (image?.url && failed !== image.url && loadEnabled)
    return (
      <div
        className={`mx-panel-composition ${className}`}
        role="img"
        aria-label={`${outfit.name} · 서버 생성 코디카드`}
        data-card-preview="server-image"
      >
        <img
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          src={image.url}
          alt={`${outfit.name} 서버 생성 코디카드`}
          onError={() => setFailed(image.url)}
        />
      </div>
    );
  const main = card.slots.filter(
      (row) =>
        row.slot === "top" || row.slot === "bottom" || row.slot === "dress",
    ),
    secondary = card.slots.filter(
      (row) =>
        row.slot !== "top" && row.slot !== "bottom" && row.slot !== "dress",
    );
  const render = (row: OutfitCardSlot) => (
    <span
      data-slot={row.slot}
      data-garment-id={row.garmentId}
      data-external-item-id={row.externalItemId}
      data-card-status={row.status}
      className={
        row.source === "external"
          ? "mx-card-item mx-external-composition"
          : "mx-card-item"
      }
      key={row.slot}
      title={`${row.name} · ${row.sourceLabel}${row.notice ? " · " + row.notice : ""}`}
    >
      <MirrorPhoto
        loadEnabled={loadEnabled}
        asset={row.asset}
        example={row.example}
        presentationRevision={row.presentationRevision}
        name={`${row.name}${row.source === "external" ? " · 구매 후보" : ""}`}
        compact
        emptyLabel={row.notice || "사진 없음"}
      />
      <small className="mx-card-missing-name" aria-hidden="true">
        {row.label}
      </small>
      {row.source === "external" && (
        <em title={`${row.sourceLabel} · 구매 후보`} aria-label="구매 후보">
          <span className="mx-external-label">구매 후보</span>
          <span className="mx-external-label-compact" aria-hidden="true">
            후보
          </span>
        </em>
      )}
    </span>
  );
  return (
    <div
      className={`mx-panel-composition ${className}`}
      role="img"
      aria-label={`${card.title} · 구성형 카드 · ${card.description}`}
      data-card-preview={card.previewKind}
      data-card-description={card.description}
      data-card-reuse-status={card.reuseStatus}
      data-card-secondary={Boolean(secondary.length)}
    >
      {main.length > 0 && (
        <div className="mx-card-main">{main.map(render)}</div>
      )}
      {secondary.length > 0 && (
        <div className="mx-card-secondary">{secondary.map(render)}</div>
      )}
      {card.slots.length === 0 && (
        <span className="mx-card-empty">
          {card.reuseStatus === "other-profile"
            ? "프로필 확인 필요"
            : "선택한 옷 없음"}
        </span>
      )}
    </div>
  );
}
