import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { app } from "./appInstance";
import { navigateSurface } from "./surfaceNavigation";
import {
  MirrorCareEvidence,
  type CareEvidenceItem,
} from "./MirrorCareEvidence";
import type { Asset, Garment, Outfit, OutfitItems, Slot } from "./core/types";
import { MirrorAccountPanel, BackendSessionBootstrap } from "./BackendPanel";
import { PhotoWardrobeStage } from "./PhotoWardrobeStage";
import {
  api,
  currentDevice,
  currentMember,
} from "./integrations/backendClient";
import { HorizontalPager } from "./HorizontalPager";
import { Icon } from "./Icons";
import { useToday } from "./ScenarioControls";
import { garmentWearSummary } from "./core/wearScenario";
import {
  captureSelectionSubmission,
  type SelectionSubmission,
} from "./core/selectionScenario";
import { mirrorFittingSession } from "./mirrorFittingSession";
import { FittingStreamVideo } from "./FittingStreamVideo";
import { useMirrorPerson } from "./MirrorSceneView";
import { PACK_PROFILE_ID, matchPreparedPackResult } from "./wardrobePack";
import {
  buildFittingSnapshot,
  fittingSnapshotsMatch,
  type FittingCandidate,
  type FittingSnapshot,
  type FittingStreamBinding,
} from "./mirrorScene";
import "./mirror-experience.css";
import { MirrorGarmentGrid } from "./MirrorGarmentGrid";
import { MirrorRegistration } from "./MirrorRegistration";
import { MirrorHome } from "./MirrorHome";
import { MirrorCalendar } from "./MirrorCalendar";
import { MirrorProfiles } from "./MirrorProfiles";
import { MirrorCareOverview, MirrorCareHelp } from "./MirrorCareOverview";
import { MirrorCareRecord } from "./MirrorCareRecord";
import "./mirror-wardrobe.css";
import { MirrorOutfitWorkspace } from "./MirrorOutfitWorkspace";
import { MirrorForeground } from "./MirrorForeground";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
import { completeOutfit, sameOutfitComposition } from "./core/externalOutfits";

const menus = [
  ["home", "home", "홈"],
  ["wardrobe", "wardrobe", "옷장"],
  ["outfit", "outfit", "코디"],
  ["calendar", "calendar", "캘린더"],
  ["care", "care", "케어"],
  ["my", "user", "마이"],
] as const;
const categoryNames: Record<string, string> = {
  all: "전체",
  top: "상의",
  bottom: "하의",
  outer: "아우터",
  shoes: "신발",
  bag: "가방",
  accessory: "액세서리",
  hat: "모자",
};

type Displayed = {
  candidate: FittingCandidate;
  items: OutfitItems;
  name: string;
  ownerId: string;
};
function Photo({ asset, name }: { asset: Asset | null; name: string }) {
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
    <span className="mx-missing">사진 미연결</span>
  );
}
function OutfitThumb({
  outfit,
  garments,
}: {
  outfit: Pick<Outfit, "items" | "name">;
  garments: Garment[];
}) {
  return (
    <div className="mx-outfit-thumb" aria-label={outfit.name}>
      {Object.entries(outfit.items).map(([slot, id]) => {
        const g = garments.find((g) => g.id === id);
        return (
          g && (
            <span key={slot} data-slot={slot} data-garment-id={id}>
              <Photo asset={g.asset} name={g.name} />
            </span>
          )
        );
      })}
    </div>
  );
}
function useMirrorContext(ownerId: string) {
  const key = `smartcloset.mirror-ui.v2:${ownerId}`;
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "{}");
    } catch {
      return {};
    }
  };
  return { key, read };
}
export default function MirrorExperience() {
  const state = useSyncExternalStore(app.subscribe, app.getState);
  useSyncExternalStore(app.subscribe, () => JSON.stringify(app.connection));
  const owner = state.activeProfileId,
    connection = app.connection,
    garments = app.garments(),
    outfits = app.outfits(),
    today = useToday();
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const person = useMirrorPerson(owner);
  const context = useMirrorContext(owner);
  const saved = context.read();
  const paginationOwner = useRef(owner);
  const [registrationOpen, setRegistrationOpen] = useState(false),
    [careRecordOpen, setCareRecordOpen] = useState(false);
  const [outfitWorkspace, setOutfitWorkspace] = useState(true),
    [editTarget, setEditTarget] = useState<Slot | undefined>(undefined),
    [workspaceTab, setWorkspaceTab] = useState<"mine" | "edit">("mine");
  const [section, setSection] = useState(() =>
    menus.some(([id]) => id === app.ui().screen) ? app.ui().screen : "home",
  );
  const [wardrobeIndex, setWardrobeIndex] = useState<number>(
      saved.wardrobeIndex ?? 0,
    ),
    [homeIndex, setHomeIndex] = useState(0),
    [lookIndex, setLookIndex] = useState(0),
    [topIndex, setTopIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [detailPage, setDetailPage] = useState(0),
    [labelOpen, setLabelOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState(app.ui().query),
    [category, setCategory] = useState(app.ui().category);
  const [illumination, setIllumination] = useState<{
    ownerId: string;
    kind: "garmentFocus" | "confirmedLook";
    ids: string[];
  } | null>(null);
  const [serverAnchors, setServerAnchors] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const read = async () => {
      if (!currentMember() || !currentDevice()) {
        if (active) setServerAnchors([]);
        return;
      }
      try {
        const row: any = await api().get(
          `/integration/devices/${currentDevice()}/led-state`,
        );
        if (active) setServerAnchors(row.anchor_ids);
      } catch {
        if (active) setServerAnchors([]);
      }
    };
    void read();
    const timer = setInterval(() => void read(), 500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [owner]);
  const failedSubmission = useRef<SelectionSubmission | null>(null);
  const failedScene = useRef<FittingSnapshot | null>(null),
    componentActive = useRef(false);
  useEffect(() => {
    componentActive.current = true;
    return () => {
      componentActive.current = false;
    };
  }, []);
  const [labelEvidence, setLabelEvidence] = useState<CareEvidenceItem | null>(
    null,
  );
  const [streamBinding, setStreamBinding] =
    useState<FittingStreamBinding | null>(null);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [mode, setMode] = useState<"outfit" | "topSwap">("outfit");
  const [trayOpen, setTrayOpen] = useState(true),
    [interacting, setInteracting] = useState(false),
    [keyboard, setKeyboard] = useState(false);
  const [displayed, setDisplayed] = useState<Displayed | null>(null),
    [pendingDisplay, setPendingDisplay] = useState<Displayed | null>(null);
  const [fittingMessage, setFittingMessage] = useState(""),
    [notice, setNotice] = useState(""),
    [commitStatus, setCommitStatus] = useState<
      "idle" | "saving" | "saved" | "error"
    >("idle");
  const [sourceOutfit, setSourceOutfit] = useState<Outfit | null>(null);
  const [calendarIndex, setCalendarIndex] = useState(0);
  const comparisonActive = useRef(false),
    comparisonDraftId = useRef<string | null>(null),
    comparisonItems = useRef("");
  const commitBusy = useRef(false),
    viewGeneration = useRef(0);
  const [authOpen, setAuthOpen] = useState(false);
  const draft = app.outfitDraft();
  const draftItems = draft?.items ?? {};
  const pack = owner === PACK_PROFILE_ID;
  const ownedVisible = garments;
  const filtered = ownedVisible.filter(
    (g) =>
      (category === "all" || g.category === category) &&
      (!query ||
        [g.name, g.color, g.location, ...g.features]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())),
  );
  const selected = garments.find((g) => g.id === selectedId);
  const looks = outfits.filter(
    (o) =>
      !o.name.startsWith("__") &&
      Object.values(o.items).every((id) => garments.some((g) => g.id === id)),
  );
  const topCandidates = garments.filter((g) => g.category === "top");
  const currentItemsKey = JSON.stringify(draftItems);
  const displayedKey = displayed ? JSON.stringify(displayed.items) : "";
  const sceneSnapshot = draft
    ? buildFittingSnapshot({
        ownerId: owner,
        person: person.person,
        outfit: draft,
        garments,
        requestVersion: draft.revision,
      }).snapshot
    : null;
  const sceneRef = useRef<FittingSnapshot | null>(sceneSnapshot);
  sceneRef.current = sceneSnapshot;
  const exactDisplayed =
    !!displayed &&
    displayed.ownerId === owner &&
    fittingSnapshotsMatch(displayed.candidate.snapshot, sceneSnapshot);
  const events = app
    .events()
    .filter((e) => e.kind === "plan" || e.kind === "wear");
  const todayEvents = events
    .filter((e) => e.date === today.date)
    .sort((a, b) => a.id.localeCompare(b.id));
  const dateEvents = [...events].reverse();
  const history = selected
    ? garmentWearSummary(selected.id, owner, outfits, app.events())
    : null;
  const lastWash = selected
    ? app
        .events()
        .filter(
          (e) =>
            e.garmentId === selected.id &&
            e.kind === "care" &&
            e.value === "세탁 완료",
        )
        .sort((a, b) => b.date.localeCompare(a.date))[0]
    : undefined;
  const sourceLabel =
    connection.kind === "supabase"
      ? "내 계정 · 원격 연결"
      : pack
        ? "로컬 시연 · 생성된 의류 자산"
        : "로컬 시연 · 준비 자료";
  const activeStream =
    streamBinding &&
    fittingSnapshotsMatch(streamBinding.snapshot, sceneSnapshot)
      ? streamBinding.stream
      : null;
  const sourceMode = activeStream
    ? "실시간 수신 · 의류 표현 확인 필요"
    : exactDisplayed
      ? displayed?.candidate.origin === "prepared-static"
        ? "준비된 정적 착장 · 실제 피팅 아님"
        : displayed?.candidate.origin === "saved"
          ? "저장된 실제 결과 재생"
          : "실제 생성 결과 재생"
      : displayed
        ? "이전 착장 예시 · 선택 조합 미반영"
        : fittingMessage || "선택 조합의 피팅 결과 없음";
  const mirrorRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      mirrorFittingSession.subscribe({
        onState: (value) => {
          if (value.status !== "idle")
            setFittingMessage(
              value.status === "processing"
                ? "피팅을 준비하고 있어요"
                : value.status === "blocked"
                  ? "피팅 입력·실행 조건 확인 대기"
                  : value.status === "error"
                    ? "피팅을 확인하지 못했어요"
                    : "저장된 피팅 결과 불러오는 중",
            );
        },
        onResult: (candidate) => {
          if (
            candidate &&
            candidate.media?.kind !== "stream" &&
            fittingSnapshotsMatch(candidate.snapshot, sceneRef.current)
          ) {
            const current = app.outfitDraft();
            if (current)
              setPendingDisplay({
                candidate,
                items: structuredClone(current.items),
                name: current.name,
                ownerId: current.ownerId,
              });
          }
        },
        onStream: (binding) => {
          setStreamBinding(
            binding && fittingSnapshotsMatch(binding.snapshot, sceneRef.current)
              ? binding
              : null,
          );
        },
      }),
    [],
  );
  useEffect(() => {
    comparisonActive.current = false;
    mirrorFittingSession.bindContext(owner, app.repository);
    failedSubmission.current = null;
    failedScene.current = null;
    setLabelEvidence(null);
    return () => {
      void mirrorFittingSession.stop();
    };
  }, [owner, app.repository]);
  useEffect(() => {
    if (paginationOwner.current !== owner) return;
    try {
      sessionStorage.setItem(context.key, JSON.stringify({ wardrobeIndex }));
    } catch {}
  }, [context.key, wardrobeIndex]);
  useEffect(() => {
    setCareRecordOpen(false);
    setSelectedId(null);
    setIllumination(null);
    setDisplayed(null);
    setPendingDisplay(null);
    setSourceOutfit(null);
    setNotice("");
    setCommitStatus("idle");
    setSection("home");
    setRegistrationOpen(false);
    setMode("outfit");
    setControlsHidden(false);
    setAuthOpen(false);
    paginationOwner.current = owner;
    setWardrobeIndex(context.read().wardrobeIndex ?? 0);
    setQuery(app.ui().query);
    setCategory(app.ui().category);
    viewGeneration.current++;
  }, [owner]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") setKeyboard(true);
      if (event.key === "Escape") {
        if (authOpen) setAuthOpen(false);
        else if (labelOpen) setLabelOpen(false);
        else if (selectedId) {
          setSelectedId(null);
          setIllumination(null);
          setSection("wardrobe");
        } else setTrayOpen(true);
      }
    };
    const pointer = () => setKeyboard(false);
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", pointer);
    const leave = () => {
      app.stopTryOn();
      void mirrorFittingSession.stop();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("pagehide", leave);
      app.stopTryOn();
    };
  }, [labelOpen, selectedId, authOpen]);
  useEffect(() => {
    if (!notice || commitStatus === "error") return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice, commitStatus]);
  useEffect(() => {
    if (!authOpen && !labelOpen) return;
    const surface = mirrorRef.current;
    const dialog = surface?.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const siblings = Array.from(surface?.children ?? []).filter(
      (node) => node !== dialog,
    ) as HTMLElement[];
    siblings.forEach((node) => (node.inert = true));
    const selector =
      'button:not(:disabled), input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]';
    dialog.querySelector<HTMLElement>(selector)?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        dialog.querySelectorAll<HTMLElement>(selector),
      ).filter((node) => node.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      siblings.forEach((node) => (node.inert = false));
      dialog.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [authOpen, labelOpen]);
  const navigate = (next: string) => {
    setCareRecordOpen(false);
    setRegistrationOpen(false);
    viewGeneration.current++;
    setControlsHidden(false);
    if (next !== section && next !== "outfit") {
      comparisonActive.current = false;
      void mirrorFittingSession.stop();
      setPendingDisplay(null);
    }
    setNotice("");
    setAuthOpen(false);
    setLabelOpen(false);
    if (next === "home") {
      setIllumination(null);
      setSelectedId(null);
      setPendingDisplay(null);
    }
    if (next === "wardrobe") {
      setSelectedId(null);
      setIllumination(null);
    }
    if (next === "care") {
      setSelectedId(null);
      setIllumination(null);
      setDetailPage(1);
    }
    if (next === "outfit") {
      setOutfitWorkspace(true);
      setWorkspaceTab("mine");
      setEditTarget(undefined);
      setTrayOpen(true);
      setMode("outfit");
      if (section !== "calendar") setIllumination(null);
    }
    setSection(next);
    app.setScreen(next);
  };
  const selectGarment = (g: Garment) => {
    app.selectGarment(g.id);
    setSelectedId(g.id);
    setDetailPage(0);
    setSection("wardrobe");
    setLabelOpen(false);
    setIllumination({ ownerId: owner, kind: "garmentFocus", ids: [g.id] });
    setNotice("");
    if (currentMember())
      void api()
        .send("POST", "/integration/led-commands", {
          device_id: currentDevice(),
          garment_ids: [g.id],
        })
        .catch((e: Error) => setNotice(e.message));
  };
  const closeDetail = () => {
    setSelectedId(null);
    setIllumination(null);
    setSection("wardrobe");
    app.setScreen("wardrobe");
    setDetailPage(0);
    setLabelOpen(false);
  };
  const chooseMedia = (name: string, allowExecution = false) => {
    const current = app.outfitDraft();
    if (!current) return;
    const selectedPerson = person.person;
    const snapshot = buildFittingSnapshot({
      ownerId: owner,
      person: selectedPerson,
      outfit: current,
      garments: app.garments(),
      requestVersion: current.revision,
    }).snapshot;
    const candidate = matchPreparedPackResult(snapshot);
    if (candidate) {
      setPendingDisplay({
        candidate,
        items: structuredClone(current.items),
        name,
        ownerId: owner,
      });
      setFittingMessage("준비된 착장 불러오는 중");
    } else {
      setPendingDisplay(null);
      setFittingMessage(
        connection.kind === "supabase"
          ? "피팅 입력·실행 승인 확인 대기"
          : "이 조합의 피팅 결과 없음",
      );
      if (allowExecution && connection.kind === "supabase" && snapshot)
        void mirrorFittingSession.submitSelected(snapshot, current);
    }
    return candidate;
  };
  const openLook = (look: Outfit) => {
    try {
      void mirrorFittingSession.stop();
      if (app.outfits().some((o) => o.id === look.id))
        app.loadOutfitDraft(look.id);
      else app.openOutfitProposal(look.items, look.name);
      comparisonActive.current = false;
      setSourceOutfit(structuredClone(look));
      setIllumination(null);
      setCommitStatus("idle");
      setNotice("");
      setMode("outfit");
      setOutfitWorkspace(false);
      setControlsHidden(false);
      setSection("outfit");
      app.setScreen("outfit");
      chooseMedia(look.name);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const previewDraft = () => {
    setAuthOpen(true);
    const current = app.outfitDraft();
    comparisonActive.current = true;
    comparisonDraftId.current = current?.draftId ?? null;
    comparisonItems.current = JSON.stringify([
      current?.items,
      current?.externalItems,
    ]);
    setOutfitWorkspace(false);
    setIllumination(null);
    if (current) chooseMedia(current.name, true);
  };
  const editDraft = (slot?: Slot) => {
    setWorkspaceTab("edit");
    setEditTarget(slot);
    setOutfitWorkspace(true);
    setIllumination(null);
  };
  const draftChanged = () => {
    setIllumination(null);
    setCommitStatus("idle");
    const current = app.outfitDraft();
    if (current?.draftId !== comparisonDraftId.current)
      comparisonActive.current = false;
    const items = JSON.stringify([current?.items, current?.externalItems]);
    const changed = items !== comparisonItems.current;
    comparisonItems.current = items;
    if (current) chooseMedia(current.name, comparisonActive.current && changed);
  };
  const replaceTop = (g: Garment) => {
    if (app.outfitDraft()?.items.top === g.id) return;
    try {
      if (app.outfitDraft()?.topLocked) app.toggleTopLock();
      app.setOutfitItem("top", g.id);
      setIllumination(null);
      setCommitStatus("idle");
      setNotice("");
      setTrayOpen(true);
      chooseMedia(`${g.name}로 바꾼 코디`);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const finishSelectedFitting = (
    submission: SelectionSubmission,
    submittedScene: FittingSnapshot | null,
  ) => {
    const current = app.outfitDraft();
    if (
      !componentActive.current ||
      current?.ownerId !== submission.source.ownerId ||
      current.draftId !== submission.source.draftId ||
      current.revision !== submission.source.revision ||
      !fittingSnapshotsMatch(submittedScene, sceneRef.current)
    )
      return;
    comparisonActive.current = false;
    app.stopTryOn();
    void mirrorFittingSession.stop();
  };
  const commit = async () => {
    if (commitBusy.current || !draft) return;
    commitBusy.current = true;
    setCommitStatus("saving");
    try {
      if (Object.keys(draft.externalItems ?? {}).length)
        throw new Error("LIKED items cannot be finalized as owned clothes");
      const o: any = await api().send("POST", "/outfits", {
        title: draft.name || "My Look",
        status: "DRAFT",
        items: Object.entries(draft.items).map(([slot, id]) => ({
          slot: slot.toUpperCase(),
          garment_id: id,
          position: 0,
        })),
      });
      const session: any = await api().send("POST", "/vton-sessions", {
        member_id: currentMember().id,
        source_screen: "OUTFIT_EDITOR",
        outfit_id: o.id,
      });
      await api().send("POST", `/vton-sessions/${session.id}/end`, {
        expected_revision: session.revision,
        final_outfit_id: session.outfit_id,
        save_outfit: false,
      });
      await api().send("POST", "/integration/led-commands", {
        device_id: currentDevice(),
        garment_ids: Object.values(draft.items),
      });
      setCommitStatus("saved");
      setNotice("Final selection saved; no plan or wear record created");
    } catch (e) {
      setCommitStatus("error");
      setNotice((e as Error).message);
    } finally {
      commitBusy.current = false;
    }
  };
  const retryCommit = async () => {
    await commit();
  };
  const setFilters = (q: string, c: typeof category) => {
    setQuery(q);
    setCategory(c);
    setWardrobeIndex(0);
    app.setSearchFilters({ query: q, category: c });
  };
  const profileName = pack
    ? "내 옷장"
    : (state.profiles.find((p) => p.id === owner)?.name ?? "내 옷장");
  const sourceCaption = <span className="mx-source">{sourceLabel}</span>;
  const renderLookCard = (look: Outfit) => {
    const snap = buildFittingSnapshot({
      ownerId: owner,
      person: person.person,
      outfit: { ...look, draftId: `card:${look.id}`, topLocked: false },
      garments,
      requestVersion: 1,
    }).snapshot;
    const media = matchPreparedPackResult(snap);
    return (
      <button
        className="mx-look-card"
        key={look.id}
        data-look-id={look.id}
        aria-label={`${look.name} 코디 열기`}
        onClick={() => openLook(look)}
      >
        {media?.media?.kind === "image" ? (
          <img src={media.media.url} alt={look.name} draggable={false} />
        ) : (
          <OutfitThumb outfit={look} garments={garments} />
        )}
        <strong>{look.name}</strong>
        <small>눌러서 미러로 보기</small>
      </button>
    );
  };
  const renderGarmentCard = (g: Garment, onClick: () => void) => (
    <button
      className="mx-garment-card"
      key={g.id}
      data-garment-id={g.id}
      aria-label={`${g.name} 선택`}
      onClick={onClick}
    >
      <Photo asset={g.asset} name={g.name} />
      <strong>{g.name}</strong>
    </button>
  );
  return (
    <PhotoWardrobeStage anchorIds={serverAnchors}>
      <BackendSessionBootstrap app={app} />
      <div
        className="mx-surface"
        ref={mirrorRef}
        data-screen={section}
        data-selected-garment={selectedId ?? ""}
        data-look-revision={draft?.revision ?? 0}
      >
        {(section === "home" || section === "outfit") &&
          !activeStream &&
          displayed?.ownerId === owner &&
          displayed.candidate.media &&
          displayed.candidate.media.kind !== "stream" && (
            <MirrorForeground
              media={{
                ...displayed.candidate.media,
                label: `${displayed.name} · ${displayed.candidate.origin === "prepared-static" ? "준비된 정적 착장" : "저장된 피팅 결과"}`,
              }}
              contextKey={JSON.stringify([
                owner,
                displayed.candidate.snapshot,
                displayed.candidate.media,
              ])}
              className={
                displayed.candidate.origin === "prepared-static"
                  ? "mx-person-prepared"
                  : "mx-person-result"
              }
            />
          )}
        {section === "outfit" && activeStream && (
          <MirrorForeground
            media={{
              kind: "stream",
              stream: activeStream,
              label: "실시간 피팅 수신 · 의류 표현 확인 필요",
            }}
            contextKey={JSON.stringify([owner, sceneSnapshot, "live"])}
            className="mx-person-result"
          />
        )}
        {pendingDisplay?.candidate.media?.kind === "video" && (
          <video
            key={pendingDisplay.candidate.media.url}
            className="mx-pending-media"
            src={pendingDisplay.candidate.media.url}
            preload="auto"
            muted
            onLoadedData={(event) => {
              if (
                event.currentTarget.currentSrc !==
                new URL(
                  pendingDisplay.candidate.media?.kind === "video"
                    ? pendingDisplay.candidate.media.url
                    : "",
                  location.href,
                ).href
              )
                return;
              if (
                fittingSnapshotsMatch(
                  pendingDisplay.candidate.snapshot,
                  sceneRef.current,
                )
              )
                setDisplayed(pendingDisplay);
              setPendingDisplay(null);
            }}
            onError={() => {
              setPendingDisplay(null);
              setFittingMessage("피팅 영상을 재생하지 못했어요");
            }}
          />
        )}
        {pendingDisplay?.candidate.media?.kind === "image" && (
          <img
            key={pendingDisplay.candidate.media.url}
            className="mx-pending-media"
            alt=""
            src={pendingDisplay.candidate.media.url}
            onLoad={(event) => {
              const current = app.outfitDraft();
              if (
                event.currentTarget.currentSrc !==
                new URL(
                  pendingDisplay.candidate.media?.kind === "image"
                    ? pendingDisplay.candidate.media.url
                    : "",
                  location.href,
                ).href
              )
                return;
              if (
                pendingDisplay.ownerId === owner &&
                fittingSnapshotsMatch(
                  pendingDisplay.candidate.snapshot,
                  sceneRef.current,
                )
              ) {
                setDisplayed(pendingDisplay);
                setFittingMessage("");
              }
              setPendingDisplay(null);
            }}
            onError={() => {
              setPendingDisplay(null);
              setFittingMessage("준비된 착장을 읽지 못했어요");
            }}
          />
        )}
        <header className="mx-header">
          <span>SMART CLOSET</span>
          <strong>
            {section === "wardrobe"
              ? selected
                ? "선택한 옷"
                : "내 옷장"
              : section === "care"
                ? "라벨·관리법"
                : section === "outfit"
                  ? "오늘의 코디"
                  : section === "calendar"
                    ? "캘린더"
                    : section === "my"
                      ? "마이"
                      : "좋은 하루예요"}
          </strong>
          {sourceCaption}
        </header>
        <nav className="mx-nav" aria-label="주 메뉴">
          {menus.map(([id, icon, label]) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => navigate(id)}
              aria-label={label}
            >
              <Icon name={icon} size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {section === "home" && <MirrorHome app={app} onOpenOutfit={openLook} />}
        {section === "wardrobe" && !selected && !registrationOpen && (
          <section className="mx-work mx-wardrobe">
            <div className="mg-heading">
              <span className="mg-count">{filtered.length}벌</span>
              <button
                aria-label="옷 검색"
                onClick={() => setSearchOpen(!searchOpen)}
              >
                <Icon name="search" size={18} />
              </button>
              <button
                aria-label="사진 등록"
                onClick={() => {
                  app.beginRegistration();
                  setRegistrationOpen(true);
                }}
              >
                등록
              </button>
            </div>
            {searchOpen && (
              <label className="mx-search">
                이름 검색
                <input
                  autoFocus
                  value={query}
                  placeholder="옷 이름"
                  onChange={(e) => setFilters(e.target.value, category)}
                />
              </label>
            )}
            <div className="mg-types" aria-label="종류 필터">
              {(["all", "top", "bottom", "outer"] as const).map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => setFilters(query, c)}
                >
                  {categoryNames[c]}
                </button>
              ))}
            </div>
            <select
              aria-label="의류 종류"
              value={category}
              onChange={(e) =>
                setFilters(query, e.target.value as typeof category)
              }
            >
              {["all", ...new Set(garments.map((g) => g.category))].map((c) => (
                <option value={c} key={c}>
                  {categoryNames[c] ?? c}
                </option>
              ))}
            </select>
            <MirrorGarmentGrid
              garments={filtered}
              index={wardrobeIndex}
              onIndexChange={setWardrobeIndex}
              onSelect={selectGarment}
            />
            <p className="mx-fine">옆으로 탐색 · 눌러서 이력과 위치</p>
          </section>
        )}
        {registrationOpen && section === "wardrobe" && (
          <MirrorRegistration
            key={owner}
            onClose={() => setRegistrationOpen(false)}
          />
        )}
        {(section === "wardrobe" || section === "care") &&
          selected &&
          !careRecordOpen && (
            <section className="mx-detail" data-detail-garment-id={selected.id}>
              <div className="mx-detail-heading">
                <button aria-label="옷 목록으로 돌아가기" onClick={closeDetail}>
                  <Icon name="back" size={18} />
                </button>
                <strong>{selected.name}</strong>
                <button
                  className="mg-record-entry"
                  aria-label="실제 관리 또는 이동 기록"
                  onClick={() => setCareRecordOpen(true)}
                >
                  기록
                </button>
              </div>
              <div className="mx-garment-context">
                <Photo asset={selected.asset} name={selected.name} />
                <span>{selected.location || "위치 미확인"}</span>
              </div>
              <div className="mx-tabs" role="tablist" aria-label="의류 상세">
                <button
                  role="tab"
                  aria-selected={detailPage === 0}
                  onClick={() => {
                    setDetailPage(0);
                    setSection("wardrobe");
                  }}
                >
                  착용 이력
                </button>
                <button
                  role="tab"
                  aria-selected={detailPage === 1}
                  onClick={() => {
                    setDetailPage(1);
                    setSection("care");
                  }}
                >
                  라벨·관리법
                </button>
              </div>
              <HorizontalPager
                label="의류 상세 페이지"
                index={detailPage}
                onIndexChange={(i) => {
                  setDetailPage(i);
                  setSection(i === 0 ? "wardrobe" : "care");
                }}
                peek={0}
                showControls={false}
              >
                <article className="mx-glass mx-history">
                  <span>마지막 실제 착용</span>
                  <strong>{history?.lastWornDate ?? "기록 없음"}</strong>
                  <span>확인된 착용 일수</span>
                  <strong data-wear-days={history?.wearDays ?? 0}>
                    {history?.dates.length
                      ? `${history.wearDays}일`
                      : "착용 기록 없음"}
                  </strong>
                  <small>마지막 세탁 {lastWash?.date ?? "기록 없음"}</small>
                  <small>오늘 선택·피팅은 착용에 포함하지 않아요.</small>
                </article>
                <article className="mx-glass mx-care">
                  <MirrorCareEvidence
                    ownerId={owner}
                    garment={selected}
                    remote={connection.kind === "supabase"}
                    onOpenOriginal={(evidence) => {
                      setLabelEvidence(evidence);
                      setLabelOpen(true);
                    }}
                  />
                  <MirrorCareHelp
                    key={`${owner}:${selected.id}`}
                    garment={selected}
                  />
                </article>
              </HorizontalPager>
              <p className="mx-location-caption">
                {serverAnchors.length
                  ? "서버가 확인한 점등 구역을 확인하세요"
                  : selected.location
                    ? "등록된 위치 안내 · LED는 현재 소등 상태"
                    : "이 옷의 위치는 아직 확인되지 않았어요"}
              </p>
            </section>
          )}
        {careRecordOpen && selected && (
          <MirrorCareRecord
            key={`${owner}:${selected.id}`}
            garment={selected}
            onClose={() => setCareRecordOpen(false)}
          />
        )}
        {section === "care" && !selected && (
          <MirrorCareOverview
            onSelect={(g) => {
              selectGarment(g);
              setSection("care");
              setDetailPage(1);
            }}
          />
        )}
        {section === "outfit" && (
          <>
            <p className="mx-media-status" role="status">
              {sourceMode}
            </p>
            {outfitWorkspace ? (
              <section className="mx-editor">
                <MirrorOutfitWorkspace
                  key={`${owner}:${workspaceTab}:${editTarget ?? ""}`}
                  initialTab={workspaceTab}
                  initialSlot={editTarget}
                  onOpenLook={openLook}
                  onDraftChange={draftChanged}
                  onRequestFitting={previewDraft}
                  onNotice={setNotice}
                />
              </section>
            ) : (
              <>
                {!displayed && !activeStream && (
                  <div className="mx-selection-only">
                    <MirrorOutfitThumbnail
                      app={app}
                      outfit={{
                        items: draftItems,
                        externalItems: draft?.externalItems,
                        name: draft?.name ?? "선택 코디",
                      }}
                    />
                    <p>선택한 구성품 · 피팅 미적용</p>
                  </div>
                )}
                <section
                  className="mx-preview-controls"
                  aria-label="미러 조합 조작"
                >
                  <button
                    className="mx-primary"
                    disabled={
                      commitStatus === "saving" ||
                      !draft ||
                      !completeOutfit(draft)
                    }
                    onClick={() => void commit()}
                  >
                    {commitStatus === "saving"
                      ? "기록하는 중"
                      : "이 옷으로 입기"}
                  </button>
                  <div className="mx-preview-edits">
                    <button onClick={() => editDraft("top")}>
                      상의 바꾸기
                    </button>
                    <button onClick={() => editDraft()}>조합 편집</button>
                  </div>
                  <button className="mx-preview-records" onClick={previewDraft}>
                    피팅 시작
                  </button>
                  <button
                    className="mx-preview-records"
                    onClick={() => {
                      app.setCalendarDate(today.date);
                      navigate("calendar");
                    }}
                  >
                    오늘 기록 보기
                  </button>
                  <p
                    className="mx-selection-caption"
                    data-selected-look={currentItemsKey}
                  >
                    {Object.values(draftItems)
                      .map((id) => garments.find((g) => g.id === id)?.name)
                      .filter(Boolean)
                      .concat(
                        Object.values(draft?.externalItems ?? {}).map(
                          (item) => item.name + " (구매 후보)",
                        ),
                      )
                      .join(" · ")}
                  </p>
                  {illumination?.kind === "confirmedLook" && (
                    <p className="mx-location-caption">
                      {serverAnchors.length
                        ? "불이 켜진 구역에서 꺼내세요"
                        : "LED 소등 · 위치 확인 필요"}
                      {Object.keys(draft?.externalItems ?? {}).length
                        ? " · 구매 후보는 보유옷이 아니에요"
                        : ""}
                    </p>
                  )}
                </section>
              </>
            )}
          </>
        )}
        {section === "calendar" && (
          <MirrorCalendar
            app={app}
            today={today.date}
            onReuse={openLook}
            onBrowseOutfits={() => navigate("outfit")}
          />
        )}
        {section === "my" && (
          <MirrorProfiles
            app={app}
            onSelectProfile={(id) => app.setActiveProfile(id)}
            onAccount={() => setAuthOpen(true)}
          />
        )}
        {notice && (
          <div
            className={`mx-toast ${commitStatus === "error" ? "error" : ""}`}
            role="status"
          >
            {notice}
            {commitStatus === "error" && failedSubmission.current && (
              <button onClick={() => void retryCommit()}>
                앞선 선택 기록 다시 확인
              </button>
            )}
          </div>
        )}
        {labelOpen &&
          selected &&
          labelEvidence?.garmentId === selected.id &&
          labelEvidence.ownerId === owner && (
            <section
              role="dialog"
              aria-modal="true"
              aria-label="관리 근거 원문"
              className="mx-inline-dialog mx-label-dialog"
            >
              <button onClick={() => setLabelOpen(false)}>닫기</button>
              <h2>{selected.name}</h2>
              <small>
                {labelEvidence.kind === "label"
                  ? "저장된 라벨 원문"
                  : labelEvidence.kind === "official_guidance"
                    ? "저장된 공식 안내"
                    : "직접 입력한 관리 근거"}
              </small>
              {labelEvidence.asset && (
                <img
                  src={labelEvidence.asset.url}
                  alt={`${selected.name}의 연결된 라벨 원본`}
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                    setNotice(
                      "라벨 사진을 읽지 못했어요. 저장된 원문을 확인해 주세요.",
                    );
                  }}
                />
              )}
              <p className="mx-original-text">{labelEvidence.originalText}</p>
              {labelEvidence.sourceRef && (
                <p>출처 · {labelEvidence.sourceRef}</p>
              )}
              {labelEvidence.observedAt && (
                <small>확인일 · {labelEvidence.observedAt.slice(0, 10)}</small>
              )}
            </section>
          )}
        {authOpen && (
          <section
            role="dialog"
            aria-modal="true"
            aria-label="계정 연결"
            className="mx-inline-dialog mx-auth-dialog"
          >
            <button onClick={() => setAuthOpen(false)}>닫기</button>
            <MirrorAccountPanel app={app} />
          </section>
        )}
      </div>
    </PhotoWardrobeStage>
  );
}
