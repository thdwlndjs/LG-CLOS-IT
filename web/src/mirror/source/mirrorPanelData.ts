import { calendarMonth } from "./calendar";
import type { DemoEvent, DemoState, Outfit } from "./core/types";

/** Uses ISO calendar dates, never the viewer's machine timezone or an outfit creation time. */
export function mirrorCalendarCells(date: string): (string | null)[] {
  const month = calendarMonth(date),
    count = Math.ceil((month.firstWeekday + month.days) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const day = index - month.firstWeekday + 1;
    return day < 1 || day > month.days
      ? null
      : `${month.prefix}-${String(day).padStart(2, "0")}`;
  });
}
export function calendarEntries(
  ownerId: string,
  date: string,
  events: readonly DemoEvent[],
  outfits: readonly Outfit[],
) {
  return events
    .filter((event) => event.ownerId === ownerId && event.date === date)
    .map((event) => ({
      event,
      outfit: ["plan", "wear"].includes(event.kind)
        ? outfits.find(
            (outfit) =>
              outfit.ownerId === ownerId && outfit.id === event.outfitId,
          )
        : undefined,
    }));
}
/** Current backend has no delegated family-profile contract. Never expand its session owner. */
export function permittedMirrorProfiles(
  state: Pick<DemoState, "profiles" | "activeProfileId">,
  connection: "local" | "supabase",
) {
  return state.profiles.filter(
    (profile) => connection === "local" || profile.id === state.activeProfileId,
  );
}
export interface MirrorWeatherContext {
  profileId: string;
  date: string;
  summary: string;
  source: string;
}
export function mirrorHomeWeather(
  context: MirrorWeatherContext | undefined,
  owner: string,
  date: string,
) {
  return context?.profileId === owner &&
    context.date === date &&
    context.summary.trim() &&
    context.source.trim()
    ? context
    : null;
}
