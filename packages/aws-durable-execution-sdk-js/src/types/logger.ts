import type { DurableContextLogger, DurableLogger } from "./durable-logger";

/**
 * Log data passed to the durable logger when `getDurableLogData` is called.
 * @public
 */
export interface DurableLogData {
  requestId: string;
  executionArn: string;
  tenantId?: string | undefined;
  operationId?: string | undefined;
  operationName?: string | undefined;
  attempt?: number | undefined;
  // We aren't attaching any additional properties, but this is
  // added for type-compatibility with popular loggers like powertools
  [key: string]: unknown;
}

/**
 * Log level supported by the durable logger
 * @public
 */
export enum DurableLogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

/**
 * Configuration options for logger behavior
 * @public
 */
export interface LoggerConfig<Logger extends DurableLogger> {
  /**
   * Custom logger implementation to use instead of the default console logger
   * @defaultValue Default console logger
   */
  customLogger?: Logger;

  /**
   * Whether to enable mode-aware logging (suppress logs during replay)
   * @defaultValue true
   */
  modeAware?: boolean;
}

/**
 * Base interface for operation contexts.
 * Do not use directly - use specific context types like StepContext, WaitForConditionContext, etc.
 * @public
 */
export interface OperationContext<
  Logger extends DurableContextLogger<DurableLogger>,
> {
  logger: Logger; // Basic durable logger which will be parsed by the enriched durable logger
}

/**
 * Context for step operations.
 * @public
 */
export interface StepContext<Logger extends DurableLogger>
  extends OperationContext<DurableContextLogger<Logger>> {
  /**
   * The current attempt number for this step, starting at `1` for the first
   * execution and incrementing by `1` on each subsequent retry.
   *
   * Use this to implement attempt-aware logic, for example selecting a
   * fallback path once earlier attempts have failed.
   */
  attempt: number;

  /**
   * Aborted when the invocation ends, or when a non-virtual context
   * that holds this step finishes.
   *
   * The SDK aborts this signal in two cases only:
   *
   * 1. The invocation ends, whether the handler returns or throws, or the SDK
   *    terminates it to suspend for a wait, handle a checkpoint error, or
   *    enforce its deadline. Steps the handler did not await can then stop.
   * 2. A non-virtual context that holds this step finishes. For example, a
   *    `map` or `parallel` call returns early because its `completionConfig`
   *    is met, while some items still run.
   *
   * All steps in one context share this signal. So the signal also aborts
   * for a step that already returned, when its context finishes later. The
   * result of that step is still recorded.
   *
   * A virtual context does not abort this signal when it finishes. A `map` or
   * `parallel` item with `NestingType.FLAT` runs in a virtual context. So its
   * steps share the signal of the batch's context, and that signal aborts
   * when the batch's context finishes.
   *
   * When the signal aborts while the step still runs, the SDK drops the
   * result of the step. But the step function keeps running until it
   * returns. So pass this signal to `fetch`, to AWS SDK calls
   * (`client.send(command, { abortSignal })`) and to your own loops to stop
   * work that nobody uses.
   *
   * The SDK never aborts a step by force. A step that ignores the signal
   * behaves as before.
   *
   * @example
   * ```ts
   * await context.step("fetch-quote", async (ctx) => {
   *   const res = await fetch(url, { signal: ctx.signal });
   *   return res.json();
   * });
   * ```
   */
  signal: AbortSignal;
}

/**
 * Context for waitForCondition operations.
 * @public
 */
export interface WaitForConditionContext<Logger extends DurableLogger>
  extends OperationContext<DurableContextLogger<Logger>> {
  /**
   * The current attempt number for this waitForCondition check, starting at
   * `1` for the first execution and incrementing by `1` on each subsequent
   * retry (i.e. each time `waitStrategy` decides to continue waiting).
   *
   * Use this to implement attempt-aware logic in the check function, for
   * example escalating checks or switching data sources on later attempts.
   */
  attempt: number;
}

/**
 * Context for step operations.
 * @public
 */
export type WaitForCallbackContext<Logger extends DurableLogger> =
  OperationContext<DurableContextLogger<Logger>>;
