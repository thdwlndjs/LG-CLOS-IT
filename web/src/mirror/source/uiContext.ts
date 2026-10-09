// Local navigation context only; never stores credentials, image bytes, or server results.
import type { Category } from "./core/types";
import { isISODate } from "./core/repository";
type NavigationContext = {
  screen: string;
  detail: string | null;
  subview: "list" | "map";
  scroll: Record<string, number>;
  savedOpen: boolean;
  styleHelpOpen: boolean;
  conditionsOpen: boolean;
  query?: string;
  category?: Category | "all";
  selectedGarmentId?: string | null;
  selectedOutfitId?: string | null;
  calendarDate?: string;
};
const key = (owner: string) => `smartcloset.navigation.v1:${owner}`;
export function readNavigation(owner: string): NavigationContext {
  const empty: NavigationContext = {
    screen: "home",
    detail: null,
    subview: "list",
    scroll: {},
    savedOpen: false,
    styleHelpOpen: false,
    conditionsOpen: false,
  };
  try {
    const v = JSON.parse(sessionStorage.getItem(key(owner)) || "null");
    if (!v || typeof v !== "object") return empty;
    return {
      screen: typeof v.screen === "string" ? v.screen : "home",
      detail: typeof v.detail === "string" ? v.detail : null,
      subview: v.subview === "map" ? "map" : "list",
      scroll: Object.fromEntries(
        Object.entries(v.scroll || {}).filter(
          ([, n]) => typeof n === "number" && Number.isFinite(n) && n >= 0,
        ),
      ) as Record<string, number>,
      savedOpen: v.savedOpen === true,
      styleHelpOpen: v.styleHelpOpen === true,
      conditionsOpen: v.conditionsOpen === true,
      ...(typeof v.query === "string" && v.query.length <= 200
        ? { query: v.query }
        : {}),
      ...([
        "all",
        "top",
        "bottom",
        "outer",
        "bag",
        "shoes",
        "hat",
        "accessory",
      ].includes(v.category)
        ? { category: v.category }
        : {}),
      ...(typeof v.selectedGarmentId === "string" ||
      v.selectedGarmentId === null
        ? { selectedGarmentId: v.selectedGarmentId }
        : {}),
      ...(typeof v.selectedOutfitId === "string" || v.selectedOutfitId === null
        ? { selectedOutfitId: v.selectedOutfitId }
        : {}),
      ...(typeof v.calendarDate === "string" && isISODate(v.calendarDate)
        ? { calendarDate: v.calendarDate }
        : {}),
    };
  } catch {
    return empty;
  }
}
export function writeNavigation(owner: string, value: NavigationContext) {
  try {
    sessionStorage.setItem(key(owner), JSON.stringify(value));
  } catch {
    /* Browsers may disallow session persistence. The active view remains usable. */
  }
}
