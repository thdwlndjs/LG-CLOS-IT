import {
  api,
  currentDevice,
  currentMember,
} from "./integrations/backendClient";
import { confirmServerLook, saveServerCard } from "./secondHandoffActions";
import {
  careEvidenceOriginalText,
  careEvidencePresentation,
} from "./careEvidence";
import { lifeHistoryReadOptions } from "./lifeSnapshot";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { app } from "./appInstance";
import {
  MirrorCareEvidence,
  type CareEvidenceItem,
} from "./MirrorCareEvidence";
import type {
  Asset,
  Garment,
  Outfit,
  OutfitDraft,
  OutfitItems,
  Slot,
} from "./core/types";
import { MirrorAccountPanel, BackendSessionBootstrap } from "./BackendPanel";
import { PhotoWardrobeStage } from "./PhotoWardrobeStage";
import { HorizontalPager } from "./HorizontalPager";
import { Icon } from "./Icons";
import { useToday } from "./ScenarioControls";
import { garmentLifeSummary } from "./lifeHistory";
import { mirrorFittingSession } from "./mirrorFittingSession";
import { useMirrorPerson } from "./MirrorSceneView";
import { PACK_PROFILE_ID, matchPreparedPackResult } from "./wardrobePack";
import {
  buildFittingSnapshot,
  fittingSnapshotsMatch,
  type FittingCandidate,
  type FittingSnapshot,
  type FittingStreamBinding,
} from "./mirrorScene";
import { resolvePhotoLocations } from "./photoSceneMapping";
import "./mirror-experience.css";
import { MirrorGarmentGrid, MirrorPhoto } from "./MirrorGarmentGrid";
import { MirrorRegistration } from "./MirrorRegistration";
import { MirrorHome } from "./MirrorHome";
import { MirrorCalendar } from "./MirrorCalendar";
import { MirrorProfiles } from "./MirrorProfiles";
import { MirrorCareOverview, MirrorCareHelp } from "./MirrorCareOverview";
import { MirrorCareRecord } from "./MirrorCareRecord";
import "./mirror-wardrobe.css";
import {
  MirrorOutfitWorkspace,
  createOutfitWorkspaceUI,
  type MirrorOutfitWorkspaceUI,
} from "./MirrorOutfitWorkspace";
import { MirrorCompare } from "./MirrorCompare";
import { MirrorForeground } from "./MirrorForeground";
import "./mirror-clear.css";

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
  dress: "원피스",
};

type Displayed = {
  candidate: FittingCandidate;
  items: OutfitItems;
  name: string;
  ownerId: string;
};
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
const localLifeRuntime = false;
export default function MirrorExperience() {
  const state = useSyncExternalStore(app.subscribe, app.getState);
  useSyncExternalStore(app.subscribe, () => JSON.stringify(app.connection));
  const owner = state.activeProfileId,
    connection = app.connection,
    garments = app.garments(),
    outfits = app.outfits(),
    today = useToday();
  const [mockResult, setMockResult] = useState<{
    url: string;
    draftId: string;
    revision: number;
    owner: string;
    label: string;
  } | null>(null);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const person = useMirrorPerson(owner);
  const context = useMirrorContext(owner);
  const saved = context.read();
  const paginationOwner = useRef(owner);
  const [registrationOpen, setRegistrationOpen] = useState(false),
    [careRecordOpen, setCareRecordOpen] = useState(false);
  const [outfitView, setOutfitView] = useState<
      "library" | "builder" | "compare"
    >("library"),
    [editTarget, setEditTarget] = useState<Slot | undefined>(undefined);
  const builderReturn = useRef<"library" | "compare" | "calendar">("library");
  const quickPicker = useRef(false);
  const compareUI = useRef({ quick: false, more: false, page: 0 });
  const workspaceMemory = useRef(
    new Map<object, Map<string, MirrorOutfitWorkspaceUI>>(),
  );
  const repository = app.repository;
  if (!workspaceMemory.current.has(repository))
    workspaceMemory.current.set(repository, new Map());
  const ownerUI = workspaceMemory.current.get(repository)!;
  if (!ownerUI.has(owner)) ownerUI.set(owner, createOutfitWorkspaceUI());
  const [otherTypesOpen, setOtherTypesOpen] = useState(false),
    [cardSaving, setCardSaving] = useState(false);
  const cardSaveBusy = useRef(false);
  const [section, setSection] = useState(() =>
    menus.some(([id]) => id === app.ui().screen) ? app.ui().screen : "home",
  );
  const [wardrobeIndex, setWardrobeIndex] = useState<number>(
    saved.wardrobeIndex ?? 0,
  );
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
  }, [owner, app.repository]);
  const componentActive = useRef(false);
  useEffect(() => {
    componentActive.current = true;
    return () => {
      componentActive.current = false;
    };
  }, []);
  const [careAvailability, setCareAvailability] = useState<{
    key: string;
    available: boolean | null;
  } | null>(null);
  const [labelEvidence, setLabelEvidence] = useState<CareEvidenceItem | null>(
    null,
  );
  const [streamBinding, setStreamBinding] =
    useState<FittingStreamBinding | null>(null);
  const [displayed, setDisplayed] = useState<Displayed | null>(null),
    [pendingDisplay, setPendingDisplay] = useState<Displayed | null>(null);
  const [fittingMessage, setFittingMessage] = useState(""),
    [notice, setNotice] = useState(""),
    [commitStatus, setCommitStatus] = useState<
      "idle" | "saving" | "saved" | "error"
    >("idle");
  const comparisonActive = useRef(false),
    comparisonDraftId = useRef<string | null>(null);
  const commitBusy = useRef(false),
    viewGeneration = useRef(0);
  const [authOpen, setAuthOpen] = useState(false);
  const draft = app.outfitDraft();
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
  const sceneSnapshot = draft
    ? buildFittingSnapshot({
        deviceScoped: app.connection.kind === "supabase",
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
  const locations = resolvePhotoLocations(
    garments,
    owner,
    illumination?.ownerId === owner ? illumination.ids : [],
    connection.kind === "supabase",
  );
  const selectedLocation = selected
    ? resolvePhotoLocations(
        garments,
        owner,
        [selected.id],
        connection.kind === "supabase",
      ).items[0]
    : undefined;
  const history = selected
    ? garmentLifeSummary(
        selected.id,
        owner,
        outfits,
        app.events(),
        lifeHistoryReadOptions(state, owner),
      )
    : null;
  const sourceLabel =
    connection.kind === "supabase"
      ? "내 계정 · 원격 연결"
      : pack
        ? "로컬 시연 · 생성된 의류 자산"
        : localLifeRuntime
          ? "로컬 시연 저장 · 생활 기록"
          : "로컬 시연 · 준비 자료";
  const activeStream =
    streamBinding &&
    fittingSnapshotsMatch(streamBinding.snapshot, sceneSnapshot)
      ? streamBinding.stream
      : null;
  const sourceMode =
    mockResult &&
    mockResult.owner === owner &&
    mockResult.draftId === draft?.draftId &&
    mockResult.revision === draft?.revision
      ? mockResult.label
      : activeStream
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
  const compareVisible = section === "outfit" && outfitView === "compare";
  const compareVisibleRef = useRef(compareVisible);
  compareVisibleRef.current = compareVisible;
  const extraCategories = [...new Set(garments.map((g) => g.category))].filter(
    (c) => !["top", "bottom", "outer"].includes(c),
  );
  useEffect(() => {
    if (section !== "outfit") return;
    const frame = requestAnimationFrame(() => {
      const selector =
        outfitView === "compare"
          ? ".mc-heading button"
          : outfitView === "builder"
            ? ".mow-slot[aria-pressed=true]"
            : ".mow-library-heading button";
      mirrorRef.current
        ?.querySelector<HTMLElement>(selector)
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, outfitView, owner]);
  useEffect(
    () =>
      mirrorFittingSession.subscribe({
        onState: (value) => {
          if (
            compareVisibleRef.current &&
            comparisonActive.current &&
            value.status !== "idle"
          )
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
            compareVisibleRef.current &&
            comparisonActive.current &&
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
            compareVisibleRef.current &&
              comparisonActive.current &&
              binding &&
              fittingSnapshotsMatch(binding.snapshot, sceneRef.current)
              ? binding
              : null,
          );
        },
      }),
    [],
  );
  useEffect(() => {
    comparisonActive.current = false;
    quickPicker.current = false;
    compareUI.current = { quick: false, more: false, page: 0 };
    mirrorFittingSession.bindContext(owner, app.repository);
    failedServerDraft.current = null;
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
    setOutfitView("library");
    setEditTarget(undefined);
    setOtherTypesOpen(false);
    setCardSaving(false);
    setSelectedId(null);
    setIllumination(null);
    setDisplayed(null);
    setMockResult(null);
    setPendingDisplay(null);
    setNotice("");
    setCommitStatus("idle");
    setSection("home");
    setRegistrationOpen(false);
    setAuthOpen(false);
    paginationOwner.current = owner;
    setWardrobeIndex(context.read().wardrobeIndex ?? 0);
    setQuery(app.ui().query);
    setCategory(app.ui().category);
    viewGeneration.current++;
  }, [owner, app.repository]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        if (authOpen) setAuthOpen(false);
        else if (labelOpen) setLabelOpen(false);
        else if (selectedId) {
          setSelectedId(null);
          setIllumination(null);
          setSection("wardrobe");
        }
      }
    };
    window.addEventListener("keydown", key);
    const leave = () => {
      app.stopTryOn();
      void mirrorFittingSession.stop();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pagehide", leave);
      app.stopTryOn();
    };
  }, [labelOpen, selectedId, authOpen]);
  useEffect(() => {
    if (!notice || commitStatus === "error" || commitStatus === "saved") return;
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
  const endComparison = () => {
    comparisonActive.current = false;
    compareVisibleRef.current = false;
    setStreamBinding(null);
    setPendingDisplay(null);
    setDisplayed(null);
    setMockResult(null);
    app.stopTryOn();
    void mirrorFittingSession.stop();
  };
  const navigate = (next: string) => {
    quickPicker.current = false;
    endComparison();
    setCareRecordOpen(false);
    setRegistrationOpen(false);
    viewGeneration.current++;
    setNotice("");
    setAuthOpen(false);
    setLabelOpen(false);
    setIllumination(null);
    if (["home", "wardrobe", "care"].includes(next)) setSelectedId(null);
    if (next === "care") setDetailPage(1);
    if (next === "outfit") {
      setOutfitView("library");
      setEditTarget(undefined);
    }
    setSection(next);
    app.setScreen(next);
  };
  const library = () => {
    quickPicker.current = false;
    compareUI.current = { quick: false, more: false, page: 0 };
    endComparison();
    viewGeneration.current++;
    setOutfitView("library");
    setEditTarget(undefined);
    setNotice("");
    setIllumination(null);
  };
  const selectGarment = (g: Garment) => {
    app.selectGarment(g.id);
    setSelectedId(g.id);
    setDetailPage(0);
    setSection("wardrobe");
    setLabelOpen(false);
    setIllumination({ ownerId: owner, kind: "garmentFocus", ids: [g.id] });
    setNotice("");
    if (connection.kind === "supabase") {
      const repository = app.repository;
      void api()
        .send("POST", "/integration/led-commands", {
          device_id: currentDevice(),
          garment_ids: [g.id],
        })
        .catch((error: Error) => {
          if (ownerRef.current === owner && app.repository === repository)
            setNotice(error.message);
        });
    }
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
      deviceScoped: app.connection.kind === "supabase",
      ownerId: owner,
      person: selectedPerson,
      outfit: current,
      garments: app.garments(),
      requestVersion: current.revision,
    }).snapshot;
    if (
      allowExecution &&
      connection.kind === "supabase" &&
      snapshot &&
      mirrorFittingSession.getCurrentOperation()
    ) {
      setPendingDisplay(null);
      setFittingMessage("현재 피팅에 선택한 조합을 연결하고 있어요");
      void mirrorFittingSession.submitSelected(snapshot, current);
      return;
    }
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
  const previewDraft = () => {
    const current = app.outfitDraft();
    if (!current) return;
    comparisonActive.current = true;
    comparisonDraftId.current = current.draftId;
    compareVisibleRef.current = true;
    setOutfitView("compare");
    setSection("outfit");
    app.setScreen("outfit");
    setIllumination(null);
    setNotice("");
    viewGeneration.current++;
    chooseMedia(current.name, true);
  };
  const openLook = (look: Outfit) => {
    try {
      endComparison();
      if (app.outfits().some((o) => o.id === look.id))
        app.loadOutfitDraft(look.id, { reuse: true });
      else app.openOutfitProposal(look.items, look.name);
      setCommitStatus("idle");
      previewDraft();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const editDraft = (slot?: Slot) => {
    builderReturn.current = outfitView === "compare" ? "compare" : "library";
    quickPicker.current = outfitView === "compare" && slot === "top";
    // The top picker is part of the active comparison; keep its admitted operation and draft.
    if (!quickPicker.current) endComparison();
    else compareVisibleRef.current = false;
    viewGeneration.current++;
    setEditTarget(slot);
    setOutfitView("builder");
    setIllumination(null);
    setNotice("");
  };
  const backFromBuilder = () => {
    if (builderReturn.current === "compare") {
      // Return is presentation only, not another execution intent.
      const current = app.outfitDraft();
      if (!quickPicker.current) comparisonActive.current = false;
      quickPicker.current = false;
      compareVisibleRef.current = true;
      setOutfitView("compare");
      if (current && !displayed) chooseMedia(current.name, false);
    } else if (builderReturn.current === "calendar") {
      quickPicker.current = false;
      navigate("calendar");
    } else library();
  };
  const selectedFromPicker = (slot: Slot) => {
    if (!quickPicker.current || slot !== "top") return;
    quickPicker.current = false;
    compareVisibleRef.current = true;
    setOutfitView("compare");
    setEditTarget(undefined);
    viewGeneration.current++;
    const current = app.outfitDraft();
    if (current)
      chooseMedia(
        current.name,
        comparisonActive.current &&
          comparisonDraftId.current === current.draftId,
      );
  };
  const reuseLook = (look: Outfit) => {
    try {
      endComparison();
      app.loadOutfitDraft(look.id, { reuse: true });
      builderReturn.current = "calendar";
      setEditTarget(undefined);
      setOutfitView("builder");
      setSection("outfit");
      app.setScreen("outfit");
      setCommitStatus("idle");
      setIllumination(null);
      setNotice("");
      viewGeneration.current++;
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const draftChanged = () => {
    setIllumination(null);
    setCommitStatus("idle");
    setPendingDisplay(null);
    setDisplayed(null);
    setMockResult(null);
  };
  const replaceTop = (g: Garment) => {
    const current = app.outfitDraft();
    if (!current || current.items.top === g.id) return;
    if (current.topLocked || current.lockedSlots?.top) {
      setNotice("상의가 고정되어 있어요. 조합 편집에서 고정을 해제해 주세요.");
      return;
    }
    try {
      app.setOutfitItem("top", g.id);
      setIllumination(null);
      setCommitStatus("idle");
      setNotice("");
      const next = app.outfitDraft()!;
      chooseMedia(
        next.name,
        comparisonActive.current && comparisonDraftId.current === next.draftId,
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const saveCard = async () => {
    const current = app.outfitDraft();
    if (!current || cardSaveBusy.current) return;
    const captured = {
      owner: current.ownerId,
      repository: app.repository,
      draftId: current.draftId,
      revision: current.revision,
    };
    cardSaveBusy.current = true;
    setCardSaving(true);
    try {
      const result = await app.saveOutfit(
        `mirror-card:${current.draftId}:${current.revision}`,
      );
      if (
        connection.kind === "supabase" &&
        ownerRef.current === captured.owner &&
        app.repository === captured.repository
      ) {
        await saveServerCard(result.entity.id);
        if (
          ownerRef.current === captured.owner &&
          app.repository === captured.repository
        )
          await app.reloadRemote();
      }
      if (
        componentActive.current &&
        ownerRef.current === captured.owner &&
        app.repository === captured.repository
      )
        setNotice(
          app.outfitDraft()?.draftId !== captured.draftId ||
            app.outfitDraft()?.revision !== captured.revision
            ? "앞서 요청한 코디카드를 저장했어요. 새 조합은 유지해요."
            : result.replayed
              ? "이미 저장된 코디카드를 확인했어요"
              : "코디카드를 저장했어요. 오늘 선택과는 별도예요.",
        );
    } catch (e) {
      if (
        componentActive.current &&
        ownerRef.current === captured.owner &&
        app.repository === captured.repository
      )
        setNotice((e as Error).message);
    } finally {
      cardSaveBusy.current = false;
      if (
        componentActive.current &&
        ownerRef.current === captured.owner &&
        app.repository === captured.repository
      )
        setCardSaving(false);
    }
  };
  const failedServerDraft = useRef<OutfitDraft | null>(null);
  const commit = async (retry = false) => {
    const captured = retry ? failedServerDraft.current : app.outfitDraft();
    if (commitBusy.current || !captured) return;
    if (app.connection.kind !== "supabase") {
      setNotice("로그인 후 보유 의류 조합을 확정하세요.");
      return;
    }
    if (!retry && failedServerDraft.current) {
      setNotice("앞선 요청 결과를 먼저 확인하세요.");
      return;
    }
    const snapshot = structuredClone(captured),
      repository = app.repository,
      generation = viewGeneration.current;
    const current = () =>
      componentActive.current &&
      ownerRef.current === snapshot.ownerId &&
      app.repository === repository;
    failedServerDraft.current = snapshot;
    commitBusy.current = true;
    setCommitStatus("saving");
    setNotice("코디를 확정하고 있습니다.");
    try {
      const result = await confirmServerLook(snapshot);
      if (!current()) return;
      failedServerDraft.current = null;
      if (generation !== viewGeneration.current) {
        setCommitStatus("idle");
        return;
      }
      endComparison();
      setCommitStatus("saved");
      const applied =
        result.led.applied_garment_ids?.length ??
        result.led.anchor_ids?.length ??
        0;
      setNotice(
        `코디 확정 완료 · 착용 예정/실제 착용 기록 없음${result.led.blocked ? " · 현재 접속 기기에서는 집 LED 제어가 차단됩니다." : applied ? " · 확인된 위치 LED" : " · LED는 서버 위치 확인 결과에 따릅니다."}`,
      );
    } catch (e) {
      if (current()) {
        setCommitStatus("error");
        setNotice((e as Error).message);
      }
    } finally {
      commitBusy.current = false;
    }
  };
  const retryCommit = () => commit(true);
  const setFilters = (q: string, c: typeof category) => {
    setQuery(q);
    setCategory(c);
    setWardrobeIndex(0);
    app.setSearchFilters({ query: q, category: c });
  };
  const sourceCaption = (
    <span className="mx-source">
      {app.persistence.status === "ready"
        ? sourceLabel
        : "로컬 저장 불가 · 메모리에서만 유지"}
    </span>
  );
  return (
    <PhotoWardrobeStage
      anchorIds={
        connection.kind === "supabase" ? serverAnchors : locations.anchorIds
      }
    >
      {!localLifeRuntime && <BackendSessionBootstrap app={app} />}
      <div
        className="mx-surface"
        data-mirror-ui="clear"
        ref={mirrorRef}
        data-screen={section}
        data-outfit-view={section === "outfit" ? outfitView : undefined}
        data-selected-garment={selectedId ?? ""}
        data-look-revision={draft?.revision ?? 0}
      >
        {compareVisible &&
          mockResult?.owner === owner &&
          mockResult.draftId === draft?.draftId &&
          mockResult.revision === draft?.revision && (
            <MirrorForeground
              media={{
                kind: "image",
                url: mockResult.url,
                label: mockResult.label,
              }}
              contextKey={JSON.stringify(mockResult)}
              className="mx-person-result"
            />
          )}

        {compareVisible &&
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
        {compareVisible && activeStream && (
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
                compareVisibleRef.current &&
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
                compareVisibleRef.current &&
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
        {section !== "home" &&
          !(section === "outfit" && outfitView === "compare") && (
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
                      ? outfitView === "library"
                        ? "코디 탐색"
                        : "의류 조합"
                      : section === "calendar"
                        ? "캘린더"
                        : section === "my"
                          ? "마이"
                          : "좋은 하루예요"}
              </strong>
              {sourceCaption}
            </header>
          )}
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
              {extraCategories.length > 0 && (
                <button
                  className="mg-other"
                  aria-expanded={otherTypesOpen}
                  aria-pressed={extraCategories.includes(category as Slot)}
                  onClick={() => setOtherTypesOpen(!otherTypesOpen)}
                >
                  {extraCategories.includes(category as Slot)
                    ? categoryNames[category]
                    : "기타"}
                </button>
              )}
            </div>
            {otherTypesOpen && (
              <div className="mg-extra-types" aria-label="기타 의류 종류">
                {extraCategories.map((c) => (
                  <button
                    key={c}
                    aria-pressed={category === c}
                    onClick={() => {
                      setFilters(query, c);
                      setOtherTypesOpen(false);
                    }}
                  >
                    {categoryNames[c] ?? c}
                  </button>
                ))}
              </div>
            )}
            <MirrorGarmentGrid
              garments={filtered}
              index={wardrobeIndex}
              onIndexChange={setWardrobeIndex}
              onSelect={selectGarment}
            />
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
                <MirrorPhoto garment={selected} name={selected.name} />
                <span>{selectedLocation?.displayLabel ?? "위치 미확인"}</span>
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
                  <span>
                    {history?.lastWashDate ? "지난 세탁 후 착용" : "착용 이력"}
                  </span>
                  <strong>
                    {history?.lastWashDate
                      ? `${history.wearsAfterLastWash}회 · ${history.wearDaysAfterLastWash}일`
                      : history?.display}
                  </strong>
                  <small>
                    마지막 세탁 {history?.lastWashDate ?? "기록 없음"}
                  </small>
                  <small>
                    마지막 실제 착용 {history?.lastWornDate ?? "기록 없음"}
                  </small>
                  <small data-wear-count={history?.wearCount ?? 0}>
                    전체 기록된 착용{" "}
                    <span data-wear-days={history?.wearDays ?? 0}>
                      {history?.dates.length
                        ? `${history.wearDays}일`
                        : "기록 없음"}
                    </span>
                  </small>
                  {history?.availability !==
                    "no_recorded_block_not_cleanliness_confirmation" && (
                    <small>
                      {history?.availability === "drying_unconfirmed"
                        ? "세탁 후 건조 완료 기록은 없어요."
                        : "사용자 관찰: 세탁 대기로 표시했어요."}
                    </small>
                  )}
                  <small>
                    {history?.sourceKinds.includes("scenario_fixture")
                      ? "시연 생활 기록 · 실제 사용자 이력 아님"
                      : "오늘 선택·피팅은 착용에 포함하지 않아요."}
                  </small>
                </article>
                <article className="mx-glass mx-care">
                  <MirrorCareEvidence
                    evidence={state.careEvidence}
                    ownerId={owner}
                    garment={selected}
                    remote={connection.kind === "supabase"}
                    onEvidenceState={(available) =>
                      setCareAvailability({
                        key: `${owner}:${selected.id}:${selected.revision}`,
                        available,
                      })
                    }
                    onOpenOriginal={(evidence) => {
                      setLabelEvidence(evidence);
                      setLabelOpen(true);
                    }}
                  />
                  <MirrorCareHelp
                    key={`${owner}:${selected.id}`}
                    garment={selected}
                    evidenceAvailable={
                      careAvailability?.key ===
                      `${owner}:${selected.id}:${selected.revision}`
                        ? careAvailability.available
                        : null
                    }
                  />
                </article>
              </HorizontalPager>
              <p className="mx-location-caption">
                {selectedLocation?.anchorIds?.length
                  ? "불이 켜진 구역 · 시연 위치"
                  : ""}
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
        {section === "outfit" &&
          (outfitView === "compare" ? (
            <MirrorCompare
              key={owner}
              uiState={compareUI.current}
              onUIStateChange={(value) => {
                compareUI.current = value;
              }}
              draft={draft}
              garments={garments}
              hasMedia={!!displayed || !!activeStream || !!mockResult}
              onMockResult={(url, label) => {
                const d = app.outfitDraft();
                if (d) {
                  setDisplayed(null);
                  setStreamBinding(null);
                  setMockResult({
                    url,
                    draftId: d.draftId,
                    revision: d.revision,
                    owner,
                    label: label || "Mock VTON 결과 · 실제 피팅 아님",
                  });
                }
              }}
              status={sourceMode}
              onBack={library}
              onEdit={editDraft}
              onChooseTop={replaceTop}
              onSave={() => void saveCard()}
              onCommit={() => void commit(false)}
              onEnd={library}
              saving={cardSaving}
              committing={commitStatus === "saving"}
              recorded={commitStatus === "saved"}
              onRecords={() => {
                app.setCalendarDate(today.date);
                navigate("calendar");
              }}
            />
          ) : (
            <section className="mx-editor">
              <MirrorOutfitWorkspace
                key={owner}
                view={outfitView}
                onViewChange={(view) => {
                  endComparison();
                  builderReturn.current = "library";
                  setOutfitView(view);
                  setEditTarget(undefined);
                  viewGeneration.current++;
                }}
                onBack={backFromBuilder}
                uiState={ownerUI.get(owner)}
                onUIStateChange={(value) => ownerUI.set(owner, value)}
                initialSlot={editTarget}
                onOpenLook={openLook}
                onDraftChange={draftChanged}
                onSelected={selectedFromPicker}
                onRequestFitting={previewDraft}
                onNotice={setNotice}
              />
            </section>
          ))}
        {section === "calendar" && (
          <MirrorCalendar
            app={app}
            today={today.date}
            onReuse={reuseLook}
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
            {notice ||
              "앞선 선택 기록을 확인해야 해요. 조합은 그대로 유지합니다."}
            {commitStatus === "error" && failedServerDraft.current && (
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
                    ? careEvidencePresentation(labelEvidence).verificationLabel
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
              <p className="mx-original-text">
                {careEvidenceOriginalText(labelEvidence)}
              </p>
              {careEvidencePresentation(labelEvidence).sourceDomain && (
                <p>
                  출처 · {careEvidencePresentation(labelEvidence).sourceDomain}
                </p>
              )}
              {labelEvidence.observedAt && (
                <small>
                  자료 기록일 · {labelEvidence.observedAt.slice(0, 10)}
                </small>
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
