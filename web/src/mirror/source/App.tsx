import { useCachedImage } from "./useCachedImage";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createDemoApp,
  DEMO_DATE,
  REGISTRATION_ASSET,
  DEMO_CONDITIONS,
} from "./core";
import type { Asset, Category, Garment, Outfit, Slot, CareGuide } from "./core";
import { Icon } from "./Icons";
import { calendarMonth, moveCalendarMonth } from "./calendar";
import { readNavigation, writeNavigation } from "./uiContext";
import { BackendPanel, BackendSessionBootstrap } from "./BackendPanel";
import { HttpRemoteBackend } from "./integrations/backendClient";
import { FittingControls, type FittingInputSelection } from "./FittingControls";
import {
  CareEvidenceInput,
  StyleReferenceInput,
  PhotoSuitability,
} from "./ReferenceInputs";
import {
  PACK_PROFILE_ID,
  PACK_PERSON,
  PACK_READ_ONLY_ITEMS,
  PACK_REGISTRATION_EXAMPLE,
  createWardrobePackBundle,
  matchPackRegistration,
  matchPreparedPackResult,
} from "./wardrobePack";
import { PACK_DEMO_PLACEMENTS } from "./packScenePlacements";
import {
  selectReviewGarments,
  selectStructureGarments,
  REVIEW_GARMENT_IDS,
} from "./demoReviewSelection";
import { GarmentFacts, WardrobeRail, useToday } from "./ScenarioControls";
import { confirmationIntent } from "./confirmationIntent";
import {
  createOutfitReviewState,
  reconcileOutfitReviewState,
  reviewGarmentIdentity,
  reviewAvailability,
  recommendationAvailability,
  type OutfitReviewState,
} from "./outfitReview";
import { OutfitReviewCard } from "./OutfitReviewCard";
import {
  StorageCabinet,
  MirrorPersonStage,
  useMirrorPerson,
  PERSON_REFERENCES,
  MIRROR_COMPARTMENTS,
  MIRROR_BINDINGS,
  type SceneMedia,
} from "./MirrorSceneView";
import {
  selectMirrorScene,
  resolveGarmentLocation,
  buildFittingSnapshot,
  selectFittingPresentation,
  type FittingCandidate,
  type FittingRequest,
  type FittingStreamBinding,
  selectCurrentFittingStream,
} from "./mirrorScene";

import { app } from "./appInstance";
import { navigateSurface } from "./surfaceNavigation";
import { mirrorFittingSession } from "./mirrorFittingSession";
const categories: Record<Category | "all", string> = {
  dress: "원피스",
  all: "전체",
  top: "상의",
  bottom: "하의",
  outer: "아우터",
  bag: "가방",
  shoes: "신발",
  hat: "모자",
  accessory: "액세서리",
};
const menus = [
  { id: "home", icon: "home", label: "홈" },
  { id: "wardrobe", icon: "wardrobe", label: "옷장" },
  { id: "outfit", icon: "outfit", label: "코디" },
  { id: "calendar", icon: "calendar", label: "캘린더" },
  { id: "care", icon: "care", label: "케어" },
  { id: "my", icon: "user", label: "마이" },
];
const labels: Record<string, string> = {
  care: "관리",
  movement: "보관 이동",
  plan: "착용 계획",
  wear: "실제 착용",
};
const zones = [
  "행거 A",
  "행거 B",
  "선반 C",
  "행거 D",
  "서랍 E",
  "선반 F",
  "서랍 G",
  "선반 H",
  "행거 I",
];
const blobUrls = new Map<string, string>();
function Photo({
  asset,
  name,
  className = "",
}: {
  asset: Asset | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const cached = useCachedImage(asset);
  const url =
    asset &&
    (asset.source === "storage"
      ? cached.url
      : blobUrls.get(asset.id) || asset.url);
  useEffect(() => setFailed(false), [url]);
  return url && !failed && !cached.failed ? (
    <img
      className={`garment-photo ${className}`}
      src={url}
      alt={name}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={`missing-photo ${className}`}>
      <Icon name="photo" size={30} />
      <span>
        {asset?.source === "upload" ? "사진 재선택 필요" : "개별 사진 준비 중"}
      </span>
    </div>
  );
}
function OutfitPicture({
  outfit,
  onClick,
}: {
  outfit: Outfit;
  onClick?: () => void;
}) {
  const clothes = Object.entries(outfit.items).map(([slot, id]) => ({
    slot,
    g: app.garments().find((g) => g.id === id),
  }));
  return (
    <div
      className="look-composition"
      onClick={onClick}
      data-outfit-id={outfit.id}
    >
      {clothes.map(
        ({ slot, g }) =>
          g && (
            <div
              key={slot}
              className={`look-slot look-${slot}`}
              data-garment-id={g.id}
              data-asset-version={g.asset?.version ?? 0}
            >
              <Photo asset={g.asset} name={g.name} />
            </div>
          ),
      )}
    </div>
  );
}

export default function App() {
  const state = useSyncExternalStore(app.subscribe, app.getState);
  useEffect(() => {
    mirrorFittingSession.bindContext(state.activeProfileId, app.repository);
  }, [state.activeProfileId, app.repository]);
  const [review, setReview] = useState(() =>
    createOutfitReviewState(state.activeProfileId),
  );
  const inventoryIdentity = JSON.stringify(
    app.garments().map(reviewGarmentIdentity).sort(),
  );
  useEffect(() => {
    setReview((previous) =>
      reconcileOutfitReviewState(
        previous,
        state.activeProfileId,
        app.garments(),
      ),
    );
    app.invalidateOutfitRecommendation();
  }, [state.activeProfileId, inventoryIdentity]);
  const handleReviewChange = (next: OutfitReviewState) => {
    if (JSON.stringify(next) !== JSON.stringify(review))
      app.invalidateOutfitRecommendation();
    setReview(next);
  };
  const isUnavailable = (g: Garment) =>
    ["laundry", "repair"].includes(
      reviewAvailability(review, state.activeProfileId, g),
    );
  const today = useToday();
  const wearInFlight = useRef(false);
  const [comparison, setComparison] = useState<Outfit | null>(null);
  useEffect(() => setComparison(null), [state.activeProfileId]);
  const packScene = state.activeProfileId === PACK_PROFILE_ID;
  const personSelection = useMirrorPerson(state.activeProfileId);
  const [streamBinding, setStreamBinding] =
    useState<FittingStreamBinding | null>(null);
  const [fittingInputs, setFittingInputs] =
    useState<FittingInputSelection | null>(null);
  useEffect(() => setFittingInputs(null), [state.activeProfileId]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [guideAll, setGuideAll] = useState(false);
  const [showFullPack, setShowFullPack] = useState(false);
  const [fitVersion, setFitVersion] = useState(1);
  const [fitRequest, setFitRequest] = useState<FittingRequest | null>(null);
  const [fitResult, setFitResult] = useState<FittingCandidate | null>(null);
  const personInput = useRef<HTMLInputElement>(null),
    panelToggle = useRef<HTMLButtonElement>(null);
  useSyncExternalStore(app.subscribe, () => JSON.stringify(app.connection));
  const connection = app.connection;
  const processingLabel =
    connection.mode === "live"
      ? "실제 API"
      : connection.mode === "saved_result"
        ? "저장된 실제 결과"
        : "준비 예시";
  const ui = app.ui();
  const screen = ui.screen || "home";
  const [detail, setDetail] = useState<string | null>(() => {
    const saved = readNavigation(app.getState().activeProfileId);
    return saved.screen === app.ui().screen ? saved.detail : null;
  });
  const [subview, setSubview] = useState<"list" | "map">(
    () => readNavigation(app.getState().activeProfileId).subview,
  );
  const [message, setMessage] = useState("");
  const [tools, setTools] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [delay, setDelay] = useState(450);
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [guide, setGuide] = useState<CareGuide | null>(null);
  const [careId, setCareId] = useState(
    () =>
      app.garments().find((g) => g.id === app.ui().selectedGarmentId)?.id ??
      app.garments()[0]?.id ??
      "",
  );
  const [careConfirm, setCareConfirm] = useState<"care" | "movement" | null>(
    null,
  );
  const [careDone, setCareDone] = useState<{
    garmentId: string;
    receiptId: string;
    action: string;
  } | null>(null);
  const [fitOpen, setFitOpen] = useState(false);
  const [fitMessage, setFitMessage] = useState(
    "선택한 코디의 준비 결과를 확인할 수 있어요.",
  );
  const [selectedOutfit, setSelectedOutfit] = useState<string | null>(
    ui.selectedOutfitId,
  );
  const eventDate = ui.calendarDate ?? DEMO_DATE;
  const month = calendarMonth(eventDate);
  const [pendingEventDate, setPendingEventDate] = useState(eventDate);
  const [eventConfirm, setEventConfirm] = useState<"plan" | "wear" | null>(
    null,
  );
  const [weather, setWeather] = useState("sunny");
  const [occasion, setOccasion] = useState("work");
  const [viewRevision, setViewRevision] = useState(0);
  const [editSlot, setEditSlot] = useState<Slot>("bottom");
  const [savedOpen, setSavedOpen] = useState(
    () => readNavigation(state.activeProfileId).savedOpen,
  );
  const [styleHelpOpen, setStyleHelpOpen] = useState(
    () => readNavigation(state.activeProfileId).styleHelpOpen,
  );
  const [conditionsOpen, setConditionsOpen] = useState(
    () => readNavigation(state.activeProfileId).conditionsOpen,
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(readNavigation(state.activeProfileId).scroll);
  const viewKey = `${screen}:${detail ?? "list"}`;
  const restoreItem = useRef<string | null>(null);
  const restoringContext = useRef(false);
  const preserveContext = () => {
    if (
      restoringContext.current ||
      connectionKey.current !==
        `${app.connection.kind}:${app.getState().activeProfileId}`
    )
      return;
    const currentUI = app.ui();
    writeNavigation(state.activeProfileId, {
      screen,
      detail,
      subview,
      scroll: scrollPositions.current,
      savedOpen,
      styleHelpOpen,
      conditionsOpen,
      query: currentUI.query,
      category: currentUI.category,
      selectedGarmentId: currentUI.selectedGarmentId,
      selectedOutfitId: currentUI.selectedOutfitId,
      calendarDate: currentUI.calendarDate,
    });
  };
  const operationId = useRef(0);
  const runRequest = useRef(0);
  const searchRequest = useRef(0);
  const photoRequest = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectionKey = useRef(`${connection.kind}:${state.activeProfileId}`);
  const nav = (next: string) => {
    if (next === "care") {
      const selected = app
        .garments()
        .find((g) => g.id === app.ui().selectedGarmentId);
      setCareId(
        selected?.id ??
          app.garments().find((g) => g.id === careId)?.id ??
          app.garments()[0]?.id ??
          "",
      );
      setGuide(null);
    }
    preserveContext();
    operationId.current++;
    runRequest.current++;
    app.stopTryOn();
    setBusy(false);
    setFitOpen(false);
    setDetail(null);
    setCareDone(null);
    setCareConfirm(null);
    setEventConfirm(null);
    setMessage("");
    setPanelOpen(true);
    app.setScreen(next);
  };
  const showGarment = (id: string) => {
    operationId.current++;
    runRequest.current++;
    setBusy(false);
    setGuideAll(false);
    app.selectGarment(id);
    setDetail(id);
    setPanelOpen(true);
    setMessage("");
  };
  const inspectGarment = (id: string) => {
    setGuideAll(false);
    app.selectGarment(id);
    setMessage("위치 안내만 바뀌었어요. 코디와 보관 기록은 유지합니다.");
  };
  const options = { delayMs: delay, fail };
  const run = async (
    fn: (current: () => boolean) => Promise<unknown>,
    success?: string,
  ) => {
    const request = ++runRequest.current;
    const token = operationId.current;
    const owner = state.activeProfileId;
    const current = () =>
      request === runRequest.current &&
      token === operationId.current &&
      owner === app.getState().activeProfileId;
    setBusy(true);
    setMessage("");
    try {
      const result = await fn(current);
      if (current() && success) setMessage(success);
      return result;
    } catch (e) {
      if (current())
        setMessage(
          e instanceof Error
            ? e.message
            : "처리하지 못했어요. 다시 시도해 주세요.",
        );
    } finally {
      if (request === runRequest.current) setBusy(false);
    }
  };
  const search = (query: string) => {
    const request = ++searchRequest.current;
    const token = operationId.current;
    const owner = state.activeProfileId;
    const category = app.ui().category;
    setMessage("");
    void app.searchGarments(query, options).catch((error) => {
      if (
        request === searchRequest.current &&
        token === operationId.current &&
        owner === app.getState().activeProfileId &&
        app.ui().query === query &&
        app.ui().category === category
      )
        setMessage(
          error instanceof Error
            ? error.message
            : "검색하지 못했어요. 다시 시도해 주세요.",
        );
    });
  };
  const openEvent = (kind: "plan" | "wear") => {
    setPendingEventDate(eventDate);
    setMessage("");
    setEventConfirm(kind);
  };
  useEffect(() => {
    document.title = `${menus.find((m) => m.id === screen)?.label || "의류 등록"} · 스마트 옷장`;
    titleRef.current?.focus();
  }, [screen, detail]);
  useEffect(() => {
    const key = `${connection.kind}:${state.activeProfileId}`;
    if (connectionKey.current === key) return;
    connectionKey.current = key;
    restoringContext.current = true;
    const saved = readNavigation(state.activeProfileId);
    operationId.current++;
    photoRequest.current++;
    runRequest.current++;
    setBusy(false);
    setDetail(null);
    setCareId(app.garments()[0]?.id ?? "");
    setCareDone(null);
    setGuide(null);
    setFitOpen(false);
    setCareConfirm(null);
    setEventConfirm(null);
    setMessage("");
    scrollPositions.current = saved.scroll;
    setSavedOpen(saved.savedOpen);
    setStyleHelpOpen(saved.styleHelpOpen);
    setConditionsOpen(saved.conditionsOpen);
    setSubview(saved.subview);
    if (connection.kind === "supabase") {
      if (saved.query !== undefined || saved.category !== undefined) {
        app.setSearchFilters({
          query: saved.query ?? "",
          category: saved.category ?? "all",
        });
        void app
          .searchGarments(saved.query ?? "", { delayMs: 0 })
          .catch(() => {});
      }
      if (
        saved.selectedGarmentId &&
        app.garments().some((g) => g.id === saved.selectedGarmentId)
      )
        app.selectGarment(saved.selectedGarmentId);
      if (
        saved.selectedOutfitId &&
        app.outfits().some((o) => o.id === saved.selectedOutfitId)
      )
        app.selectOutfit(saved.selectedOutfitId);
      if (saved.calendarDate) app.setCalendarDate(saved.calendarDate);
    }
    setSelectedOutfit(app.ui().selectedOutfitId);
    const timer = setTimeout(() => {
      restoringContext.current = false;
    }, 0);
    return () => {
      clearTimeout(timer);
      restoringContext.current = false;
    };
  }, [connection.kind, state.activeProfileId]);
  useEffect(() => {
    const node = contentRef.current;
    const target = restoreItem.current;
    const frame = requestAnimationFrame(() => {
      if (node) node.scrollTop = scrollPositions.current[viewKey] ?? 0;
      if (target) {
        node
          ?.querySelector<HTMLButtonElement>(
            `[data-garment-id="${CSS.escape(target)}"]`,
          )
          ?.focus({ preventScroll: true });
        restoreItem.current = null;
      }
    });
    preserveContext();
    return () => cancelAnimationFrame(frame);
  }, [screen, detail, subview, state.activeProfileId]);
  useEffect(() => {
    preserveContext();
  }, [
    savedOpen,
    styleHelpOpen,
    conditionsOpen,
    ui.query,
    ui.category,
    ui.selectedGarmentId,
    ui.selectedOutfitId,
    ui.calendarDate,
  ]);
  useEffect(
    () => () => {
      app.stopTryOn();
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
      blobUrls.clear();
    },
    [],
  );
  useEffect(() => {
    const referenced = new Set(
      [...state.garments, ...Object.values(state.registrationDrafts)].map(
        (g) => g.asset?.id,
      ),
    );
    for (const [id, url] of blobUrls)
      if (!referenced.has(id)) {
        URL.revokeObjectURL(url);
        blobUrls.delete(id);
      }
  }, [state.garments, state.registrationDrafts]);
  useEffect(() => {
    const leave = () => {
      preserveContext();
      app.stopTryOn();
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [
    screen,
    detail,
    subview,
    state.activeProfileId,
    savedOpen,
    styleHelpOpen,
    conditionsOpen,
  ]);
  const modalOpen = tools || Boolean(careConfirm) || Boolean(eventConfirm);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const sceneParts = document.querySelectorAll<HTMLElement>(
      ".mirror,.storage-cabinet",
    );
    sceneParts.forEach((n) => (n.inert = true));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const selector =
      'button:not(:disabled),input,select,summary,[tabindex="0"]';
    dialog?.querySelector<HTMLElement>(selector)?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        dialog?.querySelectorAll<HTMLElement>(selector) || [],
      ).filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      sceneParts.forEach((n) => (n.inert = false));
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modalOpen]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fitOpen) {
          operationId.current++;
          app.stopTryOn();
          setFitOpen(false);
        } else if (tools) setTools(false);
        else if (careConfirm) {
          operationId.current++;
          setCareConfirm(null);
        } else if (eventConfirm) {
          operationId.current++;
          setEventConfirm(null);
        } else if (detail) setDetail(null);
        else if (screen === "registration") nav("wardrobe");
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [fitOpen, tools, careConfirm, eventConfirm, detail, screen]);
  const currentGarment = detail
    ? app.garments().find((g) => g.id === detail)
    : null;
  const careGarment = app.garments().find((g) => g.id === careId);
  const draft = app.outfitDraft() ?? {
    draftId: "not-started",
    ownerId: state.activeProfileId,
    revision: 0,
    name: "나의 코디",
    items: {},
    topLocked: false,
  };
  const registration = app.registrationDraft();
  useEffect(
    () => setRegistrationConsent(false),
    [connection.kind, state.activeProfileId, registration?.draftId],
  );
  const activeOutfit = app.outfits().find((o) => o.id === selectedOutfit);
  const homeItems = packScene
    ? { top: "T04", bottom: "B01", outer: "O01" }
    : {
        top: app.garments().find((g) => g.category === "top")?.id,
        bottom: app.garments().find((g) => g.category === "bottom")?.id,
      };
  const homeOutfit: Outfit | null =
    homeItems.top && homeItems.bottom
      ? {
          id: "today-proposal",
          ownerId: state.activeProfileId,
          name: packScene
            ? "올리브 셔츠 · 블랙 슬랙스 · 트렌치"
            : "내 옷으로 시작하는 TODAY",
          items: homeItems,
          revision: 1,
          assetVersions: {},
        }
      : null;
  const openProposal = () => {
    if (!homeOutfit) return;
    if (
      Object.values(homeOutfit.items).some((id) =>
        app.garments().some((g) => g.id === id && isUnavailable(g)),
      )
    ) {
      setMessage(
        "TODAY 조합에 세탁·수선 중으로 확인한 옷이 있어요. 코디에서 사용 가능한 보유 의류로 바꿔주세요.",
      );
      return;
    }
    try {
      app.openOutfitProposal(homeOutfit.items, homeOutfit.name);
      setComparison(homeOutfit);
      setSelectedOutfit(null);
      setEditSlot("top");
      nav("outfit");
      setMessage("TODAY 전체 조합을 열었어요. 인물과 이전 초안은 유지합니다.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const compareSaved = (id: string) => {
    const outfit = app.outfits().find((o) => o.id === id);
    if (outfit) setComparison(JSON.parse(JSON.stringify(outfit)));
    app.loadOutfitDraft(id);
  };
  const takeOut = (id: string) => {
    inspectGarment(id);
    setMessage(
      "선택한 옷의 위치를 안내합니다. 실제 꺼냄·이동은 센서 미연결로 확인하지 않았어요. 착용이나 관리 완료 기록은 추가하지 않습니다.",
    );
  };
  const wearToday = () => {
    if (wearInFlight.current) return;
    wearInFlight.current = true;
    void run(async (current) => {
      try {
        const result = await app.wearCurrentOutfit(today.date, options);
        const latest = app.outfitDraft();
        if (
          !current() ||
          !latest ||
          latest.draftId !== result.source.draftId ||
          latest.revision !== result.source.revision
        )
          return;
        setGuideAll(true);
        app.setCalendarDate(today.date);
        setMessage(
          result.replayed
            ? "오늘 같은 전체 조합의 착용 기록이 이미 있어요. 중복 없이 모든 의류 위치를 안내합니다."
            : `오늘 실제 착용 ${result.garmentIds.length}벌을 ${app.connection.kind === "supabase" ? "원격" : "이 브라우저에"} 기록했어요. 모든 의류 위치를 안내합니다.`,
        );
      } finally {
        wearInFlight.current = false;
      }
    });
  };
  const selectedGarment =
    app.garments().find((g) => g.id === ui.selectedGarmentId) ?? currentGarment;
  const reviewGarments =
    packScene && !showFullPack
      ? selectReviewGarments(app.garments(), draft, ui.selectedGarmentId)
      : app.garments();
  const reviewIds = new Set(
    selectStructureGarments(app.garments(), draft, ui.selectedGarmentId).map(
      (g) => g.id,
    ),
  );
  const mirrorScene = selectMirrorScene({
    ownerId: state.activeProfileId,
    garments:
      packScene && !showFullPack
        ? state.garments.filter(
            (g) => g.ownerId !== state.activeProfileId || reviewIds.has(g.id),
          )
        : state.garments,
    inspectedGarmentId: ui.selectedGarmentId,
    outfit: draft,
    locationGuide: guideAll
      ? { kind: "outfit" }
      : ui.selectedGarmentId
        ? { kind: "garment", garmentId: ui.selectedGarmentId }
        : { kind: "none" },
    compartments: MIRROR_COMPARTMENTS,
    bindings: MIRROR_BINDINGS,
    ...(packScene ? { demoLocations: PACK_DEMO_PLACEMENTS } : {}),
  });
  const garmentLocation = (g: Garment) =>
    resolveGarmentLocation({
      ownerId: state.activeProfileId,
      garments: app.garments(),
      compartments: MIRROR_COMPARTMENTS,
      bindings: MIRROR_BINDINGS,
      ...(packScene ? { demoLocations: PACK_DEMO_PLACEMENTS } : {}),
      garmentId: g.id,
    });
  const fittingInput = buildFittingSnapshot({
    deviceScoped: app.connection.kind === "supabase",
    ownerId: state.activeProfileId,
    person: personSelection.person,
    outfit: draft,
    garments: app.garments(),
    requestVersion: fitVersion,
  });
  const fitting = selectFittingPresentation({
    current: fittingInput.snapshot,
    request: fitRequest,
    result: fitResult,
  });
  const liveStream =
    fitting.media?.kind === "stream"
      ? selectCurrentFittingStream(
          streamBinding,
          fittingInput.snapshot,
          fitResult?.operationId,
        )
      : null;
  const sceneMedia: SceneMedia | null = liveStream
    ? { kind: "stream", stream: liveStream, label: fitting.label }
    : fitting.media && fitting.media.kind !== "stream"
      ? { ...fitting.media, label: fitting.label }
      : null;
  const fittingIdentity = JSON.stringify({
    person: personSelection.person.id,
    version: personSelection.person.version,
    owner: state.activeProfileId,
    draft: draft.draftId,
    revision: draft.revision,
    items: draft.items,
    assets: app
      .garments()
      .filter((g) => Object.values(draft.items).includes(g.id))
      .map((g) => [g.id, g.asset?.id, g.asset?.version]),
  });
  useEffect(() => {
    setStreamBinding(null);
    setFitVersion((v) => v + 1);
    setFitRequest(null);
    setFitResult(null);
    app.stopTryOn();
    setFitMessage(
      "선택 코디 미적용 / 현재 인물과 코디에 일치하는 피팅 결과를 확인해 주세요.",
    );
  }, [fittingIdentity]);
  const careRecorded = app
    .events()
    .some(
      (e) =>
        e.garmentId === "g-trench" &&
        (e.kind === "care" || e.kind === "movement"),
    );
  const beginRegister = () => {
    app.beginRegistration();
    nav("registration");
  };
  const fittingFocus = useRef<"dock" | "panel">("panel");
  const wasFitOpen = useRef(false);
  useEffect(() => {
    const previous = wasFitOpen.current;
    wasFitOpen.current = fitOpen;
    if (fitOpen) {
      titleRef.current?.focus();
      return;
    }
    if (previous && screen === "outfit") {
      const frame = requestAnimationFrame(() => {
        const region =
          fittingFocus.current === "dock"
            ? document.querySelector(".scene-look-dock")
            : contentRef.current;
        const label = fittingFocus.current === "dock" ? "피팅" : "입어보기";
        Array.from(region?.querySelectorAll<HTMLButtonElement>("button") ?? [])
          .find((b) => b.textContent?.trim() === label)
          ?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [fitOpen, screen]);
  const openFit = () => {
    fittingFocus.current = document.activeElement?.closest(".scene-look-dock")
      ? "dock"
      : "panel";
    setPanelOpen(true);
    setFitOpen(true);
    setFitMessage(
      "인물과 전체 코디는 그대로 유지합니다. 일치하는 피팅 결과만 적용해요.",
    );
  };
  const closeFit = () => {
    operationId.current++;
    app.stopTryOn();
    setFitVersion((v) => v + 1);
    setFitResult(null);
    setFitRequest(null);
    setFitOpen(false);
  };
  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setMessage(
        "PNG·JPEG·WebP, 10MB 이하 사진을 선택해 주세요. 이전 사진과 입력은 유지했어요.",
      );
      return;
    }
    const requestProfile = state.activeProfileId;
    const requestDraft = app.registrationDraft()?.draftId;
    const requestRevision = app.registrationDraft()?.revision;
    const request = ++photoRequest.current;
    const url = URL.createObjectURL(file);
    const probe = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        probe.onload = () => resolve();
        probe.onerror = reject;
        probe.src = url;
      });
      if (
        photoRequest.current !== request ||
        app.getState().activeProfileId !== requestProfile ||
        app.registrationDraft()?.draftId !== requestDraft ||
        app.registrationDraft()?.revision !== requestRevision
      ) {
        URL.revokeObjectURL(url);
        return;
      }
      if (connection.kind === "supabase") {
        setMessage(
          "사진을 비공개 저장소에 업로드하고 있어요. 의류 등록은 저장 버튼으로 확정해요.",
        );
        const asset = await new HttpRemoteBackend().upload(
          file,
          "garment",
          registrationConsent ? ["openai"] : [],
        );
        URL.revokeObjectURL(url);
        if (
          photoRequest.current !== request ||
          app.getState().activeProfileId !== requestProfile ||
          app.registrationDraft()?.draftId !== requestDraft ||
          app.registrationDraft()?.revision !== requestRevision ||
          app.connection.kind !== "supabase"
        )
          return;
        app.replaceRegistrationPhoto(asset);
        setMessage(
          "사진을 비공개 저장소에 올렸어요. 외부 AI 전송은 별도 자산 허용과 실행 승인 후 가능해요.",
        );
        return;
      }
      const asset: Asset = {
        id: `upload-${crypto.randomUUID()}`,
        version: 1,
        source: "upload",
        url: null,
      };
      blobUrls.set(asset.id, url);
      app.replaceRegistrationPhoto(asset);
      setMessage(
        "사진을 선택했어요. 이 사진의 분석은 미연동이며 직접 입력할 수 있어요. 새로고침 후 사진 재선택이 필요해요.",
      );
    } catch (error) {
      URL.revokeObjectURL(url);
      if (
        photoRequest.current === request &&
        app.getState().activeProfileId === requestProfile &&
        app.registrationDraft()?.draftId === requestDraft &&
        app.registrationDraft()?.revision === requestRevision
      )
        setMessage(
          connection.kind === "supabase" && error instanceof Error
            ? `${error.message} 이전 사진과 입력은 유지했어요.`
            : "사진을 읽지 못했어요. 이전 사진과 입력은 유지했어요.",
        );
    }
  };
  const saveRegistration = () =>
    run(async () => {
      if (!registration) return;
      const token = operationId.current;
      const result = await app.saveGarment(
        `garment:${registration.draftId}:${registration.revision}`,
        options,
      );
      if (
        token === operationId.current &&
        app.registrationDraft()?.revision === registration.revision
      )
        setMessage(
          `저장 확인서 ${result.receipt.id} · 의류 ${result.entity.id}${connection.kind === "supabase" ? " · Supabase에 저장됨" : app.persistence.status === "memory-only" ? " · 현재 탭 메모리에서만 유지" : " · 이 브라우저에 저장됨"}`,
        );
    }, undefined);
  const saveLook = () =>
    run(async (current) => {
      const revision = draft.revision;
      const result = await app.saveOutfit(
        `outfit:${draft.draftId}:${draft.revision}`,
        options,
      );
      if (!current() || app.outfitDraft()?.revision !== revision) return;
      app.selectOutfit(result.entity.id);
      setSelectedOutfit(result.entity.id);
      setSavedOpen(true);
      setMessage(
        `코디를 저장했어요 · ${result.receipt.id}. 실제 착용 기록은 별도로 남겨요.`,
      );
    }, undefined);
  const button = (
    text: string,
    action: () => void,
    primary = false,
    icon?: string,
    disabled = false,
  ) => (
    <button
      type="button"
      className={primary ? "button primary" : "button"}
      onClick={action}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={18} />}
      <span>{text}</span>
    </button>
  );
  const back = () => {
    operationId.current++;
    restoreItem.current = detail;
    setDetail(null);
    setMessage("");
  };
  const title = (text: string, kicker?: string) => (
    <header className="section-header">
      {kicker && <p className="eyebrow">{kicker}</p>}
      <h1 tabIndex={-1} ref={titleRef}>
        {text}
      </h1>
    </header>
  );
  const status = message && (
    <div role="status" className="feedback">
      {message}
    </div>
  );
  const externalLinks = (
    <section className="external-links" aria-label="공식 스타일 사이트">
      <p>스타일 둘러보기</p>
      <div>
        <a
          href="https://www.instagram.com/"
          target="_blank"
          rel="noopener noreferrer"
          onClick={preserveContext}
        >
          Instagram 열기 <Icon name="external" size={14} />
        </a>
        <a
          href="https://www.musinsa.com/"
          target="_blank"
          rel="noopener noreferrer"
          onClick={preserveContext}
        >
          무신사 열기 <Icon name="external" size={14} />
        </a>
      </div>
      <details
        open={styleHelpOpen}
        onToggle={(e) => setStyleHelpOpen(e.currentTarget.open)}
      >
        <summary>새 탭이 열리지 않으면</summary>
        <p>
          아래 링크로 같은 탭에서 열 수 있어요. 로그인은 각 서비스에서 진행하며,
          방문만으로 옷이나 구매 기록을 가져오지 않아요.
        </p>
        <a href="https://www.instagram.com/" onClick={preserveContext}>
          Instagram 같은 탭에서 열기
        </a>
        <a href="https://www.musinsa.com/" onClick={preserveContext}>
          무신사 같은 탭에서 열기
        </a>
      </details>
    </section>
  );

  return (
    <div
      data-screen={screen}
      data-fit-open={fitOpen}
      className={`scene fixed-scene ${screen === "home" ? "home-scene" : ""} ${panelOpen ? "panel-open" : "panel-closed"}`}
    >
      <a
        className="skip-controls"
        href="#mirror-control-panel"
        onClick={(e) => {
          e.preventDefault();
          setPanelOpen(true);
          requestAnimationFrame(() => contentRef.current?.focus());
        }}
      >
        조작 패널로 건너뛰기
      </a>
      <BackendSessionBootstrap app={app} />
      <StorageCabinet
        simulated={packScene}
        side="left"
        cells={mirrorScene.compartments}
        onSelect={inspectGarment}
        photo={(asset, name) => <Photo asset={asset} name={name} />}
      />
      <main className="mirror" aria-label="스마트 옷장 미러">
        <header className="mirror-scene-heading">
          <span>
            SMART CLOSET <small>나의 옷, 하나의 장면</small>
          </span>
          <div className="scene-header-actions">
            <button
              className="pack-switch"
              onClick={() => navigateSurface("/")}
            >
              미러로 돌아가기
            </button>
            {connection.kind === "local" && (
              <button
                className="pack-switch"
                onClick={() => {
                  try {
                    preserveContext();
                    if (packScene) app.setActiveProfile("demo-profile");
                    else
                      app.installLocalDemoProfile(createWardrobePackBundle());
                    setGuideAll(false);
                    setPanelOpen(true);
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                {packScene ? "기존 시연으로" : "새 이미지팩 시연"}
              </button>
            )}
            <button
              ref={panelToggle}
              className="panel-toggle"
              aria-expanded={panelOpen}
              aria-controls="mirror-control-panel"
              onClick={() => {
                setPanelOpen(!panelOpen);
                panelToggle.current?.focus();
              }}
            >
              {panelOpen ? "패널 접기" : "조작 패널 열기"}
              <Icon name={panelOpen ? "close" : "list"} size={17} />
            </button>
          </div>
        </header>
        <div className="person-controls">
          <label>
            참고 인물
            <select
              aria-label="미러 인물 선택"
              value={personSelection.person.id}
              onChange={(e) => personSelection.setSelectedId(e.target.value)}
            >
              {PERSON_REFERENCES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {personSelection.localPerson && (
                <option value={personSelection.localPerson.id}>
                  {personSelection.localPerson.label}
                </option>
              )}
            </select>
          </label>
          <button type="button" onClick={() => personInput.current?.click()}>
            <Icon name="photo" size={16} />
            인물 사진 선택
          </button>
          <input
            ref={personInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="미러 인물 사진 파일"
            hidden
            onChange={(e) => {
              void personSelection.upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <MirrorPersonStage
          person={personSelection.person}
          media={sceneMedia}
          message={fitting.message}
        />
        {personSelection.personMessage && (
          <p className="person-file-note" role="status">
            {personSelection.personMessage}
          </p>
        )}
        {app.persistence.status === "memory-only" && (
          <div className="storage-warning" role="alert">
            {app.persistence.message ||
              "로컬 저장을 사용할 수 없어 현재 탭 메모리에만 유지돼요."}
          </div>
        )}
        <nav className="mirror-nav" aria-label="주 메뉴">
          {menus.map((m) => (
            <button
              key={m.id}
              aria-current={
                screen === m.id ||
                (screen === "registration" && m.id === "wardrobe")
                  ? "page"
                  : undefined
              }
              onClick={() => nav(m.id)}
            >
              <Icon name={m.icon} size={25} />
              <span>{m.label}</span>
            </button>
          ))}
        </nav>
        <div
          id="mirror-control-panel"
          tabIndex={-1}
          hidden={!panelOpen}
          ref={contentRef}
          onScroll={(e) => {
            scrollPositions.current[viewKey] = e.currentTarget.scrollTop;
            preserveContext();
          }}
          className={`mirror-content ${screen === "home" && !detail ? "home-content" : ""} ${screen === "outfit" ? "outfit-content" : ""}`}
        >
          {packScene && screen === "wardrobe" && !fitOpen && (
            <div className="review-scope">
              <strong>
                {showFullPack
                  ? "전체 팩 검토"
                  : `대표 시연 경로 ${REVIEW_GARMENT_IDS.length}품목`}
              </strong>
              <p>
                LOOK01~03·등록 확인에 필요한 품목입니다. 확정 물리 배치는 확인
                대기예요.
              </p>
              <button type="button" onClick={() => setShowFullPack((v) => !v)}>
                {showFullPack ? "대표 경로만 보기" : "팩 전체 목록 보기"}
              </button>
            </div>
          )}
          {fitOpen ? (
            <>
              <button className="text-button back" onClick={closeFit}>
                <Icon name="back" size={17} />
                코디로 돌아가기
              </button>
              {title("선택 코디 피팅", "VIRTUAL TRY-ON")}
              <p className="description">{fitMessage}</p>
              <div
                className="fitting-state"
                data-fitting-state={fitting.reason}
              >
                <strong>{fitting.label}</strong>
                <p role="status">{fitting.message}</p>
                <small>
                  옷 카드와 원본 인물 사진은 생성된 피팅 결과가 아니에요.
                </small>
              </div>
              <div className="fit-look-summary">
                <strong>현재 요청 조합 · 버전 {draft.revision}</strong>
                <p>
                  {Object.values(draft.items)
                    .map((id) => app.garments().find((g) => g.id === id)?.name)
                    .join(" · ")}
                </p>
              </div>
              {fittingInput.issues.length > 0 && (
                <ul className="fitting-issues">
                  {fittingInput.issues.map((issue, i) => (
                    <li key={`${issue.code}-${i}`}>
                      {issue.garmentId
                        ? `${app.garments().find((g) => g.id === issue.garmentId)?.name ?? issue.garmentId}: `
                        : ""}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {packScene && (
                <>
                  <button
                    className="button primary"
                    onClick={() => {
                      const snapshot = fittingInput.snapshot;
                      if (!snapshot) {
                        setFitMessage(
                          "현재 인물·코디 입력 자산을 확인해 주세요.",
                        );
                        return;
                      }
                      const candidate = matchPreparedPackResult(snapshot);
                      setFitRequest({
                        snapshot,
                        status: candidate ? "completed" : "unavailable",
                      });
                      setFitResult(candidate);
                      setFitMessage(
                        candidate
                          ? "전체 의류·인물·자산 버전이 일치하는 준비된 정적 착장 예시를 표시합니다. 실시간 생성이나 치수 검증은 아닙니다."
                          : "이 인물과 전체 코디에 일치하는 준비 결과가 없습니다. 원본 사진과 선택 코디를 유지합니다.",
                      );
                    }}
                  >
                    준비된 착장 예시 보기
                  </button>
                  <p className="subtle">
                    팩 예시 인물 + 정확히 일치하는 3개 코디에만 준비된 이미지가
                    있습니다.
                  </p>
                </>
              )}
              {!packScene && (
                <p className="subtle">
                  입력 자산을 먼저 연결해 주세요. 로그인 후 아래에서 같은 인물
                  영상과 전체 코디 참조로 저장 결과를 조회하거나 승인된 시험을
                  시작할 수 있어요.
                </p>
              )}
              <div className="actions">{button("피팅 종료", closeFit)}</div>
              {status}
              {!packScene && (
                <FittingControls
                  app={app}
                  onSceneStream={setStreamBinding}
                  retainedInputs={fittingInputs}
                  onInputsChange={setFittingInputs}
                  sceneSnapshot={fittingInput.snapshot}
                  onSceneResult={setFitResult}
                  onSceneRequest={setFitRequest}
                />
              )}
            </>
          ) : screen === "home" && !detail ? (
            <>
              <section className="home-today-compact">
                <div className="home-clock">
                  <strong>{today.time}</strong>
                  <p>{today.label} · 서울</p>
                </div>
                <h1>TODAY</h1>
                {homeOutfit ? (
                  <button
                    type="button"
                    aria-label="TODAY 추천 코디 열기"
                    className="home-today-card"
                    onClick={openProposal}
                  >
                    <OutfitPicture outfit={homeOutfit} />
                    <span>
                      <strong>{homeOutfit.name}</strong>
                      <small>전체 조합 보기 · 상의/하의 교체</small>
                    </span>
                  </button>
                ) : (
                  <p className="subtle">
                    상의와 하의를 등록하면 내 옷 조합을 열 수 있어요.
                  </p>
                )}
                <p className="subtle today-evidence">
                  {packScene ? "준비된 시연 조합" : "등록된 보유 의류 조합"} ·
                  사용 가능 여부 확인 전
                </p>
                {status}
              </section>
            </>
          ) : currentGarment ? (
            <>
              <button className="text-button back" onClick={back}>
                <Icon name="back" size={18} />내 옷장
              </button>
              {title(currentGarment.name, "내 옷 · 상세")}
              <div className="detail-hero">
                <Photo
                  asset={currentGarment.asset}
                  name={currentGarment.name}
                />
              </div>
              <div className="detail-line">
                <span>
                  {categories[currentGarment.category]} · {currentGarment.color}
                </span>
                <code>{currentGarment.id}</code>
              </div>
              <div className="info-block">
                <p>
                  <Icon name="pin" size={18} />
                  {garmentLocation(currentGarment).locationRef || "위치 미확인"}
                </p>
                <small>
                  출처:{" "}
                  {currentGarment.provenance.location === "demo"
                    ? "시연 기록"
                    : currentGarment.provenance.location === "user"
                      ? "사용자 확인"
                      : packScene
                        ? "화면 전용 배치 · 실제 위치 미확인"
                        : "미확인"}{" "}
                  · 실시간 센서 미연결
                </small>
              </div>
              <button
                className="button"
                onClick={() => inspectGarment(currentGarment.id)}
              >
                수납 칸 LED로 위치 보기
              </button>
              <GarmentFacts
                garment={currentGarment}
                ownerId={state.activeProfileId}
                outfits={app.outfits()}
                events={app.events()}
                onTakeOut={() => takeOut(currentGarment.id)}
              />
              <dl className="metadata">
                <dt>사이즈</dt>
                <dd>{currentGarment.size || "미확인"}</dd>
                <dt>소재</dt>
                <dd>{currentGarment.material || "라벨 확인 필요"}</dd>
                <dt>특징</dt>
                <dd>{currentGarment.features.join(" · ")}</dd>
              </dl>
              <div className="actions">
                {button(
                  "입어보기",
                  () => {
                    try {
                      app.setOutfitItem(
                        currentGarment.category,
                        currentGarment.id,
                      );
                      nav("outfit");
                      openFit();
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  },
                  true,
                  "outfit",
                )}
                {button(
                  "케어 보기",
                  () => {
                    setCareId(currentGarment.id);
                    nav("care");
                  },
                  false,
                  "care",
                )}
              </div>
              {status}
            </>
          ) : screen === "wardrobe" ? (
            <>
              {title("내 옷장", "MY WARDROBE")}
              <div className="section-tools">
                <span>
                  {packScene && !showFullPack
                    ? `대표 경로 ${reviewGarments.length}벌 · 전체 ${app.garments().length}벌 보존`
                    : `나의 옷 ${app.garments().length}벌`}
                </span>
                <button className="text-button" onClick={beginRegister}>
                  <Icon name="plus" size={18} />새 옷 등록
                </button>
              </div>
              <form
                className="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  search(ui.query);
                }}
              >
                <Icon name="search" size={20} />
                <input
                  aria-label="옷 검색"
                  placeholder="어떤 옷을 찾으세요?"
                  value={ui.query}
                  onChange={(e) => {
                    app.setSearchFilters({ query: e.target.value });
                    search(e.target.value);
                  }}
                />
                <button aria-label="검색 실행" type="submit">
                  <Icon name="arrow" size={20} />
                </button>
              </form>
              <div className="filters">
                {Object.entries(categories).map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={ui.category === id}
                    onClick={() => {
                      app.setSearchFilters({
                        category: id as Category | "all",
                      });
                      search(ui.query);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="view-tabs">
                <button
                  aria-pressed={subview === "list"}
                  onClick={() => setSubview("list")}
                >
                  <Icon name="list" size={17} />옷 보기
                </button>
                <button
                  aria-pressed={subview === "map"}
                  onClick={() => setSubview("map")}
                >
                  <Icon name="grid" size={17} />
                  위치로 찾기
                </button>
              </div>
              {ui.operations.search.status === "processing" && (
                <p role="status" className="subtle">
                  검색 중…
                </p>
              )}
              {subview === "map" && (
                <p className="subtle">
                  {packScene
                    ? "화면 양쪽의 시연 배치에서 옷을 누르세요. LED는 승인된 시연 배치만 안내하며 실제 보관 위치는 미확인입니다."
                    : "화면 양쪽의 수납 칸에서 옷을 누르세요. 목록에서 선택해도 같은 칸의 LED가 켜집니다. 위치 미확인 항목은 켜지지 않아요."}
                </p>
              )}
              <WardrobeRail
                garments={reviewGarments.filter((g) =>
                  ui.searchResultIds.includes(g.id),
                )}
                selectedId={ui.selectedGarmentId}
                onSelect={showGarment}
                photo={(g) => <Photo asset={g.asset} name={g.name} />}
                location={(g) =>
                  garmentLocation(g).locationRef || "위치 미확인"
                }
              />
              {packScene && (
                <details
                  className="pack-catalog-notes"
                  aria-label="팩 자산 안내"
                >
                  <summary>원본 팩·등록 예시 안내</summary>
                  <p className="subtle">
                    원본 팩은 보존하고 LOOK01~03과 등록 확인에 필요한 대표
                    품목부터 표시합니다. 실제 옷장 배치·사용 가능 상태는 별도
                    확인이 필요해요.
                  </p>
                  {PACK_READ_ONLY_ITEMS.map((item) => (
                    <div key={item.garment_id} className="pack-readonly-item">
                      <Photo asset={item.asset} name={item.name} />
                      <strong>{item.name}</strong>
                      <small>읽기 전용 · {item.reason}</small>
                    </div>
                  ))}
                  <details>
                    <summary>REGISTER01 · 기존 의류 확인 예시</summary>
                    <Photo
                      asset={PACK_REGISTRATION_EXAMPLE.asset}
                      name="REGISTER01 의류 확인 사진"
                    />
                    <p className="subtle">
                      팩에서 T04로 지정된 동일 품목 예시입니다. AI 분석이나 새
                      의류 등록을 실행하지 않아요.
                    </p>
                    <button
                      className="button"
                      onClick={() => {
                        const match = matchPackRegistration(
                          PACK_REGISTRATION_EXAMPLE.asset.id,
                          PACK_REGISTRATION_EXAMPLE.asset.version,
                        );
                        if (match) {
                          showGarment(match.garmentId);
                          setMessage(
                            "REGISTER01은 기존 T04입니다. 의류와 저장 기록을 추가하지 않았어요.",
                          );
                        }
                      }}
                    >
                      REGISTER01 → 기존 T04 확인
                    </button>
                  </details>
                </details>
              )}
              {!reviewGarments.some((g) =>
                ui.searchResultIds.includes(g.id),
              ) && (
                <div className="empty-state">
                  <Icon name="search" size={35} />
                  <p>찾는 옷이 없어요.</p>
                  <small>검색어나 종류를 바꿔보세요.</small>
                </div>
              )}
              {status}
            </>
          ) : screen === "registration" ? (
            <>
              <button
                className="text-button back"
                onClick={() => nav("wardrobe")}
              >
                <Icon name="back" size={18} />
                옷장으로 · 초안 유지
              </button>
              {title("새 옷 등록", "사진 선택 → 정보 확인 → 저장")}
              {registration && (
                <>
                  <div className="registration-photo">
                    <Photo asset={registration.asset} name="등록할 옷" />
                  </div>
                  <div className="actions">
                    {button(
                      "사진 선택",
                      () => uploadInput.current?.click(),
                      false,
                      "photo",
                    )}
                    {button("준비된 니트 사진", () => {
                      photoRequest.current++;
                      app.replaceRegistrationPhoto(REGISTRATION_ASSET);
                      setMessage(
                        "이 사진에 연결된 분석 예시를 확인할 수 있어요.",
                      );
                    })}
                  </div>
                  {connection.kind === "supabase" && (
                    <>
                      <label className="consent-choice">
                        <input
                          type="checkbox"
                          checked={registrationConsent}
                          onChange={(e) =>
                            setRegistrationConsent(e.target.checked)
                          }
                        />
                        이 의류 사진의 OpenAI 전송에 동의해요. 비용 승인은
                        별도예요.
                      </label>
                      <p className="subtle">
                        체크만으로 전송하지 않아요. 이미 보관한 사진의 동의는
                        바뀌지 않으므로 변경했다면 사진을 다시 선택해 주세요.
                      </p>
                    </>
                  )}
                  <input
                    ref={uploadInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="의류 사진 파일"
                    hidden
                    className="file-input"
                    onChange={(e) => {
                      void handleUpload(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <PhotoSuitability
                    key={`${connection.kind}:${state.activeProfileId}`}
                    app={app}
                  />
                  <button
                    className="button full"
                    disabled={ui.operations.analysis.status === "processing"}
                    onClick={() =>
                      void run(async (current) => {
                        const result = await app.analyzeRegistration(options);
                        if (!current() || result.status === "stale") return;
                        setMessage(
                          result.status === "success"
                            ? connection.mode === "mock"
                              ? "준비된 분석 예시를 적용했어요. 정보를 확인하고 수정해 주세요."
                              : `${processingLabel} 분석 결과를 적용했어요. 근거와 정보를 확인해 주세요.`
                            : result.message,
                        );
                      })
                    }
                  >
                    <Icon name="refresh" size={17} />
                    {ui.operations.analysis.status === "processing"
                      ? "분석 결과 확인 중…"
                      : connection.mode === "mock"
                        ? "분석 예시 확인"
                        : connection.mode === "saved_result"
                          ? "저장된 분석 결과 확인"
                          : "사진 분석 요청 · 승인 조건 검사"}
                  </button>
                  <div className="form-grid">
                    <label className="wide">
                      이름
                      <input
                        value={registration.name}
                        onChange={(e) =>
                          app.editRegistration({ name: e.target.value })
                        }
                        placeholder="예: 버건디 니트"
                      />
                    </label>
                    <label>
                      종류
                      <select
                        value={registration.category}
                        onChange={(e) =>
                          app.editRegistration({
                            category: e.target.value as Category,
                          })
                        }
                      >
                        {Object.entries(categories)
                          .filter(([id]) => id !== "all")
                          .map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      색상
                      <input
                        value={registration.color}
                        onChange={(e) =>
                          app.editRegistration({ color: e.target.value })
                        }
                        placeholder="미확인"
                      />
                    </label>
                    <label>
                      사이즈
                      <input
                        value={registration.size}
                        onChange={(e) =>
                          app.editRegistration({ size: e.target.value })
                        }
                        placeholder="미확인"
                      />
                    </label>
                    <label>
                      소재
                      <input
                        value={registration.material}
                        onChange={(e) =>
                          app.editRegistration({ material: e.target.value })
                        }
                        placeholder="라벨 확인 필요"
                      />
                    </label>
                    <label className="wide">
                      보관 위치
                      <input
                        value={registration.location}
                        onChange={(e) =>
                          app.editRegistration({ location: e.target.value })
                        }
                        placeholder="확인한 위치만 입력"
                      />
                    </label>
                  </div>
                  <p className="subtle">
                    입력한 정보는 수동값으로 보존해요. 사진 선택만으로 등록되지
                    않아요.
                  </p>
                  {status}
                  <div className="actions">
                    {button(
                      "내 옷장에 저장",
                      () => void saveRegistration(),
                      true,
                      "check",
                      busy,
                    )}
                    {registration.savedGarmentId &&
                      button("저장한 옷 보기", () => {
                        const id = registration.savedGarmentId!;
                        nav("wardrobe");
                        showGarment(id);
                      })}
                  </div>
                  <small className="subtle">
                    초안 revision {registration.revision}
                  </small>
                  {registration.savedGarmentId &&
                    app
                      .receipts()
                      .some(
                        (r) =>
                          r.draftId === registration.draftId &&
                          r.revision === registration.revision,
                      ) && (
                      <button
                        className="text-button new-registration"
                        onClick={() => {
                          app.discardRegistration();
                          app.beginRegistration();
                          setMessage(
                            "저장한 옷은 유지하고 새 등록을 시작했어요.",
                          );
                        }}
                      >
                        다른 옷 등록
                      </button>
                    )}
                </>
              )}
            </>
          ) : screen === "outfit" ? (
            <>
              {title("오늘의 코디", "TODAY · 전체 조합 비교")}
              {packScene && (
                <details className="pack-look-presets-detail">
                  <summary>준비된 착장 예시 · LOOK01~03</summary>
                  <div className="pack-look-presets" aria-label="팩 준비 코디">
                    {["LOOK01", "LOOK02", "LOOK03"].map((id) => (
                      <button
                        key={id}
                        onClick={() => {
                          compareSaved(id);
                          app.selectOutfit(id);
                          setSelectedOutfit(id);
                          setEditSlot("bottom");
                          setMessage(
                            "팩의 준비 조합을 열었어요. 이전 초안은 보존됩니다.",
                          );
                        }}
                      >
                        {id} 열기
                      </button>
                    ))}
                  </div>
                </details>
              )}
              {selectedGarment && (
                <button
                  className="text-button"
                  onClick={() => {
                    nav("wardrobe");
                    showGarment(selectedGarment.id);
                  }}
                >
                  선택한 옷 상세 · {selectedGarment.name}
                </button>
              )}
              <p className="description outfit-description">
                같은 인물과 전체 조합을 유지하며 한 종류씩 바꿔보세요. 의류 카드
                비교는 피팅 결과가 아니에요.
              </p>
              {app.previousOutfitDraft() && (
                <button
                  className="text-button previous-draft"
                  onClick={() => {
                    app.resumePreviousDraft();
                    setSelectedOutfit(null);
                    setMessage(
                      "이전 편집 초안을 다시 열었어요. 방금 조합도 별도로 유지했어요.",
                    );
                  }}
                >
                  이전 편집 초안 재개
                </button>
              )}
              <label className="outfit-name-field">
                코디 이름
                <input
                  aria-label="코디 이름"
                  value={draft.name}
                  onChange={(e) => app.editOutfitName(e.target.value)}
                />
              </label>
              <div className="slot-quick-actions" aria-label="한 종류만 교체">
                {(["top", "bottom"] as Slot[]).map((slot) => (
                  <button
                    key={slot}
                    aria-pressed={editSlot === slot}
                    onClick={() => {
                      setEditSlot(slot);
                      if (slot === "top" && draft.topLocked)
                        app.toggleTopLock();
                      setMessage(
                        `${categories[slot]} 교체 후보를 열었어요. 다른 구성품은 그대로 유지해요.`,
                      );
                    }}
                  >
                    {categories[slot]}만 바꾸기
                  </button>
                ))}
              </div>
              {comparison && comparison.ownerId === state.activeProfileId && (
                <details className="whole-look-comparison" open>
                  <summary>처음 조합과 현재 조합</summary>
                  <div>
                    <figure>
                      <OutfitPicture outfit={comparison} />
                      <figcaption>처음 전체 조합</figcaption>
                    </figure>
                    <figure>
                      <OutfitPicture
                        outfit={{
                          id: draft.draftId,
                          ownerId: state.activeProfileId,
                          name: draft.name,
                          items: draft.items,
                          revision: draft.revision,
                          assetVersions: {},
                        }}
                      />
                      <figcaption>현재 전체 조합</figcaption>
                    </figure>
                  </div>
                  <small>
                    중앙의 같은 인물 유지 · 피팅은 일치하는 결과가 있을 때만
                    표시
                  </small>
                </details>
              )}
              <section
                className="outfit-workspace"
                data-comparison={
                  !!comparison && comparison.ownerId === state.activeProfileId
                }
                aria-label="현재 조합과 교체 후보 비교"
              >
                <div className="outfit-preview">
                  <OutfitPicture
                    outfit={{
                      id: draft.draftId,
                      ownerId: state.activeProfileId,
                      name: draft.name,
                      items: draft.items,
                      revision: draft.revision,
                      assetVersions: {},
                    }}
                  />
                  <div className="preview-caption">
                    현재 전체 조합<small>사진 없는 항목은 준비 중</small>
                  </div>
                </div>
                <div className="outfit-editor">
                  <div className="outfit-items">
                    {Object.entries(draft.items).map(([slot, id]) => {
                      const g = app.garments().find((g) => g.id === id);
                      return (
                        g && (
                          <div key={slot}>
                            <button
                              className={
                                editSlot === slot
                                  ? "item-select active"
                                  : "item-select"
                              }
                              aria-label={`${categories[slot as Category]} 선택 · ${g.name}`}
                              aria-pressed={editSlot === slot}
                              onClick={() => {
                                setEditSlot(slot as Slot);
                                inspectGarment(g.id);
                              }}
                            >
                              <span>{categories[slot as Category]}</span>
                              <strong>{g.name}</strong>
                            </button>
                            {slot === "top" && (
                              <button
                                className={
                                  draft.topLocked ? "lock active" : "lock"
                                }
                                aria-pressed={draft.topLocked}
                                onClick={() => app.toggleTopLock()}
                              >
                                <Icon name="lock" size={16} />
                                {draft.topLocked ? "고정됨" : "고정"}
                              </button>
                            )}
                          </div>
                        )
                      );
                    })}
                  </div>
                  <label className="select-label slot-picker">
                    바꿀 종류
                    <select
                      aria-label="바꿀 종류"
                      value={editSlot}
                      onChange={(e) => setEditSlot(e.target.value as Slot)}
                    >
                      {Object.entries(categories)
                        .filter(([id]) => id !== "all")
                        .map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <h2>{categories[editSlot]} 바꿔보기</h2>
                  <div className="candidate-list">
                    {reviewGarments
                      .filter((g) => g.category === editSlot)
                      .map((g) => (
                        <button
                          key={g.id}
                          aria-pressed={draft.items[editSlot] === g.id}
                          disabled={
                            isUnavailable(g) ||
                            (editSlot === "top" &&
                              draft.topLocked &&
                              draft.items.top !== g.id)
                          }
                          title={
                            isUnavailable(g)
                              ? "세탁·수선 중으로 확인한 옷"
                              : undefined
                          }
                          onClick={() => {
                            app.setOutfitItem(editSlot, g.id);
                            setGuideAll(false);
                            app.selectGarment(g.id);
                            setSelectedOutfit(null);
                            setMessage(
                              `${categories[editSlot]}만 바꿨어요. 선택한 조합을 확인해 주세요.`,
                            );
                          }}
                        >
                          <Photo asset={g.asset} name={g.name} />
                          <span>{g.name}</span>
                          {draft.items[editSlot] === g.id && (
                            <Icon name="check" size={16} />
                          )}
                        </button>
                      ))}
                  </div>
                  {!reviewGarments.some((g) => g.category === editSlot) && (
                    <p className="subtle candidate-empty">
                      등록된 {categories[editSlot]} 자산이 없어요. 전달된 사진을
                      새 옷 등록에서 추가할 수 있어요.
                    </p>
                  )}
                </div>
              </section>
              <div className="wear-today-action">
                {button(
                  busy ? "기록 처리 중…" : "이 옷으로 입기",
                  wearToday,
                  true,
                  "check",
                  busy,
                )}
                <small>오늘 실제 착용으로 기록 · 착용 일수에 반영</small>
              </div>
              {status}
              <div className="actions outfit-primary-actions">
                {button("입어보기", openFit, false, "outfit")}
                {button(
                  "코디 저장",
                  () => void saveLook(),
                  false,
                  "check",
                  busy,
                )}
              </div>
              <OutfitReviewCard
                review={review}
                onReviewChange={handleReviewChange}
                ownerId={state.activeProfileId}
                garments={app.garments()}
                draft={draft}
                onReplace={(slot, id) => {
                  app.setOutfitItem(slot, id);
                  setEditSlot(slot);
                  setGuideAll(false);
                  app.selectGarment(id);
                  setSelectedOutfit(null);
                  setMessage(
                    `${categories[slot]}만 바꿨어요. 다른 구성품과 인물은 유지합니다.`,
                  );
                }}
              />
              <details
                className="condition-picker"
                open={conditionsOpen}
                onToggle={(e) => setConditionsOpen(e.currentTarget.open)}
              >
                <summary>추천 조건</summary>
                <div className="form-grid">
                  <label>
                    날씨
                    <select
                      disabled={
                        ui.operations.recommendation.status === "processing"
                      }
                      value={weather}
                      onChange={(e) => setWeather(e.target.value)}
                    >
                      <option value="sunny">맑음 · 11°</option>
                      <option value="rainy">비</option>
                    </select>
                  </label>
                  <label>
                    일정
                    <select
                      disabled={
                        ui.operations.recommendation.status === "processing"
                      }
                      value={occasion}
                      onChange={(e) => setOccasion(e.target.value)}
                    >
                      <option value="work">출근</option>
                      <option value="exercise">운동</option>
                    </select>
                  </label>
                </div>
                <button
                  className="button"
                  onClick={() =>
                    void run(async (current) => {
                      const result = await app.generateOutfits(
                        { ...DEMO_CONDITIONS, weather, occasion },
                        options,
                        recommendationAvailability(
                          review,
                          state.activeProfileId,
                          app.garments(),
                        ),
                      );
                      if (!current() || result.status === "stale") return;
                      setMessage(
                        result.status === "success"
                          ? connection.kind === "local" ||
                            connection.mode === "mock"
                            ? "현재 고정 조건에 맞는 준비 예시를 적용했어요."
                            : "현재 조건으로 받은 제안을 초안에 적용했어요. 저장은 별도예요."
                          : result.message,
                      );
                    })
                  }
                >
                  다른 코디 추천
                </button>
              </details>
              <details
                className="saved-outfits-panel"
                open={savedOpen}
                onToggle={(e) => setSavedOpen(e.currentTarget.open)}
              >
                <summary>
                  저장한 코디 <small>{app.outfits().length}</small>
                </summary>
                <div className="saved-looks">
                  {app.outfits().map((o) => (
                    <button
                      key={o.id}
                      className={selectedOutfit === o.id ? "selected" : ""}
                      onClick={() => {
                        operationId.current++;
                        app.selectOutfit(o.id);
                        setSelectedOutfit(o.id);
                      }}
                    >
                      <Icon name="outfit" size={20} />
                      <span>
                        {o.name}
                        <small>저장 버전 {o.revision}</small>
                      </span>
                      <Icon name="arrow" size={17} />
                    </button>
                  ))}
                </div>
                {activeOutfit && (
                  <div className="saved-detail">
                    <h2>저장된 조합</h2>
                    <OutfitPicture outfit={activeOutfit} />
                    <p>
                      {Object.values(activeOutfit.items)
                        .map(
                          (id) => app.garments().find((g) => g.id === id)?.name,
                        )
                        .join(" · ")}
                    </p>
                    <small className="subtle">
                      저장 버전 {activeOutfit.revision} · 현재 초안과 별도
                    </small>
                    <div className="actions">
                      {button("이 저장 코디로 편집", () => {
                        compareSaved(activeOutfit.id);
                        setSelectedOutfit(activeOutfit.id);
                        setMessage(
                          "저장된 의류 구성을 다시 열었어요. 현재 사진 버전과 같은 입력의 피팅 결과만 연결해요.",
                        );
                      })}
                      {button("착용 계획", () => openEvent("plan"))}
                      {button("실제 착용 기록", () => openEvent("wear"))}
                    </div>
                  </div>
                )}
              </details>
              {externalLinks}
              <StyleReferenceInput
                availabilityConfirmations={recommendationAvailability(
                  review,
                  state.activeProfileId,
                  app.garments(),
                )}
                key={`${connection.kind}:${state.activeProfileId}`}
                app={app}
              />
            </>
          ) : screen === "care" ? (
            <>
              {title("내 옷 케어", "CARE FOR YOUR CLOTHES")}
              {careGarment && (
                <button
                  className="text-button back"
                  onClick={() => {
                    nav("wardrobe");
                    showGarment(careGarment.id);
                  }}
                >
                  이 옷의 상세로
                </button>
              )}
              <label className="select-label">
                관리할 옷
                <select
                  value={careId}
                  onChange={(e) => {
                    operationId.current++;
                    setCareId(e.target.value);
                    setGuideAll(false);
                    app.selectGarment(e.target.value);
                    setCareDone(null);
                    setGuide(null);
                    setMessage("");
                  }}
                >
                  {app.garments().map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              {careDone?.garmentId === careId && (
                <div
                  className="care-completion feedback"
                  role="status"
                  data-garment-id={careId}
                >
                  <Icon name="check" size={20} />
                  <div>
                    <strong>
                      {careGarment?.name} · {careDone.action} 기록을 남겼어요.
                    </strong>
                    <button
                      className="text-button"
                      onClick={() => {
                        app.setCalendarDate(DEMO_DATE);
                        nav("calendar");
                      }}
                    >
                      캘린더에서 케어 기록 보기
                    </button>
                  </div>
                </div>
              )}
              {careGarment && (
                <>
                  <div className="care-photo">
                    <Photo asset={careGarment.asset} name={careGarment.name} />
                  </div>
                  <h2>{careGarment.name}</h2>
                  <GarmentFacts
                    garment={careGarment}
                    ownerId={state.activeProfileId}
                    outfits={app.outfits()}
                    events={app.events()}
                    onTakeOut={() => takeOut(careGarment.id)}
                  />
                  <p className="description">
                    입력한 관리 근거를 확인하고 필요한 작업만 선택하세요.
                  </p>
                  <div className="info-block">
                    <p>관리 근거</p>
                    <small>
                      {careGarment.careNotes ||
                        "확인된 관리 라벨이 없어요. 소재와 세탁법을 추측하지 않아요."}
                    </small>
                  </div>
                  <CareEvidenceInput
                    key={`${connection.kind}:${state.activeProfileId}:${careId}`}
                    app={app}
                    garmentId={careId}
                    onSaved={() => setGuide(null)}
                  />
                  {button(
                    ui.operations.careGuide.status === "processing"
                      ? "안내 확인 중…"
                      : "케어 안내 확인",
                    () =>
                      void run(async (current) => {
                        const result = await app.requestCareGuide(
                          careId,
                          options,
                        );
                        if (!current()) return;
                        if (result.status === "success") setGuide(result.data);
                        else setMessage(result.message);
                      }),
                    false,
                    "info",
                    busy,
                  )}
                  {guide && guide.garmentId === careId && (
                    <div className="guide">
                      <h2>{guide.title}</h2>
                      <p>{guide.advice}</p>
                      <small>
                        {guide.source === "prepared-demo"
                          ? "준비 예시"
                          : guide.source === "provider"
                            ? processingLabel
                            : "근거 미확인"}{" "}
                        · 관리 완료 기록 아님
                      </small>
                    </div>
                  )}
                  <div className="actions">
                    {button("보관하기", () => setCareConfirm("movement"), true)}
                    {button("관리 완료 기록", () => setCareConfirm("care"))}
                    {button("나중에", () => nav("home"))}
                  </div>
                  {status}
                </>
              )}
            </>
          ) : screen === "calendar" ? (
            <>
              {title("캘린더", "나의 옷과 함께한 날들")}
              {status}
              <div className="month-title">
                <button
                  className="month-arrow"
                  aria-label="이전 달"
                  disabled={!month.canPrevious}
                  onClick={() =>
                    app.setCalendarDate(moveCalendarMonth(eventDate, -1))
                  }
                >
                  <Icon name="back" size={20} />
                </button>
                <div>
                  <strong>
                    {month.year}년 {month.month}월
                  </strong>
                  <span>
                    {connection.kind === "supabase"
                      ? "내가 확인한 기록"
                      : "시연 기록 달력"}
                  </span>
                </div>
                <button
                  className="month-arrow"
                  aria-label="다음 달"
                  disabled={!month.canNext}
                  onClick={() =>
                    app.setCalendarDate(moveCalendarMonth(eventDate, 1))
                  }
                >
                  <Icon name="arrow" size={20} />
                </button>
              </div>
              <div className="calendar-grid">
                {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                  <span className="day-label" key={i}>
                    {d}
                  </span>
                ))}
                {Array.from({ length: month.firstWeekday }, (_, i) => (
                  <span key={`empty${i}`} />
                ))}
                {Array.from({ length: month.days }, (_, i) => {
                  const date = `${month.prefix}-${String(i + 1).padStart(2, "0")}`;
                  return (
                    <button
                      key={date}
                      aria-label={`${month.year}년 ${month.month}월 ${i + 1}일`}
                      aria-pressed={eventDate === date}
                      className={eventDate === date ? "selected" : ""}
                      onClick={() => app.setCalendarDate(date)}
                    >
                      {i + 1}
                      {app.events().some((e) => e.date === date) && <i />}
                    </button>
                  );
                })}
              </div>
              <h2>{eventDate.replaceAll("-", ".")}의 기록</h2>
              <p className="subtle">
                계획 · 실제 착용 · 관리 · 이동을 구분해요.
              </p>
              <div className="events">
                {app
                  .events()
                  .filter((e) => e.date === eventDate)
                  .sort(
                    (a, b) =>
                      Number(!["plan", "wear"].includes(a.kind)) -
                      Number(!["plan", "wear"].includes(b.kind)),
                  )
                  .map((e) => {
                    const look = app.outfits().find((o) => o.id === e.outfitId);
                    const garment = app
                      .garments()
                      .find((g) => g.id === e.garmentId);
                    return (
                      <article key={e.id}>
                        <span className={`event-kind ${e.kind}`}>
                          {labels[e.kind]}
                        </span>
                        <div className="calendar-event-content">
                          {look ? (
                            <div className="calendar-outfit-picture">
                              <OutfitPicture outfit={look} />
                            </div>
                          ) : garment ? (
                            <div className="calendar-garment-picture">
                              <Photo
                                asset={garment.asset}
                                name={garment.name}
                              />
                            </div>
                          ) : null}
                          <div>
                            <h3>{garment?.name ?? look?.name}</h3>
                            {look && (
                              <p className="event-composition">
                                {Object.values(look.items)
                                  .map(
                                    (id) =>
                                      app.garments().find((g) => g.id === id)
                                        ?.name,
                                  )
                                  .join(" · ")}
                              </p>
                            )}
                            <p>{e.value}</p>
                            <small>
                              {connection.kind === "supabase"
                                ? "사용자 확인 · 서버 저장 기록"
                                : "사용자 확인 · 시연 기록"}
                            </small>
                          </div>
                        </div>
                        <details className="event-technical">
                          <summary>기록 정보</summary>
                          <code>{e.id}</code>
                        </details>
                      </article>
                    );
                  })}
              </div>
              {!app.events().some((e) => e.date === eventDate) && (
                <div className="empty-state">
                  <Icon name="calendar" size={35} />
                  <p>아직 남긴 기록이 없어요.</p>
                  <small>코디 저장만으로 착용 기록이 생기지 않아요.</small>
                </div>
              )}
              {button(
                "저장한 코디 보기",
                () => {
                  nav("outfit");
                  setSavedOpen(true);
                },
                false,
                "outfit",
              )}
            </>
          ) : screen === "my" ? (
            <>
              {title("마이", "MY PROFILE")}
              <div className="profile-symbol">
                <Icon name="user" size={42} />
              </div>
              <h2>
                {state.profiles.find((p) => p.id === state.activeProfileId)
                  ?.name ?? "내 계정"}
              </h2>
              <p className="description">
                {connection.kind === "supabase"
                  ? "인증된 내 계정의 허용 데이터만 조회해요."
                  : "개발용 비식별 프로필이에요. 실제 고객이나 가족 계정과 연결되지 않았어요."}
              </p>
              <div className="info-block">
                <p>
                  {connection.kind === "supabase"
                    ? "저장과 처리 상태"
                    : "이 브라우저에 보관되는 것"}
                </p>
                <small>
                  {connection.kind === "supabase"
                    ? `Supabase 연결 · AI ${processingLabel}. 파일 업로드, 분석, 의류 저장은 각각 별도 행동이에요.`
                    : "옷 정보, 검색 조건, 편집 초안, 저장한 코디와 확인 기록. 선택한 사진 원본은 저장되지 않아요."}
                </small>
              </div>
              <BackendPanel app={app} />
              {status}
            </>
          ) : null}
        </div>
        <section className="scene-look-dock" aria-label="장면의 현재 코디">
          <div className="dock-heading">
            <strong>현재 코디</strong>
            <span>v{draft.revision}</span>
            <button
              onClick={() => {
                nav("outfit");
              }}
            >
              편집
            </button>
            <button
              onClick={() => {
                nav("outfit");
                openFit();
              }}
            >
              피팅
            </button>
          </div>
          <div className="dock-items">
            {Object.entries(draft.items).map(([slot, id]) => {
              const garment = app.garments().find((g) => g.id === id);
              return (
                garment && (
                  <button
                    key={slot}
                    data-dock-garment-id={id}
                    aria-label={`${garment.name} 위치 안내`}
                    aria-pressed={ui.selectedGarmentId === id && !guideAll}
                    onClick={() => inspectGarment(id)}
                  >
                    <Photo asset={garment.asset} name={garment.name} />
                    <span>{categories[slot as Category]}</span>
                  </button>
                )
              );
            })}
          </div>
          <div
            className="location-readout"
            role="status"
            data-location-status={mirrorScene.inspected.status}
          >
            <span>
              {guideAll
                ? `코디 전체 · ${mirrorScene.guidedCompartmentIds.length}칸 안내${mirrorScene.locationGuides.some((g) => g.status !== "mapped") ? ` · ${mirrorScene.locationGuides.filter((g) => g.status !== "mapped").length}벌 위치 미확인` : ""}`
                : mirrorScene.inspected.message}
            </span>
            <button
              aria-pressed={guideAll}
              onClick={() => setGuideAll((v) => !v)}
            >
              전체 위치
            </button>
          </div>
        </section>
        <footer className="demo-footer">
          <span>
            {connection.kind === "supabase"
              ? `Supabase 연결 · AI ${processingLabel}`
              : "DB·외부 API 미연결 시연 프로토타입"}
          </span>
          <small>
            {today.label} · {today.time} ·{" "}
            {connection.kind === "supabase" ? "원격 저장" : "로컬 시연 기록"}
          </small>
          <button aria-label="발표자 도구" onClick={() => setTools(true)}>
            <Icon name="tools" size={16} />
          </button>
        </footer>
      </main>
      <StorageCabinet
        simulated={packScene}
        side="right"
        cells={mirrorScene.compartments}
        onSelect={inspectGarment}
        photo={(asset, name) => <Photo asset={asset} name={name} />}
      />
      <p className="narrow-scene-notice">
        좁은 창 모드 · 세 수납 영역은 유지됩니다. 큰 창에서 인물과 조작 패널을
        함께 확인해 주세요.
      </p>
      {careConfirm && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="care-confirm"
          >
            <h2 id="care-confirm">
              {careConfirm === "movement"
                ? "보관 위치를 확인했나요?"
                : "실제 관리를 마쳤나요?"}
            </h2>
            <p>
              {careConfirm === "movement"
                ? connection.kind === "supabase"
                  ? "직접 확인한 보관 위치 이동을 서버에 기록해요. 이동 제안만으로 위치는 바뀌지 않아요."
                  : "이동 제안만으로 옷의 위치를 바꾸지 않아요. 아래 확인은 시연용 사용자 확인 기록을 남겨요."
                : connection.kind === "supabase"
                  ? "직접 마친 관리 내용을 서버에 기록해요. 안내를 읽는 행동과는 별도예요."
                  : "안내 열람과 완료 기록은 달라요. 아래 확인은 시연용 관리 기록을 남겨요."}
            </p>
            {careConfirm === "movement" && (
              <p className="info-block">보관함 · 계절 보관 구역</p>
            )}
            <div className="actions">
              {button(
                "확인 기록 남기기",
                () =>
                  void run(async (current) => {
                    const key = crypto.randomUUID();
                    const targetId = careId;
                    const action = careConfirm;
                    const result =
                      action === "movement"
                        ? await app.recordMovementConfirmed(
                            targetId,
                            "보관함 · 계절 보관 구역",
                            key,
                            options,
                          )
                        : await app.recordActualCare(
                            targetId,
                            "보관 전 상태 확인",
                            key,
                            options,
                          );
                    if (!current()) return;
                    setCareConfirm(null);
                    setCareDone({
                      garmentId: targetId,
                      receiptId: result.receipt.id,
                      action: action === "movement" ? "보관 이동" : "관리 확인",
                    });
                  }),
                true,
                "check",
                busy,
              )}
              {button("취소", () => {
                operationId.current++;
                setCareConfirm(null);
              })}
            </div>
            {status}
          </section>
        </div>
      )}
      {eventConfirm && activeOutfit && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-confirm"
          >
            <h2 id="event-confirm">
              {eventConfirm === "plan"
                ? "입을 계획 남기기"
                : "실제로 입은 기록 남기기"}
            </h2>
            <p>{activeOutfit.name}</p>
            <label className="select-label">
              날짜
              <input
                type="date"
                disabled={busy}
                value={pendingEventDate}
                onChange={(e) => setPendingEventDate(e.target.value)}
              />
            </label>
            <p className="subtle">
              {connection.kind === "supabase"
                ? "선택한 날짜에 사용자 확인 기록을 저장해요."
                : "시연용 사용자 확인으로 기록해요."}
            </p>
            <div className="actions">
              {button(
                "확인하여 저장",
                () =>
                  void run(async (current) => {
                    const date = pendingEventDate,
                      kind = eventConfirm,
                      targetId = activeOutfit.id;
                    const existing = app
                      .events()
                      .find(
                        (e) =>
                          e.kind === kind &&
                          e.outfitId === targetId &&
                          e.date === date,
                      );
                    if (existing) {
                      app.setCalendarDate(date);
                      setEventConfirm(null);
                      nav("calendar");
                      setMessage(
                        "같은 코디·날짜의 확인 기록이 이미 있어요. 중복으로 추가하지 않았어요.",
                      );
                      return;
                    }
                    const key = await confirmationIntent({
                      ownerId: state.activeProfileId,
                      kind,
                      targetId,
                      date,
                    });
                    if (!current()) return;
                    if (kind === "plan")
                      await app.planOutfit(targetId, date, key, options);
                    else await app.recordWear(targetId, date, key, options);
                    if (!current()) return;
                    app.setCalendarDate(date);
                    setEventConfirm(null);
                    nav("calendar");
                    setMessage(
                      "사용자가 확인한 기록을 저장했어요. 코디 선택·피팅·저장과 별도 기록이에요.",
                    );
                  }),
                true,
                "check",
                busy,
              )}
              {button("취소", () => {
                operationId.current++;
                setEventConfirm(null);
              })}
            </div>
            {status}
          </section>
        </div>
      )}
      {tools && (
        <div className="modal-backdrop">
          <section
            className="modal presenter"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tools-title"
          >
            <button
              className="close"
              aria-label="발표자 도구 닫기"
              onClick={() => setTools(false)}
            >
              <Icon name="close" />
            </button>
            <p className="eyebrow">발표자 전용</p>
            <h2 id="tools-title">시연 제어</h2>
            <p>고객 기능과 분리된 검증 도구예요.</p>
            <BackendPanel app={app} placement="tools" />
            <label className="select-label">
              모의 처리 지연
              <select
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
              >
                <option value="0">없음</option>
                <option value="450">0.45초</option>
                <option value="3000">3초 · 늦은 응답 검증</option>
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={fail}
                onChange={(e) => setFail(e.target.checked)}
              />
              모의 처리 오류 재현
            </label>
            <p className="subtle">
              저장 상태:{" "}
              {connection.kind === "supabase"
                ? "Supabase 인증 연결"
                : app.persistence.status === "ready"
                  ? "이 브라우저의 localStorage"
                  : "현재 탭 메모리 전용"}
              <br />
              등록 {app.garments().length} · 코디 {app.outfits().length} ·
              확인서 {state.receipts.length} · 행동 기록 {app.events().length}
            </p>
            <div className="actions">
              {button("홈 장면으로", () => {
                nav("home");
                setTools(false);
              })}
              {button("옷장 장면으로", () => {
                nav("wardrobe");
                setTools(false);
              })}
              {button("데모 초기화", () => setResetConfirm(true))}
            </div>
            {status}
            {resetConfirm && (
              <div className="reset-confirm">
                <p>
                  이 프로젝트에서 저장한 데모 정보와 초안을 지우고 처음 상태로
                  복원할까요?
                </p>
                {button(
                  "초기화 확인",
                  () => {
                    try {
                      app.resetDemo();
                    } catch (e) {
                      setMessage((e as Error).message);
                      return;
                    }
                    operationId.current++;
                    photoRequest.current++;
                    for (const url of blobUrls.values())
                      URL.revokeObjectURL(url);
                    blobUrls.clear();
                    setResetConfirm(false);
                    setTools(false);
                    setDetail(null);
                    setCareDone(null);
                    setGuide(null);
                    setSelectedOutfit(null);
                    setMessage("");
                    setViewRevision(viewRevision + 1);
                  },
                  false,
                  "refresh",
                )}
                {button("돌아가기", () => setResetConfirm(false))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
