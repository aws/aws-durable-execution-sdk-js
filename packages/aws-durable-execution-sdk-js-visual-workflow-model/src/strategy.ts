/**
 * Retry/wait strategy spec stored on `.dar` nodes, modeled on the SDK's strategy
 * builders and shared by the Studio and the CDK generator:
 *   - "exponential" → createRetryStrategy / createWaitStrategy
 *     delay = initialDelay × backoffRate^(attempt-1), capped at maxDelay
 *   - "linear"      → createLinearRetryStrategy
 *     delay = initialDelay + increment × (attempt-1), capped at maxDelay
 *   - "none"        → no retries (maxAttempts = 1)
 *
 * `backoffRate` is used by "exponential"; `incrementSeconds` by "linear".
 * Jitter mirrors the SDK's JitterStrategy enum (NONE | FULL | HALF).
 */
export type StrategyKind = "exponential" | "linear" | "none";
export type JitterKind = "NONE" | "FULL" | "HALF";

export interface RetryStrategySpec {
  kind: StrategyKind;
  /** Max total attempts (including the initial attempt). */
  maxAttempts: number;
  initialDelaySeconds: number;
  maxDelaySeconds: number;
  /** Exponential backoff multiplier (used when kind === "exponential"). */
  backoffRate: number;
  /** Linear per-attempt increment in seconds (used when kind === "linear"). */
  incrementSeconds: number;
  jitter: JitterKind;
}

/** Default step retry — mirrors createRetryStrategy() defaults. */
export function defaultStepRetry(): RetryStrategySpec {
  return {
    kind: "exponential",
    maxAttempts: 3,
    initialDelaySeconds: 5,
    maxDelaySeconds: 300,
    backoffRate: 2,
    incrementSeconds: 1,
    jitter: "FULL",
  };
}

/** Default waitForCondition polling — mirrors createWaitStrategy() defaults. */
export function defaultWaitStrategy(): RetryStrategySpec {
  return {
    kind: "exponential",
    maxAttempts: 60,
    initialDelaySeconds: 5,
    maxDelaySeconds: 300,
    backoffRate: 1.5,
    incrementSeconds: 1,
    jitter: "FULL",
  };
}

/** Merges a (possibly partial/loaded) strategy object over defaults. */
export function normalizeStrategy(
  raw: unknown,
  fallback: RetryStrategySpec,
): RetryStrategySpec {
  if (typeof raw !== "object" || raw === null) return fallback;
  const s = raw as Partial<RetryStrategySpec>;
  const kind: StrategyKind =
    s.kind === "linear" || s.kind === "none" ? s.kind : "exponential";
  const jitter: JitterKind =
    s.jitter === "NONE" || s.jitter === "HALF" ? s.jitter : "FULL";
  // Number.isFinite, not typeof === "number": NaN and Infinity are both numbers and
  // these values are interpolated directly into generated code, so a malformed `.dar`
  // emitted `maxAttempts: NaN`. Requiring finiteness also makes the dataflow into the
  // emitter provably numeric, which is what CodeQL's "code construction depends on an
  // improperly sanitized value" is pointing at — `kind` and `jitter` beside them are
  // already whitelisted, so a string could never reach the template.
  const num = (v: unknown, d: number) =>
    Number.isFinite(v) ? (v as number) : d;
  return {
    kind,
    maxAttempts: num(s.maxAttempts, fallback.maxAttempts),
    initialDelaySeconds: num(
      s.initialDelaySeconds,
      fallback.initialDelaySeconds,
    ),
    maxDelaySeconds: num(s.maxDelaySeconds, fallback.maxDelaySeconds),
    backoffRate: num(s.backoffRate, fallback.backoffRate),
    incrementSeconds: num(s.incrementSeconds, fallback.incrementSeconds),
    jitter,
  };
}
