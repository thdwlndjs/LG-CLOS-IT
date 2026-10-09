import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { app } from "./appInstance";
import { renderCard } from "./serverActions";
import { MirrorStyleReference } from "./MirrorStyleReference";
import type {
  Asset,
  ExternalItem,
  Outfit,
  OutfitDraft,
  OutfitItems,
  Slot,
} from "./core/types";
import {
  completeOutfit,
  OUTFIT_SLOT_KEYS,
  OUTFIT_SLOT_NAMES,
  slotIsLocked,
} from "./core/externalOutfits";
import { HorizontalPager } from "./HorizontalPager";
import { MirrorGarmentGrid } from "./MirrorGarmentGrid";
import "./mirror-outfit-workspace.css";
export interface MirrorOutfitWorkspaceProps {
  onOpenLook: (look: Outfit) => void;
  onDraftChange: () => void;
  onRequestFitting: () => void;
  onNotice?: (message: string) => void;
  initialTab?: "mine" | "edit";
  initialSlot?: Slot;
}
const pages = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
function Photo({
  asset,
  name,
}: {
  asset: Asset | null | undefined;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset?.id, asset?.version]);
  return asset?.url && !failed ? (
    <img
      src={asset.url}
      alt={name}
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="mow-photo-missing">사진 대기</span>
  );
}
function Thumb({
  look,
}: {
  look: Pick<Outfit, "name" | "items" | "externalItems"> & {
    assetVersions?: Record<string, number>;
    cardAsset?: Asset;
  };
}) {
  if (look.cardAsset)
    return (
      <span className="mow-thumb" aria-label={look.name}>
        <Photo asset={look.cardAsset} name={look.name} />
      </span>
    );
  return (
    <span className="mow-thumb" aria-label={look.name}>
      {OUTFIT_SLOT_KEYS.map((slot) => {
        const garment = app
            .garments()
            .find((item) => item.id === look.items[slot]),
          external = look.externalItems?.[slot],
          item =
            external &&
            app
              .externalItems()
              .find((item) => item.id === external.externalItemId);
        const asset = garment
          ? look.assetVersions &&
            look.assetVersions[garment.id] !== garment.asset?.version
            ? null
            : garment.asset
          : item &&
              external &&
              item.asset?.id === external.assetId &&
              item.asset.version === external.assetVersion
            ? item.asset
            : null;
        return garment || external ? (
          <span key={slot} data-slot={slot}>
            <Photo asset={asset} name={garment?.name ?? external?.name ?? ""} />
            {external && <i>후보</i>}
          </span>
        ) : null;
      })}
    </span>
  );
}
export function MirrorOutfitWorkspace({
  onOpenLook,
  onDraftChange,
  onRequestFitting,
  onNotice,
  initialTab = "mine",
  initialSlot,
}: MirrorOutfitWorkspaceProps) {
  const state = useSyncExternalStore(app.subscribe, app.getState),
    owner = state.activeProfileId,
    draft = app.outfitDraft(),
    repository = app.repository;
  const [tab, setTab] = useState<"mine" | "styles" | "edit">(
      initialSlot ? "edit" : initialTab,
    ),
    [libraryFilter, setLibraryFilter] = useState<
      "all" | "instagram" | "shopping"
    >("all");
  const [slot, setSlot] = useState<Slot>(initialSlot ?? "top"),
    [picker, setPicker] = useState(Boolean(initialSlot)),
    [source, setSource] = useState<"owned" | "external">("owned");
  const [page, setPage] = useState(0),
    [slotPage, setSlotPage] = useState(0),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [help, setHelp] = useState(false),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [nameOpen, setNameOpen] = useState(false),
    [styleSelected, setStyleSelected] = useState<ExternalItem | null>(null),
    [styleUpload, setStyleUpload] = useState(false);
  const [proposal, setProposal] = useState<{
    source: OutfitDraft;
    items: OutfitItems;
    label: string;
  } | null>(null);
  const current = useRef({ owner, repository });
  current.current = { owner, repository };
  const mounted = useRef(true);
  const saveBusy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setTab(initialSlot ? "edit" : initialTab);
    setSlot(initialSlot ?? "top");
    setPicker(Boolean(initialSlot));
    setPage(0);
    setNotice("");
    setProposal(null);
    setHelp(false);
    setBusy(false);
    setSaving(false);
    setStyleSelected(null);
    setStyleUpload(false);
  }, [owner, repository]);
  useEffect(() => {
    if (
      proposal &&
      (proposal.source.draftId !== draft?.draftId ||
        proposal.source.revision !== draft?.revision)
    )
      setProposal(null);
  }, [draft?.draftId, draft?.revision, proposal]);
  const message = (text: string) => {
    setNotice(text);
  };
  const run = (fn: () => void) => {
    try {
      fn();
      setProposal(null);
      setNotice("");
      onDraftChange();
    } catch (e) {
      message((e as Error).message);
    }
  };
  const chooseTab = (next: typeof tab) => {
    setNotice("");
    setTab(next);
    setPage(0);
    setPicker(false);
    setHelp(false);
    setStyleSelected(null);
    setStyleUpload(false);
  };
  const start = () =>
    run(() => {
      app.startBlankOutfit();
      setTab("edit");
      setPicker(true);
      setSlot("top");
      setSource("owned");
      setPage(0);
    });
  const open = (look: Outfit) =>
    run(() => {
      app.loadOutfitDraft(look.id);
      setTab("edit");
      setPicker(false);
      onOpenLook(look);
    });
  const owned = app.garments().filter((item) => item.category === slot),
    externals = app.externalItems();
  const categoryCandidates = externals.filter(
    (item) => item.category === slot || item.category === undefined,
  );
  const sourceKind = (item: ExternalItem) =>
    (item.sourceUrl &&
      /^https:\/\/(?:www\.)?instagram\.com(?:\/|$)/i.test(item.sourceUrl)) ||
    /인스타|instagram/i.test(item.sourceLabel)
      ? "instagram"
      : /쇼핑|상품|shopping|store/i.test(item.sourceLabel) ||
          (!!item.sourceUrl &&
            /^https:\/\/(?:www\.)?(?:musinsa\.com|29cm\.co\.kr|wconcept\.co\.kr)(?:\/|$)/i.test(
              item.sourceUrl,
            ))
        ? "shopping"
        : "unknown";
  const styles = externals.filter(
    (item) => libraryFilter === "all" || sourceKind(item) === libraryFilter,
  );
  const looks = app.outfits().filter((item) => !item.name.startsWith("__"));
  const selectSlot = (next: Slot) => {
    if (!draft) app.startBlankOutfit();
    setSlot(next);
    setPicker(true);
    setSource("owned");
    setPage(0);
    setHelp(false);
  };
  const save = async () => {
    if (saveBusy.current || !draft) return;
    const captured = {
      owner,
      repository,
      draftId: draft.draftId,
      revision: draft.revision,
    };
    saveBusy.current = true;
    setSaving(true);
    setNotice("코디카드를 저장하고 있어요");
    try {
      const result = await app.saveOutfit(
        `mirror-card:${captured.draftId}:${captured.revision}`,
      );
      await renderCard(result.entity.id);
      if (
        !mounted.current ||
        current.current.owner !== captured.owner ||
        current.current.repository !== captured.repository
      )
        return;
      message(
        result.replayed
          ? "이미 저장된 코디카드를 확인했어요."
          : "코디카드를 저장했어요. 오늘 선택·실착은 별도예요.",
      );
    } catch (e) {
      if (
        mounted.current &&
        current.current.owner === captured.owner &&
        current.current.repository === captured.repository
      )
        message((e as Error).message);
    } finally {
      saveBusy.current = false;
      if (
        mounted.current &&
        current.current.owner === captured.owner &&
        current.current.repository === captured.repository
      )
        setSaving(false);
    }
  };
  const ask = async (reference?: string) => {
    const captured = { owner, repository };
    setBusy(true);
    setNotice("현재 선택과 고정 조건으로 도움을 요청해요");
    try {
      const result = await app.proposeOutfit(
        {
          weather: "unavailable",
          temperatureC: 0,
          occasion:
            prompt.trim() ||
            `${OUTFIT_SLOT_NAMES[slot]} 후보 제안; 고정 품목 유지`,
        },
        reference,
      );
      if (
        !mounted.current ||
        current.current.owner !== captured.owner ||
        current.current.repository !== captured.repository
      )
        return;
      if (result.status === "success") {
        setProposal(result.data);
        message(result.data.label + " · 선택 전에는 바꾸지 않아요");
      } else message(result.message);
    } catch (e) {
      if (
        mounted.current &&
        current.current.owner === captured.owner &&
        current.current.repository === captured.repository
      )
        message((e as Error).message);
    } finally {
      if (
        mounted.current &&
        current.current.owner === captured.owner &&
        current.current.repository === captured.repository
      )
        setBusy(false);
    }
  };
  const externalGrid = (
    records: ExternalItem[],
    select: (item: ExternalItem) => void,
  ) => (
    <HorizontalPager
      index={page}
      onIndexChange={setPage}
      label="외부 후보 페이지"
      peek={0}
      gap={6}
      items={pages(records, 6)}
      renderItem={(items) => (
        <div className="mow-candidate-grid">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-external-id={item.id}
              onClick={() => select(item)}
            >
              <Photo asset={item.asset} name={item.name} />
              <span>{item.name}</span>
              <small>
                {item.category
                  ? OUTFIT_SLOT_NAMES[item.category]
                  : "종류 미확인"}{" "}
                · 구매 후보
              </small>
            </button>
          ))}
        </div>
      )}
    />
  );
  return (
    <section
      className="mirror-outfit-workspace"
      aria-label="코디 작업실"
      data-owner-id={owner}
    >
      <nav className="mow-tabs" aria-label="코디 메뉴">
        {(
          [
            ["mine", "내 코디"],
            ["styles", "스타일 보관함"],
            ["edit", "코디 만들기"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => chooseTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "mine" && (
        <>
          <div className="mow-toolbar">
            <span>{looks.length}개 코디</span>
            <button type="button" onClick={start}>
              + 새 조합
            </button>
          </div>
          {looks.length ? (
            <HorizontalPager
              index={page}
              onIndexChange={setPage}
              label="저장 코디 페이지"
              peek={0}
              gap={6}
              items={pages(looks, 4)}
              renderItem={(items) => (
                <div className="mow-look-grid">
                  {items.map((look) => (
                    <button
                      key={look.id}
                      type="button"
                      data-outfit-id={look.id}
                      onClick={() => open(look)}
                    >
                      <Thumb look={look} />
                      <span>{look.name}</span>
                    </button>
                  ))}
                </div>
              )}
            />
          ) : (
            <p className="mow-empty">
              저장된 코디가 없어요. 새 조합을 만들 수 있어요.
            </p>
          )}
          {draft && (
            <button
              type="button"
              className="mow-text-action"
              onClick={() => chooseTab("edit")}
            >
              편집 중인 코디 이어서 보기
            </button>
          )}
        </>
      )}
      {tab === "styles" && (
        <>
          {styleUpload ? (
            <MirrorStyleReference
              onBack={() => setStyleUpload(false)}
              onUseReference={(assetId) => {
                setTab("edit");
                setHelp(true);
                setPicker(false);
                void ask(assetId);
              }}
            />
          ) : styleSelected ? (
            <div className="mow-style-detail">
              <button type="button" onClick={() => setStyleSelected(null)}>
                ← 스타일 보관함
              </button>
              <Photo asset={styleSelected.asset} name={styleSelected.name} />
              <strong>{styleSelected.name}</strong>
              <p>{styleSelected.sourceLabel} · 구매 후보</p>
              <button
                type="button"
                onClick={() => {
                  const item = styleSelected;
                  chooseTab("edit");
                  setSlot(item.category ?? "outer");
                  setSource("external");
                  setPicker(true);
                  message(
                    item.category
                      ? "구매 후보에서 선택해 조합에 넣어 주세요."
                      : "종류 미확인 자료예요. 넣을 슬롯을 직접 선택해 주세요.",
                  );
                }}
              >
                상품 자체를 조합에 넣기
              </button>
              <button
                type="button"
                disabled={busy || !styleSelected.asset}
                onClick={() => {
                  const asset = styleSelected.asset;
                  if (!asset) return;
                  setTab("edit");
                  setHelp(true);
                  setPicker(false);
                  void ask(asset.id);
                }}
              >
                내 옷으로 재구성 제안
              </button>
              {!styleSelected.asset && (
                <small>
                  참고 자산 자료 대기 · 상품 선택은 계속할 수 있어요.
                </small>
              )}
              <small>
                재구성은 내 옷 제안이며 이 상품의 소유·구매를 기록하지 않아요.
              </small>
            </div>
          ) : (
            <>
              <div className="mow-toolbar">
                <span>제공된 참고 자료</span>
                <button type="button" onClick={() => setStyleUpload(true)}>
                  사진 참고
                </button>
              </div>
              <nav className="mow-small-tabs" aria-label="스타일 출처">
                {(
                  [
                    ["all", "전체"],
                    ["instagram", "인스타"],
                    ["shopping", "쇼핑몰"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={libraryFilter === value}
                    onClick={() => {
                      setLibraryFilter(value);
                      setPage(0);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {styles.length ? (
                externalGrid(styles, setStyleSelected)
              ) : (
                <p className="mow-empty">
                  이 출처로 제공된 자료가 없어요.
                  <br />
                  외부 후보 자료 대기
                </p>
              )}
              <small>
                저장된 자료만 표시해요. 계정 로그인·새 수집은 실행하지 않아요.
              </small>
            </>
          )}
        </>
      )}
      {tab === "edit" && (
        <>
          {!draft ? (
            <>
              <p className="mow-empty">
                내 옷과 제공된 구매 후보로 조합해 보세요.
              </p>
              <button type="button" onClick={start}>
                빈 코디로 시작
              </button>
            </>
          ) : (
            <>
              {!help && (
                <>
                  <div className="mow-toolbar">
                    <button
                      type="button"
                      className="mow-name"
                      onClick={() => setNameOpen(!nameOpen)}
                    >
                      {draft.name || "코디 이름"} ✎
                    </button>
                    <button
                      type="button"
                      onClick={start}
                      aria-label="빈 코디 새로 만들기"
                    >
                      새 조합
                    </button>
                  </div>
                  {nameOpen && (
                    <label className="mow-label">
                      코디 이름
                      <input
                        aria-label="코디 이름"
                        maxLength={160}
                        value={draft.name}
                        onChange={(event) =>
                          app.editOutfitName(event.target.value)
                        }
                      />
                    </label>
                  )}
                  {!picker && (
                    <HorizontalPager
                      index={slotPage}
                      onIndexChange={setSlotPage}
                      label="구성 슬롯"
                      peek={0}
                      gap={6}
                      items={pages(OUTFIT_SLOT_KEYS, 4)}
                      renderItem={(slots) => (
                        <div className="mow-slot-grid">
                          {slots.map((value) => {
                            const garment = app
                                .garments()
                                .find((item) => item.id === draft.items[value]),
                              external = draft.externalItems?.[value],
                              item =
                                external &&
                                externals.find(
                                  (item) => item.id === external.externalItemId,
                                );
                            return (
                              <div
                                key={value}
                                className="mow-slot"
                                data-selected={picker && slot === value}
                              >
                                <button
                                  type="button"
                                  aria-label={`${OUTFIT_SLOT_NAMES[value]} 선택`}
                                  onClick={() => selectSlot(value)}
                                >
                                  <Photo
                                    asset={garment?.asset ?? item?.asset}
                                    name={
                                      garment?.name ??
                                      external?.name ??
                                      OUTFIT_SLOT_NAMES[value]
                                    }
                                  />
                                  <span>{OUTFIT_SLOT_NAMES[value]}</span>
                                  {external && <small>구매 후보</small>}
                                </button>
                                {(garment || external) && (
                                  <button
                                    type="button"
                                    className="mow-lock"
                                    aria-label={`${OUTFIT_SLOT_NAMES[value]} ${slotIsLocked(draft, value) ? "고정 해제" : "고정"}`}
                                    aria-pressed={slotIsLocked(draft, value)}
                                    onClick={() =>
                                      run(() => app.toggleSlotLock(value))
                                    }
                                  >
                                    {slotIsLocked(draft, value)
                                      ? "고정됨"
                                      : "고정"}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    />
                  )}
                  {picker && (
                    <>
                      <div className="mow-toolbar">
                        <select
                          aria-label="교체할 품목"
                          value={slot}
                          onChange={(event) =>
                            selectSlot(event.target.value as Slot)
                          }
                        >
                          {OUTFIT_SLOT_KEYS.map((value) => (
                            <option key={value} value={value}>
                              {OUTFIT_SLOT_NAMES[value]} 선택
                            </option>
                          ))}
                        </select>
                        <button type="button" onClick={() => setPicker(false)}>
                          접기
                        </button>
                      </div>
                      <nav className="mow-small-tabs" aria-label="후보 범위">
                        <button
                          type="button"
                          aria-pressed={source === "owned"}
                          onClick={() => {
                            setSource("owned");
                            setPage(0);
                          }}
                        >
                          내 옷
                        </button>
                        <button
                          type="button"
                          aria-pressed={source === "external"}
                          onClick={() => {
                            setSource("external");
                            setPage(0);
                          }}
                        >
                          쇼핑 후보
                        </button>
                        <button
                          type="button"
                          disabled={
                            !draft.items[slot] && !draft.externalItems?.[slot]
                          }
                          onClick={() => run(() => app.removeOutfitItem(slot))}
                        >
                          빼기
                        </button>
                      </nav>
                      {source === "owned" ? (
                        <MirrorGarmentGrid
                          pageSize={6}
                          garments={owned}
                          index={page}
                          onIndexChange={setPage}
                          onSelect={(garment) =>
                            run(() => {
                              if (draft.items[slot] !== garment.id)
                                app.setOutfitItem(slot, garment.id);
                            })
                          }
                          selectedId={draft.items[slot]}
                          label={`${OUTFIT_SLOT_NAMES[slot]} 후보`}
                        />
                      ) : categoryCandidates.length ? (
                        externalGrid(categoryCandidates, (item) =>
                          run(() => app.setExternalOutfitItem(slot, item.id)),
                        )
                      ) : (
                        <p className="mow-empty">
                          제공된 {OUTFIT_SLOT_NAMES[slot]} 구매 후보가 없어요.
                          <br />
                          외부 후보 자료 대기
                        </p>
                      )}
                      {source === "external" && (
                        <small>
                          종류 미확인 후보는 선택한 슬롯에만 배치해요.
                          소유·위치는 변경하지 않아요.
                        </small>
                      )}
                    </>
                  )}
                  {!picker && (
                    <div className="mow-composition">
                      <Thumb look={draft} />
                      <p>
                        {OUTFIT_SLOT_KEYS.flatMap((value) => {
                          const garment = app
                              .garments()
                              .find((item) => item.id === draft.items[value]),
                            external = draft.externalItems?.[value];
                          return garment
                            ? [garment.name]
                            : external
                              ? [`${external.name} (구매 후보)`]
                              : [];
                        }).join(" · ") || "아직 선택한 의류가 없어요"}
                      </p>
                    </div>
                  )}
                  <div className="mow-actions">
                    <button
                      type="button"
                      disabled={!completeOutfit(draft)}
                      onClick={onRequestFitting}
                    >
                      미러로 입어보기
                    </button>
                    <button
                      type="button"
                      disabled={!completeOutfit(draft) || saving}
                      onClick={() => void save()}
                    >
                      {saving ? "저장 중" : "코디카드로 저장"}
                    </button>
                  </div>
                  <div className="mow-toolbar">
                    <button
                      type="button"
                      className="mow-text-action"
                      onClick={() => {
                        setNotice("");
                        setHelp(!help);
                        setPicker(false);
                      }}
                    >
                      작은 코디 도움
                    </button>
                    {app.previousOutfitDraft() && (
                      <button
                        type="button"
                        className="mow-text-action"
                        onClick={() => run(() => app.resumePreviousDraft())}
                      >
                        이전 초안
                      </button>
                    )}
                  </div>
                </>
              )}
              {help && (
                <div className="mow-help">
                  <button type="button" onClick={() => setHelp(false)}>
                    ← 코디 편집
                  </button>
                  <label className="mow-label">
                    유지할 품목은 먼저 고정해 주세요
                    <input
                      aria-label="코디 도움 요청"
                      value={prompt}
                      maxLength={260}
                      placeholder="셔츠 유지, 다른 하의 제안"
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void ask()}
                  >
                    {busy ? "도움 요청 중" : "현재 조건으로 도움 요청"}
                  </button>
                  {proposal && (
                    <>
                      <Thumb
                        look={{ name: proposal.label, items: proposal.items }}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          run(() =>
                            app.applyOutfitSuggestion(
                              proposal.source,
                              proposal.items,
                            ),
                          )
                        }
                      >
                        이 제안 선택
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      <p className="mow-status" role="status">
        {notice}
      </p>
    </section>
  );
}
