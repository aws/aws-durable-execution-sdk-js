import { DurableContext } from "../../types/durable-context";
import { RetryDecision } from "../../types";
import { ChildConfig } from "../../types/child-context";

/**
 * Configuration for {@link withRetry}.
 *
 * @typeParam T - The resolved value type of a successful attempt. Used to
 * type {@link WithRetryConfig.childContextConfig}. Inferred automatically
 * from the function passed to {@link withRetry}; callers rarely need to
 * specify it explicitly.
 *
 * @public
 */
export interface WithRetryConfig<T> {
  /**
   * Strategy for retrying failed attempts. Uses the same signature as
   * {@link StepConfig.retryStrategy}, so values produced by
   * {@link createRetryStrategy} or entries of {@link retryPresets} can be
   * passed directly.
   *
   * @param error - The error thrown by the most recent attempt.
   * @param attemptCount - The 1-based attempt number that just failed.
   * @returns A {@link RetryDecision} describing whether to retry and the
   * backoff delay to use before the next attempt.
   *
   * @example
   * ```typescript
   * retryStrategy: (error, attempt) => ({
   *   shouldRetry: attempt < 3,
   *   delay: { seconds: 2 ** attempt },
   * })
   * ```
   */
  retryStrategy: (error: Error, attemptCount: number) => RetryDecision;

  /**
   * Wrap the retry loop (attempts + backoff waits) in `runInChildContext`
   * so attempts are grouped under a single operation in the execution
   * history. When a `name` is provided it's used as the child context's
   * name; otherwise the child context is anonymous.
   *
   * @remarks
   * Changing this flag changes the shape of thrown errors:
   * - When `true` (default), a final failure is rethrown as a
   *   {@link ChildContextError} that wraps the original error on its `cause`
   *   property (standard `runInChildContext` behavior).
   * - When `false`, the original error from the final failed attempt is
   *   rethrown unchanged.
   *
   * Code that uses `instanceof` to branch on error type should account for
   * this, or always inspect `error.cause`.
   *
   * @defaultValue true
   */
  wrapWithRunInChildContext?: boolean;

  /**
   * Optional {@link ChildConfig} forwarded to the wrapping
   * `context.runInChildContext` call (e.g. `serdes`, `subType`,
   * `errorMapper`, `virtualContext`).
   *
   * @remarks
   * Ignored when {@link WithRetryConfig.wrapWithRunInChildContext} is
   * `false`.
   *
   * If `errorMapper` is provided it runs on errors produced by the child
   * context (i.e. after retries are exhausted), not on per-attempt errors
   * handed to {@link WithRetryConfig.retryStrategy}.
   */
  childContextConfig?: ChildConfig<T>;
}

/**
 * A function executed by {@link withRetry} on each attempt.
 *
 * @remarks
 * The body can contain any chunk of durable-execution logic — multiple
 * steps, waits, callbacks, invokes, etc. — not just a single durable
 * operation.
 *
 * @typeParam T - The resolved value type of a successful attempt.
 * @param context - The {@link DurableContext} to use for durable operations.
 * When {@link WithRetryConfig.wrapWithRunInChildContext} is enabled this is
 * the child context.
 * @param attempt - The 1-based attempt number. Provided as metadata; useful
 * for logging or for incorporating into operation names to improve execution
 * history readability. Not required for correctness — the SDK disambiguates
 * operations by call-site position.
 * @returns A promise for the successful result. If it rejects, the error is
 * passed to {@link WithRetryConfig.retryStrategy} to decide whether to
 * retry.
 *
 * @public
 */
export type RetryableFunc<T> = (
  context: DurableContext,
  attempt: number,
) => Promise<T>;

/**
 * Runs a chunk of durable-execution logic with retries. Semantically a
 * `runInChildContext` with a retry policy wrapped around it — on failure the
 * whole function body is re-run from the beginning with configurable
 * backoff, using the same `retryStrategy` shape as {@link StepConfig}.
 *
 * @remarks
 * Unlike `context.step()`, durable operations such as `waitForCallback` and
 * `invoke` cannot be nested inside a step. `withRetry` runs the function at
 * the top level and uses `context.wait` between attempts for backoff. By
 * default the whole loop is wrapped in `context.runInChildContext` for
 * isolation (opt out with `wrapWithRunInChildContext: false`); the child
 * context is named when `name` is provided and anonymous otherwise.
 *
 * The function body can contain multiple durable operations — this is
 * effectively "retry this block of logic," not "retry one operation."
 *
 * Because the SDK identifies durable operations by call-site position,
 * unique per-attempt names are not required for correctness. Callers may
 * still incorporate `attempt` into operation names (e.g.
 * "`my-callback-${attempt}`") to make execution history easier to read.
 * Backoff waits are named automatically as `${name}-backoff-${attempt}`
 * when `name` is provided; otherwise they are anonymous.
 *
 * @typeParam T - The resolved value type of a successful attempt.
 * @param context - The parent {@link DurableContext}.
 * @param name - Optional name used for the enclosing child context and
 * backoff wait operations. Omit to run the retry loop directly in `context`.
 * @param func - The function to execute on each attempt.
 * @param config - Retry configuration.
 * @returns The result of the first successful attempt.
 * @throws \{ChildContextError\} When `wrapWithRunInChildContext` is `true`
 * (default) and retries are exhausted or `retryStrategy` returns
 * `shouldRetry: false`. The original error from the final failed attempt is
 * available on the `cause` property.
 * @throws When `wrapWithRunInChildContext` is `false`, the original error
 * from the final failed attempt is rethrown unchanged.
 *
 * @example Named (wrapped in a child context by default)
 * ```typescript
 * import {
 *   withRetry,
 *   createRetryStrategy,
 * } from "@aws/durable-execution-sdk-js";
 *
 * const decision = await withRetry(
 *   context,
 *   "approval",
 *   (ctx, attempt) =>
 *     ctx.waitForCallback(`approval-${attempt}`, submitter, {
 *       timeout: { hours: 24 },
 *     }),
 *   {
 *     retryStrategy: createRetryStrategy({
 *       maxAttempts: 3,
 *       initialDelay: { seconds: 2 },
 *       backoffRate: 2,
 *     }),
 *   },
 * );
 * ```
 *
 * @example Anonymous (no child-context name)
 * ```typescript
 * const result = await withRetry(
 *   context,
 *   (ctx, attempt) =>
 *     ctx.invoke(`charge-${attempt}`, paymentFnArn, { orderId }),
 *   {
 *     retryStrategy: (_err, attempt) => ({
 *       shouldRetry: attempt < 3,
 *       delay: { seconds: 1 },
 *     }),
 *   },
 * );
 * ```
 *
 * @see {@link createRetryStrategy}
 * @see {@link retryPresets}
 * @see {@link StepConfig}
 *
 * @public
 */
export function withRetry<T>(
  context: DurableContext,
  name: string,
  func: RetryableFunc<T>,
  config: WithRetryConfig<T>,
): Promise<T>;
/**
 * Anonymous overload of {@link withRetry}.
 *
 * @remarks
 * Same behavior as the named overload, but the enclosing
 * `runInChildContext` (when `wrapWithRunInChildContext` is enabled) and the
 * backoff waits are anonymous.
 *
 * @public
 */
export function withRetry<T>(
  context: DurableContext,
  func: RetryableFunc<T>,
  config: WithRetryConfig<T>,
): Promise<T>;
export async function withRetry<T>(
  context: DurableContext,
  nameOrFunc: string | RetryableFunc<T>,
  funcOrConfig: RetryableFunc<T> | WithRetryConfig<T>,
  maybeConfig?: WithRetryConfig<T>,
): Promise<T> {
  const hasName = typeof nameOrFunc === "string";
  const name = hasName ? nameOrFunc : undefined;
  const func = (hasName ? funcOrConfig : nameOrFunc) as RetryableFunc<T>;
  const config = (hasName ? maybeConfig : funcOrConfig) as
    | WithRetryConfig<T>
    | undefined;

  if (!config) {
    throw new TypeError("withRetry: config is required");
  }
  const {
    retryStrategy,
    wrapWithRunInChildContext = true,
    childContextConfig,
  } = config;

  const runLoop = async (ctx: DurableContext): Promise<T> => {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        return await func(ctx, attempt);
      } catch (err) {
        const decision = retryStrategy(err as Error, attempt);
        if (!decision.shouldRetry) throw err;
        const delay = decision.delay ?? { seconds: 1 };
        if (name) {
          await ctx.wait(`${name}-backoff-${attempt}`, delay);
        } else {
          await ctx.wait(delay);
        }
      }
    }
  };

  return wrapWithRunInChildContext
    ? name
      ? await context.runInChildContext(name, runLoop, childContextConfig)
      : await context.runInChildContext(runLoop, childContextConfig)
    : await runLoop(context);
}
