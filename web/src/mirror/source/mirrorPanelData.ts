import { effectiveLifeEvents, lifeEventDate } from "./lifeHistory";
import { calendarMonth } from "./calendar";
import type { DemoEvent, DemoState, Garment, Outfit } from "./core/types";

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
  return effectiveLifeEvents(ownerId, events)
    .events.sort((a, b) => events.indexOf(a) - events.indexOf(b))
    .filter((event) => lifeEventDate(event) === date)
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
/** Resolve explicit care/movement links only. An invalid link never becomes a partial or inferred outfit. */
export function calendarEventGarments(
  ownerId: string,
  event: DemoEvent,
  garments: readonly Garment[],
): Garment[] {
  if (event.ownerId !== ownerId || !["care", "movement"].includes(event.kind))
    return [];
  const references =
    event.garmentIds === undefined
      ? event.garmentId
        ? [event.garmentId]
        : []
      : event.garmentIds;
  if (
    !Array.isArray(references) ||
    references.some((id) => typeof id !== "string" || !id) ||
    (event.garmentId &&
      event.garmentIds !== undefined &&
      !references.includes(event.garmentId))
  )
    return [];
  const result: Garment[] = [];
  for (const id of new Set(references)) {
    const matches = garments.filter((garment) => garment.id === id);
    if (matches.length !== 1 || matches[0].ownerId !== ownerId) return [];
    result.push(matches[0]);
  }
  return result;
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
