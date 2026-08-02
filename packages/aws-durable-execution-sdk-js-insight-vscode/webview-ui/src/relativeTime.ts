/**
 * Human-friendly "time ago" formatting for the DateView component. Shows the
 * two largest non-zero units (e.g. "8 hours, 23 seconds ago"), so a value with
 * zero minutes still surfaces the seconds. Handles past and future instants.
 */

const UNITS: { label: string; short: string; seconds: number }[] = [
  { label: "year", short: "y", seconds: 31_536_000 },
  { label: "day", short: "d", seconds: 86_400 },
  { label: "hour", short: "h", seconds: 3_600 },
  { label: "minute", short: "m", seconds: 60 },
  { label: "second", short: "s", seconds: 1 },
];

const plural = (n: number, unit: string): string =>
  `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * Returns a relative description of `date` versus `now` (default: current time),
 * e.g. "8 hours, 23 seconds ago" or "in 3 days, 2 hours". `short` gives a
 * compact form ("8h 23s ago"). Sub-second diffs return "just now".
 */
export function relativeTime(
  date: number | Date,
  now: number = Date.now(),
  short = false,
): string {
  const t = date instanceof Date ? date.getTime() : date;
  const diffMs = now - t;
  const future = diffMs < 0;
  let remaining = Math.floor(Math.abs(diffMs) / 1000);
  if (remaining < 1) return "just now";

  const parts: string[] = [];
  for (const u of UNITS) {
    if (parts.length === 2) break;
    const value = Math.floor(remaining / u.seconds);
    if (value > 0) {
      parts.push(short ? `${value}${u.short}` : plural(value, u.label));
      remaining -= value * u.seconds;
    }
  }
  const joined = parts.join(short ? " " : ", ");
  return future ? `in ${joined}` : `${joined} ago`;
}
