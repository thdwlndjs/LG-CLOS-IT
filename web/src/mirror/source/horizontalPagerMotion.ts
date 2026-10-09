export const PAGER_TOKENS = Object.freeze({
  dragThreshold: 8,
  axisRatio: 1.2,
  releaseFraction: 0.22,
  velocityThreshold: 0.5,
  velocityMinimumDistance: 12,
  edgeResistance: 0.18,
  settleMs: 280,
  peek: 0.12,
  gap: 10,
  velocityWindowMs: 100,
  staleVelocityMs: 120,
});
export type PagerAxis = "pending" | "horizontal" | "vertical";
export type PointerSample = { x: number; time: number };
export function clampPagerIndex(index: number, count: number) {
  return count > 0
    ? Math.min(
        count - 1,
        Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0),
      )
    : 0;
}
export function pagerAxis(dx: number, dy: number): PagerAxis {
  const x = Math.abs(dx),
    y = Math.abs(dy);
  if (x > PAGER_TOKENS.dragThreshold && x > y * PAGER_TOKENS.axisRatio)
    return "horizontal";
  if (y > PAGER_TOKENS.dragThreshold && y > x * PAGER_TOKENS.axisRatio)
    return "vertical";
  return "pending";
}
export function pagerDragOffset(
  dx: number,
  index: number,
  count: number,
  cardWidth: number,
) {
  if ((index === 0 && dx > 0) || (index >= count - 1 && dx < 0))
    return (
      Math.sign(dx) *
      Math.min(
        Math.abs(dx) * PAGER_TOKENS.edgeResistance,
        Math.max(0, cardWidth) * PAGER_TOKENS.edgeResistance,
      )
    );
  return dx;
}
export function pagerVelocity(
  samples: readonly PointerSample[],
  releaseTime: number,
) {
  const last = samples.at(-1);
  if (!last || releaseTime - last.time > PAGER_TOKENS.staleVelocityMs) return 0;
  const window = samples.filter(
    (sample) => sample.time >= last.time - PAGER_TOKENS.velocityWindowMs,
  );
  const first = window[0];
  if (!first || last.time <= first.time) return 0;
  return (last.x - first.x) / (last.time - first.time);
}
export function releasedPagerIndex(input: {
  index: number;
  count: number;
  dx: number;
  velocity: number;
  cardWidth: number;
}) {
  const { index, count, dx, velocity, cardWidth } = input;
  if (
    count < 2 ||
    cardWidth <= 0 ||
    !Number.isFinite(dx) ||
    !Number.isFinite(velocity)
  )
    return clampPagerIndex(index, count);
  const enoughDistance =
    Math.abs(dx) >= cardWidth * PAGER_TOKENS.releaseFraction;
  const quickFlick =
    Math.abs(dx) >= PAGER_TOKENS.velocityMinimumDistance &&
    Math.abs(velocity) > PAGER_TOKENS.velocityThreshold;
  if (!enoughDistance && !quickFlick) return clampPagerIndex(index, count);
  // Total displacement owns direction; a reversal must cross the start before selecting the other neighbor.
  return clampPagerIndex(index + (dx < 0 ? 1 : dx > 0 ? -1 : 0), count);
}
