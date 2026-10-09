import { useEffect, useState, useSyncExternalStore } from "react";
import type { DemoApp } from "./core/app";
import type { Outfit } from "./core/types";
import { calendarMonth, moveCalendarMonth } from "./calendar";
import { calendarEntries, mirrorCalendarCells } from "./mirrorPanelData";
import { HorizontalPager } from "./HorizontalPager";
import { MirrorOutfitThumbnail } from "./MirrorPanelThumbnail";
import "./mirror-panels.css";

const eventNames = {
  plan: "선택·계획",
  wear: "실제 착용",
  care: "관리",
  movement: "이동",
} as const;
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
  const [viewDate, setViewDate] = useState(selected),
    [entryIndex, setEntryIndex] = useState(0);
  useEffect(() => {
    setViewDate(selected);
    setEntryIndex(0);
  }, [owner, selected]);
  const month = calendarMonth(viewDate),
    outfits = app.outfits(),
    events = app.events(),
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
  const move = (date: string) => {
    setViewDate(date);
    setEntryIndex(0);
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
                    events.some((event) => event.date === cell) || undefined
                  }
                  aria-label={`${cell}${cell === today ? " 오늘" : ""}${events.some((event) => event.date === cell) ? " 기록 있음" : ""}`}
                  aria-current={cell === today ? "date" : undefined}
                  aria-pressed={selected === cell}
                  onClick={() => app.setCalendarDate(cell)}
                >
                  {Number(cell.slice(8))}
                  {events.some((event) => event.date === cell) && (
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
          onIndexChange={setEntryIndex}
          label="선택 날짜 기록"
          peek={0}
          gap={8}
          showControls={entries.length > 1}
        >
          {entries.map(({ event, outfit }) => (
            <article
              className="mx-day-entry mx-glass"
              key={event.id}
              data-event-id={event.id}
              data-event-kind={event.kind}
            >
              <small>{eventNames[event.kind]}</small>
              {outfit ? (
                <>
                  <strong>{outfit.name}</strong>
                  <MirrorOutfitThumbnail app={app} outfit={outfit} />
                  <button type="button" onClick={() => onReuse(outfit)}>
                    이 코디 다시 사용
                  </button>
                </>
              ) : (
                <>
                  <strong>
                    {app
                      .garments()
                      .find((garment) => garment.id === event.garmentId)
                      ?.name ?? "연결된 항목 확인 필요"}
                  </strong>
                  <p>{event.value}</p>
                </>
              )}
            </article>
          ))}
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
    </section>
  );
}
