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
 * The only execution statuses a WorkflowInsight record can carry (see core's
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
