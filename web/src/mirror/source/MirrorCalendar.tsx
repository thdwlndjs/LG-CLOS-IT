import { ServerWearConfirmation } from "./ServerWearConfirmation";
import { effectiveLifeEvents, lifeEventDate } from "./lifeHistory";
import { lifeHistoryReadOptions } from "./lifeSnapshot";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DemoApp } from "./core/app";
import type { Outfit } from "./core/types";
import { calendarMonth, moveCalendarMonth } from "./calendar";
import {
  calendarEntries,
  calendarEventGarments,
  mirrorCalendarCells,
} from "./mirrorPanelData";
import { HorizontalPager } from "./HorizontalPager";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
import { describeOutfitCard } from "./outfitCardPresentation";
import {
  readPendingWear,
  rememberPendingWear,
  forgetPendingWear,
} from "./pendingWearConfirmation";
import "./mirror-panels.css";

const eventNames = {
  plan: "선택·계획",
  wear: "실제 착용",
  care: "관리",
  movement: "이동",
} as const;
type CalendarNavigation = {
  selected: string;
  viewDate: string;
  entryIndex: number;
};
const calendarNavigation = new WeakMap<
  DemoApp["repository"],
  Map<string, CalendarNavigation>
>();
type WearConfirmation = {
  ownerId: string;
  date: string;
  planId: string;
  outfitId: string;
  intentKey: string;
  title: string;
  recovery?: boolean;
};
const unresolvedWear = new WeakMap<
  DemoApp["repository"],
  Map<string, WearConfirmation>
>();
const wearKey = (
  value: Pick<WearConfirmation, "ownerId" | "date" | "planId" | "outfitId">,
) => JSON.stringify([value.ownerId, value.date, value.planId, value.outfitId]);
const wearRequests = (repository: DemoApp["repository"]) => {
  let requests = unresolvedWear.get(repository);
  if (!requests) {
    requests = new Map();
    unresolvedWear.set(repository, requests);
  }
  return requests;
};
export function MirrorCalendar({
  app,
  today,
  onReuse,
  onBrowseOutfits,
}: {
  app: DemoApp;
  today: string;
  onReuse: (outfit: Outfit) => void;
  onBrowseOutfits: () => void;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getState),
    owner = state.activeProfileId,
    selected = app.ui().calendarDate ?? today;
  const repository = app.repository;
  let ownerNavigation = calendarNavigation.get(repository);
  if (!ownerNavigation) {
    ownerNavigation = new Map();
    calendarNavigation.set(repository, ownerNavigation);
  }
  let navigation = ownerNavigation.get(owner);
  if (!navigation || navigation.selected !== selected) {
    navigation = { selected, viewDate: selected, entryIndex: 0 };
    ownerNavigation.set(owner, navigation);
  }
  const { viewDate, entryIndex } = navigation;
  const [, renderNavigation] = useState(0);
  const updateNavigation = (patch: Partial<CalendarNavigation>) => {
    ownerNavigation.set(owner, { ...ownerNavigation.get(owner)!, ...patch });
    renderNavigation((value) => value + 1);
  };
  const setViewDate = (value: string) => updateNavigation({ viewDate: value }),
    setEntryIndex = (value: number) => updateNavigation({ entryIndex: value });
  const [wear, setWear] = useState<WearConfirmation | null>(null),
    [wearMessage, setWearMessage] = useState(""),
    [wearSaving, setWearSaving] = useState(false);
  const mounted = useRef(true),
    wearRef = useRef(wear),
    pending = useRef(new Set<string>());
  wearRef.current = wear;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    wearRef.current = null;
    setWear(null);
    setWearMessage("");
    setWearSaving(false);
  }, [owner, selected, repository]);
  const month = calendarMonth(viewDate),
    outfits = app.outfits(),
    events = effectiveLifeEvents(
      owner,
      app.events(),
      lifeHistoryReadOptions(state, owner),
    ).events,
    selectedVisible = selected.slice(0, 7) === month.prefix;
  const entries = selectedVisible
    ? calendarEntries(owner, selected, events, outfits)
    : [];
  const previous = moveCalendarMonth(viewDate, -1),
    next = moveCalendarMonth(viewDate, 1);
  const pageDates = [
      ...(month.canPrevious ? [previous] : []),
      viewDate,
      ...(month.canNext ? [next] : []),
    ],
    middle = month.canPrevious ? 1 : 0;
  const closeWear = () => {
    wearRef.current = null;
    setWear(null);
    setWearMessage("");
    setWearSaving(false);
  };
  const move = (date: string) => {
    setViewDate(date);
    setEntryIndex(0);
    closeWear();
  };
  // Receipt recovery may outlive a photo revision; its original plan and owner must still match exactly.
  const wearTarget = (date: string, planId: string) => {
    const plan = events.find(
      (event) =>
        event.ownerId === owner &&
        event.kind === "plan" &&
        lifeEventDate(event) === date &&
        event.id === planId,
    );
    const outfit =
      plan &&
      app
        .outfits()
        .find((item) => item.ownerId === owner && item.id === plan.outfitId);
    return plan && outfit
      ? {
          target: {
            ownerId: owner,
            date,
            planId: plan.id,
            outfitId: outfit.id,
          },
          outfit,
        }
      : null;
  };
  const openWear = (planId: string) => {
    const original = wearTarget(selected, planId);
    if (!original) {
      closeWear();
      setWearMessage("선택한 날짜와 프로필의 원래 계획을 확인해 주세요.");
      return;
    }
    const { target, outfit } = original;
    try {
      const unresolved =
        readPendingWear(window.sessionStorage, app.connection.kind, target) ??
        wearRequests(repository).get(wearKey(target));
      if (!unresolved) {
        const prefill = app.actualWearPrefill(selected, planId);
        if (prefill.status !== "ready" || prefill.outfit?.id !== outfit.id) {
          closeWear();
          setWearMessage(prefill.message);
          return;
        }
      }
      const card = describeOutfitCard({
        outfit,
        ownerId: owner,
        garments: app.garments(),
        externalItems: app.externalItems(),
        deviceScoped: app.connection.kind === "supabase",
      });
      const confirmation = {
        ...(unresolved ?? { ...target, intentKey: crypto.randomUUID() }),
        title: card.title,
        recovery: !!unresolved,
      };
      wearRef.current = confirmation;
      setWear(confirmation);
      setWearMessage(
        unresolved
          ? "이전에 확인한 착용 요청의 결과를 같은 요청으로 확인해요."
          : "",
      );
    } catch (error) {
      closeWear();
      setWearMessage(
        error instanceof Error
          ? error.message
          : "이전 착용 확인 요청을 읽지 못했어요.",
      );
    }
  };
  const confirmWear = async () => {
    const captured = wearRef.current,
      requestRepository = app.repository,
      requestScope = app.connection.kind;
    if (!captured || pending.current.has(captured.intentKey)) return;
    const current = () =>
      mounted.current &&
      app.repository === requestRepository &&
      wearRef.current?.intentKey === captured.intentKey &&
      app.getState().activeProfileId === captured.ownerId &&
      (app.ui().calendarDate ?? today) === captured.date;
    if (!current()) return;
    const original = wearTarget(captured.date, captured.planId);
    if (!original || original.target.outfitId !== captured.outfitId) {
      setWearMessage("선택한 날짜와 프로필의 원래 계획을 확인해 주세요.");
      return;
    }
    try {
      const unresolved =
        readPendingWear(window.sessionStorage, requestScope, captured) ??
        wearRequests(requestRepository).get(wearKey(captured));
      if (
        (unresolved && unresolved.intentKey !== captured.intentKey) ||
        (captured.recovery && !unresolved)
      ) {
        setWearMessage(
          "앞서 확인한 원래 착용 요청을 다시 열어 주세요. 새 요청은 보내지 않았어요.",
        );
        return;
      }
      // Only an already confirmed exact intent bypasses prefill. recordWear still validates any request without a receipt.
      if (!unresolved) {
        const prefill = app.actualWearPrefill(captured.date, captured.planId);
        if (
          prefill.status !== "ready" ||
          prefill.outfit?.id !== captured.outfitId
        ) {
          setWearMessage(prefill.message);
          return;
        }
      }
      rememberPendingWear(window.sessionStorage, requestScope, captured);
    } catch (error) {
      setWearMessage(
        error instanceof Error
          ? error.message
          : "착용 확인 요청을 보존하지 못했어요.",
      );
      return;
    }
    pending.current.add(captured.intentKey);
    wearRequests(requestRepository).set(wearKey(captured), captured);
    setWearSaving(true);
    setWearMessage("");
    try {
      const result = await app.recordWear(
        captured.outfitId,
        captured.date,
        captured.intentKey,
      );
      if (
        result.entity.ownerId !== captured.ownerId ||
        result.entity.kind !== "wear" ||
        result.entity.date !== captured.date ||
        result.entity.outfitId !== captured.outfitId
      )
        throw new Error(
          "같은 날짜와 코디의 착용 기록 확인서를 확인하지 못했어요.",
        );
      forgetPendingWear(window.sessionStorage, requestScope, captured);
      const requests = wearRequests(requestRepository);
      if (requests.get(wearKey(captured))?.intentKey === captured.intentKey)
        requests.delete(wearKey(captured));
      if (!current()) return;
      setWearSaving(false);
      wearRef.current = null;
      setWear(null);
      setWearMessage("확인한 실제 착용을 기록했어요.");
    } catch (error) {
      if (current())
        setWearMessage(
          error instanceof Error
            ? error.message
            : "기록 결과를 확인하지 못했어요. 같은 확인으로 다시 조회해 주세요.",
        );
    } finally {
      pending.current.delete(captured.intentKey);
      if (current()) setWearSaving(false);
    }
  };
  return (
    <section
      className="mx-work mx-month-panel"
      aria-label="날짜별 코디 달력"
      data-calendar-month={month.prefix}
    >
      <div className="mx-month-title">
        <button
          type="button"
          aria-label="이전 달"
          disabled={!month.canPrevious}
          onClick={() => move(previous)}
        >
          ‹
        </button>
        <strong>
          {month.year}년 {month.month}월
        </strong>
        <button
          type="button"
          aria-label="다음 달"
          disabled={!month.canNext}
          onClick={() => move(next)}
        >
          ›
        </button>
      </div>
      <HorizontalPager
        key={`${owner}:${month.prefix}`}
        index={middle}
        onIndexChange={(index) => move(pageDates[index])}
        label="달력 월 탐색"
        peek={0}
        gap={10}
        showControls={false}
      >
        {pageDates.map((date) => (
          <div
            className="mx-month-grid"
            role="group"
            aria-label={`${calendarMonth(date).year}년 ${calendarMonth(date).month}월 날짜`}
            key={date.slice(0, 7)}
          >
            {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
              <span className="mx-weekday" key={day}>
                {day}
              </span>
            ))}
            {mirrorCalendarCells(date).map((cell, index) =>
              cell ? (
                <button
                  type="button"
                  key={cell}
                  data-date={cell}
                  data-has-record={
                    events.some((event) => lifeEventDate(event) === cell) ||
                    undefined
                  }
                  aria-label={`${cell}${cell === today ? " 오늘" : ""}${events.some((event) => lifeEventDate(event) === cell) ? " 기록 있음" : ""}`}
                  aria-current={cell === today ? "date" : undefined}
                  aria-pressed={selected === cell}
                  onClick={() => app.setCalendarDate(cell)}
                >
                  {Number(cell.slice(8))}
                  {events.some((event) => lifeEventDate(event) === cell) && (
                    <i aria-hidden="true" />
                  )}
                </button>
              ) : (
                <span className="mx-calendar-blank" key={`empty-${index}`} />
              ),
            )}
          </div>
        ))}
      </HorizontalPager>
      <div className="mx-calendar-selected">
        <strong>
          {selectedVisible
            ? `${Number(selected.slice(5, 7))}월 ${Number(selected.slice(8))}일`
            : "날짜를 선택하세요"}
        </strong>
        <button
          type="button"
          onClick={() => {
            app.setCalendarDate(today);
            move(today);
          }}
        >
          오늘
        </button>
      </div>
      {entries.length > 0 ? (
        <HorizontalPager
          key={`${owner}:${selected}`}
          index={Math.min(entryIndex, entries.length - 1)}
          onIndexChange={(index) => {
            setEntryIndex(index);
            closeWear();
          }}
          label="선택 날짜 기록"
          peek={0}
          gap={8}
          showControls={entries.length > 1}
        >
          {entries.map(({ event, outfit }, index) => {
            const card = outfit
              ? describeOutfitCard({
                  outfit,
                  ownerId: owner,
                  garments: app.garments(),
                  externalItems: app.externalItems(),
                  deviceScoped: app.connection.kind === "supabase",
                })
              : null;
            const linked = outfit
                ? []
                : calendarEventGarments(owner, event, app.garments()),
              linkedNames = linked.map((garment) => garment.name).join(" · "),
              linkedTitle = linked.length
                ? linked[0].name +
                  (linked.length > 1 ? ` 외 ${linked.length - 1}벌` : "")
                : "연결된 항목 확인 필요";
            return (
              <article
                className="mx-day-entry mx-glass"
                key={event.id}
                data-event-id={event.id}
                data-event-kind={event.kind}
              >
                <small>{eventNames[event.kind]}</small>
                {outfit && card ? (
                  <>
                    <strong title={card.title}>{card.title}</strong>
                    {card.description !== card.title && (
                      <small
                        className="mx-card-description"
                        title={card.description}
                      >
                        {card.description}
                      </small>
                    )}
                    <MirrorOutfitThumbnail
                      app={app}
                      outfit={outfit}
                      loadEnabled={Math.abs(index - entryIndex) <= 1}
                    />
                    <button type="button" onClick={() => onReuse(outfit)}>
                      {card.reuseStatus === "needs-review"
                        ? "구성 확인 후 다시 사용"
                        : "이 코디 다시 사용"}
                    </button>
                    {event.kind === "plan" &&
                      (wear?.planId === event.id &&
                      wear.ownerId === owner &&
                      wear.date === selected ? (
                        <div
                          className="mx-wear-confirm"
                          role="group"
                          aria-label="실제 착용 확인"
                        >
                          <p>
                            {wear.recovery
                              ? `${wear.date}에 확인한 원래 착용 요청의 결과를 조회해요.`
                              : `${wear.date}에 이 구성품을 실제로 입었나요?`}
                          </p>
                          <div>
                            <button
                              type="button"
                              disabled={wearSaving}
                              onClick={() => void confirmWear()}
                            >
                              {wearSaving
                                ? "기록 확인 중"
                                : wear.recovery
                                  ? "이전 요청 결과 확인"
                                  : "실제 착용 확인"}
                            </button>
                            <button type="button" onClick={closeWear}>
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openWear(event.id)}
                        >
                          실제 착용 기록
                        </button>
                      ))}
                  </>
                ) : (
                  <>
                    <strong title={linkedNames || undefined}>
                      {linkedTitle}
                    </strong>
                    {linked.length > 1 && (
                      <small
                        className="mx-card-description"
                        title={linkedNames}
                      >
                        {linkedNames}
                      </small>
                    )}
                    <p>{event.value}</p>
                  </>
                )}
              </article>
            );
          })}
        </HorizontalPager>
      ) : (
        <div className="mx-calendar-empty">
          <p>
            {selectedVisible
              ? "이 날짜에는 기록이 없어요."
              : "좌우로 월을 넘겨 날짜를 골라보세요."}
          </p>
          {selectedVisible && (
            <button type="button" onClick={onBrowseOutfits}>
              저장한 코디 보기
            </button>
          )}
        </div>
      )}
      {app.connection.kind === "supabase" && selectedVisible && (
        <ServerWearConfirmation key={`${owner}:${selected}`} date={selected} />
      )}
      {wearMessage && (
        <p className="mx-wear-status" role="status">
          {wearMessage}
        </p>
      )}
    </section>
  );
}
