/**
 * SQL value sanitization for the structured tools (`get_execution`,
 * `list_executions`).
 *
 * WHY THIS FILE EXISTS — read before touching a value that reaches SQL:
 *   Every parameter these tools accept is AGENT-supplied text that ends up
 *   interpolated into a query string. Athena's `StartQueryExecutionCommand`
 *   takes a single query string with NO parameter binding, so there is no
 *   `?`-placeholder to lean on — the only mitigations are (a) validating a value
 *   against the shape it is allowed to have and rejecting anything else, and
 *   (b) escaping what remains the exact way core does (doubling single quotes).
 *
 *   `assertReadOnly` (invoked inside `runReadOnlyQuery`) is the BACKSTOP, not
 *   the sanitizer: it rejects a write keyword or an injected second statement,
 *   but an injected `' OR '1'='1` is still a perfectly valid single SELECT and
 *   it will happily allow it. Preventing a tautology from ever being built is
 *   THIS module's job, applied before the SQL string is assembled.
 *
 *   This module imports no runner and executes nothing — it only transforms and
 *   validates strings, so it stays outside the query choke point by design.
 */

/**
 * The only execution statuses a DurableExecutionTelemetry record can carry (see core's
 * schema.ts record schemas). `status` is validated against this exact set and a
 * value outside it is REJECTED — preferred over escaping, because a status is a
 * closed enumeration and anything else is either a mistake or an attack.
 */
export const KNOWN_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED"] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

/**
 * Escape a string for safe interpolation into a single-quoted SQL/PartiQL
 * literal, the SAME way core does it (`fetchAthenaRecord`,
 * `fetchDynamoDBRecord`): double every single quote. A closing quote inside the
 * value therefore cannot terminate the literal, so the value can never break
 * out into surrounding SQL — it stays one literal, and any `OR`/`;`/`--` inside
 * it is just literal text.
 *
 * BACKSLASHES ARE REJECTED, NOT ESCAPED, and that asymmetry is deliberate.
 *
 * Quote-doubling alone is not sufficient on every engine here. Redshift's own
 * `QUOTE_LITERAL` "appropriately doubles any embedded single quotation marks AND
 * BACKSLASHES", which only makes sense because backslash is an escape character in
 * its string literals (Redshift derives from PostgreSQL 8.0.2, before
 * `standard_conforming_strings` defaulted on). So a value ending in a single
 * backslash yields `'foo\'`, where the doubled quote is itself escaped and the
 * literal continues — the same trailing-backslash breakout that made the log path
 * need core's `escapeQuotedString`.
 *
 * Escaping backslashes instead would be WRONG for the other engines: in
 * Athena/Trino a backslash is an ordinary character, so doubling it would turn a
 * search for `foo\` into a search for `foo\\` and quietly return nothing. There is
 * no single escaping that is correct everywhere.
 *
 * Rejection avoids the choice entirely and is lossless in practice: the only values
 * that reach this function are execution ARNs and Lambda function names, and neither
 * can legally contain a backslash. Anything that does is malformed input, not a
 * search term someone lost.
 */
export function escapeSqlString(value: string): string {
  if (value.includes("\\")) {
    throw new Error(
      `Value contains a backslash, which is not permitted: ${JSON.stringify(value)}. ` +
        `Backslash is an escape character in some SQL dialects (Redshift) and a ` +
        `literal character in others (Athena), so no single escaping is correct for ` +
        `all destinations. Execution ARNs and Lambda function names cannot contain ` +
        `one.`,
    );
  }
  return value.replace(/'/g, "''");
}

/**
 * Validate an execution `status`. Returns the value unchanged if it is one of
 * {@link KNOWN_STATUSES}; throws otherwise. Rejection (not escaping) is the
 * right mitigation for a closed enumeration.
 */
export function validateStatus(status: string): KnownStatus {
  if ((KNOWN_STATUSES as readonly string[]).includes(status)) {
    return status as KnownStatus;
  }
  throw new Error(
    `Invalid status "${status}". Must be one of: ${KNOWN_STATUSES.join(", ")}.`,
  );
}

/**
 * ISO-8601 date or date-time, quote-free by construction. Accepts:
 *   2024-01-31
 *   2024-01-31T12:34
 *   2024-01-31T12:34:56
 *   2024-01-31T12:34:56.789Z
 *   2024-01-31 12:34:56+00:00
 * There is deliberately no way for a `'`, `;`, or whitespace-then-keyword to
 * appear in a value that matches this, so a matching value is safe to
 * interpolate; a non-matching value is REJECTED rather than escaped.
 */
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Validate a `since`/`until` bound as an ISO-8601 date or date-time. Returns the
 * value unchanged if it matches {@link ISO_TIMESTAMP}; throws otherwise. The
 * matched shape cannot contain a quote, so it is injection-safe by validation.
 */
export function validateTimestamp(label: string, value: string): string {
  if (ISO_TIMESTAMP.test(value)) {
    return value;
  }
  throw new Error(
    `Invalid ${label} "${value}". Expected an ISO-8601 date or date-time, ` +
      `e.g. 2024-01-31 or 2024-01-31T12:34:56Z.`,
  );
}

/**
 * Validate a `since`/`until` bound, then rewrite it in the one format every SDK
 * writes record timestamps in: UTC, exactly 3 fraction digits, a literal `Z`
 * (`2024-01-31T12:34:56.000Z`, the output of `Date.prototype.toISOString()`).
 *
 * The rewrite is needed because some destinations compare these values as text
 * (DynamoDB, CloudWatch Logs Insights). Text order equals time order only when
 * both sides have the same width and the same zone. So a bound such as
 * `2024-01-31T12:34:56Z` or `2024-01-31T05:34:56-07:00` is rewritten to the
 * stored form before it is compared.
 *
 * A bound with no offset is read as UTC, because every record timestamp is UTC.
 * A date alone means midnight UTC. Throws when the value does not match
 * {@link ISO_TIMESTAMP} or does not name a real instant (for example month 13).
 * The output contains only digits, `-`, `:`, `.`, `T` and `Z`, so it is safe to
 * interpolate.
 */
export function normalizeTimestamp(label: string, value: string): string {
  const validated = validateTimestamp(label, value);
  let iso = validated.replace(" ", "T");
  const hasTime = iso.includes("T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
  if (hasTime && !hasZone) iso += "Z";
  // `+0700` is valid ISO-8601 but Date.parse rejects it; insert the colon.
  iso = iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(
      `Invalid ${label} "${value}". It matches the ISO-8601 shape but is not ` +
        `a real date or time.`,
    );
  }
  return new Date(ms).toISOString();
}

/**
 * An Athena Hive partition component (`year`/`month`/`day`). These are digit
 * strings by definition (the Glue table projects them as `integer`), so a
 * value that is not all digits is REJECTED — this both prunes correctly and
 * makes the value injection-safe (no quote can appear in `\d+`).
 */
export function validatePartitionComponent(
  label: string,
  value: string,
): string {
  if (/^\d{1,4}$/.test(value)) {
    return value;
  }
  throw new Error(
    `Invalid ${label} "${value}". Expected a numeric partition value (digits only).`,
  );
}

/**
 * Coerce an agent-supplied `limit` to a bounded positive integer in
 * `[1, max]`, falling back to `fallback` for an absent or non-finite value.
 * Never returns a value above `max` — the hard row cap cannot be raised through
 * this parameter.
 */
export function coerceLimit(
  raw: number | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    return Math.min(fallback, max);
  }
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > max) return max;
  return floored;
}
