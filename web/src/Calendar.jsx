import React from "react";
import { monthBounds } from "./calendar.js";
import { Badge, Field, label } from "./ui.jsx";
export function Calendar({
  month,
  onMonth,
  items = [],
  from,
  to,
  onDay,
  onAll,
}) {
  const { leading, to: last } = monthBounds(month);
  const count = Number(last.slice(-2));
  return (
    <section className="panel calendar">
      <div className="calendar-head">
        <Field label="캘린더 월">
          <input
            type="month"
            required
            min="2000-01"
            max="2100-12"
            value={month}
            onChange={(e) => {
              if (e.target.value) onMonth(e.target.value);
            }}
          />
        </Field>
        <button onClick={onAll}>한 달 전체 보기</button>
      </div>
      <div className="calendar-grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <span className="weekday" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={"blank" + i} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = month + "-" + String(i + 1).padStart(2, "0");
          const records = items.filter((x) => x.local_date === date);
          return (
            <button
              key={date}
              aria-label={`${date} 이력 ${records.length}개`}
              aria-pressed={from === date && to === date}
              className={from === date && to === date ? "selected" : ""}
              onClick={() => onDay(date)}
            >
              <span>{i + 1}</span>
              <div className="day-dots">
                {[...new Set(records.map((x) => x.kind))].map((kind) => (
                  <span
                    key={kind}
                    className={kind.toLowerCase()}
                    title={label(kind)}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="wear" />
          실제 착용
        </span>
        <span>
          <i className="care" />
          케어
        </span>
        <span>
          <i className="outfit_selection" />
          코디 선택
        </span>
        <small>날짜를 선택하면 해당 날짜의 이력을 조회합니다.</small>
      </div>
    </section>
  );
}
