/**
 * Derives a fresh durable-execution name from a previous one, for the "Start new
 * execution" pre-fill:
 *  - a UUID  -> a brand-new UUID
 *  - a trailing number ("order-12345", "run5") -> that number incremented
 *    (preserving zero-padding width)
 *  - anything else -> the name with a "-1" suffix
 * Empty/blank falls back to a new UUID.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultUuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
  );
}

export function nextExecutionName(
  current: string | null | undefined,
  genUuid: () => string = defaultUuid,
): string {
  const name = (current ?? "").trim();
  if (!name || UUID_RE.test(name)) return genUuid();
  const m = name.match(/^(.*?)(\d+)$/);
  if (m) {
    const [, prefix, digits] = m;
    const next = String(Number(digits) + 1);
    return prefix + next.padStart(digits.length, "0");
  }
  return `${name}-1`;
}
