/** Calendar-only date arithmetic in UTC: no clock, timezone or external service dependency. */
export function calendarMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  const first = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return {
    year,
    month,
    prefix: date.slice(0, 7),
    firstWeekday: first.getUTCDay(),
    days: Math.round((next.getTime() - first.getTime()) / 86400000),
    canPrevious: year > 0 || month > 1,
    canNext: year < 9999 || month < 12,
  };
}

export function moveCalendarMonth(date: string, offset: -1 | 1): string {
  const current = calendarMonth(date);
  if (offset < 0 ? !current.canPrevious : !current.canNext) return date;
  const next = new Date(`${current.prefix}-01T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + offset);
  const first = next.toISOString().slice(0, 10);
  const day = Math.min(Number(date.slice(8)), calendarMonth(first).days);
  return `${first.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}
