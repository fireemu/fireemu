// "3 min ago" / "in 2 h" for an instant measured against another (the session's virtual
// clock, not the wall clock). Pure.

const UNITS: readonly [limit: number, size: number, unit: string][] = [
  [60, 1, "s"],
  [3600, 60, "min"],
  [86_400, 3600, "h"],
  [365 * 86_400, 86_400, "d"],
  [Number.POSITIVE_INFINITY, 365 * 86_400, "y"],
];

/** Seconds from `now` to `instant` (negative in the past); `null` if either is not a time. */
export const secondsBetween = (instant: string, now: string): number | null => {
  const a = Date.parse(instant);
  const b = Date.parse(now);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (a - b) / 1000;
};

/**
 * The distance of `instant` from `now` in the largest whole unit, rounded toward zero:
 * `just now` within five seconds either way, then `42s ago`, `3 min ago`, `in 2 h`, `5 d ago`,
 * `2 y ago`. `null` when either argument is not a parsable time.
 */
export const relativeTime = (instant: string, now: string): string | null => {
  const delta = secondsBetween(instant, now);
  if (delta === null) return null;
  const distance = Math.abs(delta);
  if (distance < 5) return "just now";
  const [, size, unit] = UNITS.find(([limit]) => distance < limit)!;
  const amount = Math.floor(distance / size);
  const text = unit === "s" ? `${amount}s` : `${amount} ${unit}`;
  return delta < 0 ? `${text} ago` : `in ${text}`;
};
