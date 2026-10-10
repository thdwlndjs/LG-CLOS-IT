import { ServerMockFitting } from "./ServerMockFitting";
import { useRef, useState } from "react";
import type { Garment, OutfitDraft } from "./core";
import { app } from "./appInstance";
import { HorizontalPager } from "./HorizontalPager";
import { Icon } from "./Icons";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
import { MirrorPhoto } from "./MirrorGarmentGrid";
import { completeOutfit } from "./core/externalOutfits";
import { describeOutfitCard } from "./outfitCardPresentation";
import "./mirror-compare.css";

/** Comparison presents a single draft. Browsing candidates never mutates it. */
export function MirrorCompare({
  draft,
  garments,
  hasMedia,
  status,
  onBack,
  onEdit,
  onChooseTop,
  onSave,
  onCommit,
  onEnd,
  saving,
  committing,
  recorded,
  onRecords,
  uiState,
  onUIStateChange,
  onMockResult,
}: {
  onMockResult?: (url: string, label?: string) => void;
  uiState?: { quick: boolean; more: boolean; page: number };
  onUIStateChange?: (value: {
    quick: boolean;
    more: boolean;
    page: number;
  }) => void;
  draft: OutfitDraft | undefined;
  garments: Garment[];
  hasMedia: boolean;
  status: string;
  onBack: () => void;
  onEdit: (slot?: "top") => void;
  onChooseTop: (garment: Garment) => void;
  onSave: () => void;
  onCommit: () => void;
  onEnd: () => void;
  saving: boolean;
  committing: boolean;
  recorded: boolean;
  onRecords: () => void;
}) {
  const [ui, setUI] = useState(
    uiState ?? { quick: false, more: false, page: 0 },
  );
  const { quick, more, page } = ui;
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const patch = (change: Partial<typeof ui>) => {
    const next = { ...uiRef.current, ...change };
    uiRef.current = next;
    onUIStateChange?.(next);
    setUI(next);
  };
  const setQuick = (quick: boolean) => patch({ quick }),
    setMore = (more: boolean) => patch({ more }),
    setPage = (page: number) => patch({ page });
  const candidates = garments.filter((g) => g.category === "top"),
    pages: Array<Garment[]> = [];
  for (let i = 0; i < candidates.length; i += 2)
    pages.push(candidates.slice(i, i + 2));
  const presentation = draft
    ? describeOutfitCard({
        outfit: draft,
        ownerId: draft.ownerId,
        garments,
        externalItems: app.externalItems(),
        deviceScoped: app.connection.kind === "supabase",
      })
    : null;
  const locked = !!(draft?.topLocked || draft?.lockedSlots?.top);
  return (
    <section
      className="mc-compare"
      data-outfit-view="compare"
      aria-label="전신 비교"
    >
      <div className="mc-heading">
        <button aria-label="카드 탐색으로 돌아가기" onClick={onBack}>
          <Icon name="back" size={18} />
        </button>
        <strong title={draft?.name}>{draft?.name ?? "전신 비교"}</strong>
        <button
          aria-label="비교 더 보기"
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          ···
        </button>
      </div>
      {presentation && presentation.description !== draft?.name && (
        <small
          className="mc-composition-description"
          title={presentation.description}
        >
          {presentation.description}
        </small>
      )}
      <div className="mc-compare-tools">
        <button
          onClick={() => {
            if (draft?.items.dress || draft?.externalItems?.dress) {
              setQuick(false);
              onEdit();
            } else setQuick(!quick);
            setMore(false);
          }}
          aria-expanded={quick}
        >
          {draft?.items.dress || draft?.externalItems?.dress
            ? "조합 편집"
            : "상의 바꾸기"}
        </button>
        <span>{locked ? "상의 고정됨" : "전신 비교"}</span>
      </div>
      <p className="mx-media-status" role="status">
        {status}
      </p>
      {app.connection.kind === "supabase" && draft && onMockResult && (
        <ServerMockFitting
          key={`${draft.draftId}:${draft.revision}`}
          draft={draft}
          onResult={onMockResult}
        />
      )}
      {!hasMedia && (
        <div className="mc-empty">
          <MirrorOutfitThumbnail
            app={app}
            outfit={{
              ...draft,
              items: draft?.items ?? {},
              name: draft?.name ?? "선택 코디",
            }}
          />
          <p>선택한 구성품</p>
          <small>이 조합의 전신 결과가 없어요</small>
        </div>
      )}
      {more && (
        <div className="mc-more" aria-label="비교 보조 작업">
          <button
            onClick={() => {
              setMore(false);
              onEdit();
            }}
          >
            조합 편집
          </button>
          <button
            disabled={saving || !draft || !completeOutfit(draft)}
            onClick={onSave}
          >
            {saving ? "카드 저장 중" : "코디카드로 저장"}
          </button>
          <button
            onClick={() => {
              setMore(false);
              onEnd();
            }}
          >
            비교 종료
          </button>
        </div>
      )}
      {quick && (
        <section className="mc-quick" aria-label="빠른 상의 교체">
          <header>
            <span>{locked ? "상의 고정됨" : "상의 후보"}</span>
            <button onClick={() => onEdit("top")}>전체에서 고르기</button>
          </header>
          {pages.length ? (
            <HorizontalPager
              label="비교 상의 후보"
              index={page}
              onIndexChange={setPage}
              peek={0}
              showControls={false}
            >
              {pages.map((items, i) => (
                <div className="mc-candidates" key={i}>
                  {items.map((g) => (
                    <button
                      key={g.id}
                      data-garment-id={g.id}
                      title={g.name}
                      aria-label={`${g.name} 상의 선택`}
                      aria-pressed={draft?.items.top === g.id}
                      disabled={locked && draft?.items.top !== g.id}
                      onClick={() => onChooseTop(g)}
                    >
                      <MirrorPhoto
                        garment={g}
                        name={g.name}
                        loadEnabled={Math.abs(i - page) <= 1}
                      />
                      <span>{g.name}</span>
                      {draft?.items.top === g.id && <i aria-hidden="true">✓</i>}
                    </button>
                  ))}
                </div>
              ))}
            </HorizontalPager>
          ) : (
            <p>보유 상의가 없어요</p>
          )}
          <div className="mc-browse">
            <button
              aria-label="이전 상의 후보"
              disabled={page <= 0}
              onClick={() => setPage(Math.max(0, page - 1))}
            >
              ‹
            </button>
            <span>
              {Math.min(page + 1, pages.length)} / {pages.length}
            </span>
            <button
              aria-label="다음 상의 후보"
              disabled={page >= pages.length - 1}
              onClick={() => setPage(Math.min(pages.length - 1, page + 1))}
            >
              ›
            </button>
          </div>
        </section>
      )}
      <div className="mc-primary">
        <button
          className="mx-primary"
          disabled={committing || !draft || !completeOutfit(draft)}
          onClick={onCommit}
        >
          {committing ? "기록하는 중" : "이 코디로 확정"}
        </button>
        <div className="mc-feedback">
          {recorded && (
            <button className="mc-record-link" onClick={onRecords}>
              착용 기록은 별도 확인
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
