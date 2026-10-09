/** Preserve the in-memory person/input registration when switching local setup surfaces. */
export function navigateSurface(path: "/" | "/dev") {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function subscribeSurface(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
export const currentSurface = () => window.location.pathname;
