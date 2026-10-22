// Public types for @aws/durable-execution-sdk-js-lite. Keep in sync with src/*.js.

/** The wire error format. Stack traces are not sent. */
export interface ErrorObject {
  ErrorType?: string;
  ErrorMessage?: string;
  ErrorData?: string;
}

/** Every failed durable operation throws this error, on the first run and on replay. */
export class DurableOperationError extends Error {
  constructor(opts?: {
    errorType?: string;
    message?: string;
    data?: string;
    cause?: unknown;
  });
  readonly name: "DurableOperationError";
  /** The original error's name, or a fixed SDK value such as "CallbackTimeoutError". */
  errorType?: string;
  data?: string;
  cause?: unknown;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RetryDecision {
  shouldRetry: boolean;
  /** Whole seconds, at least 1. Defaults to 1. */
  delaySeconds?: number;
}

/** attempt is 1-based: the number of the attempt that just failed. */
export type RetryStrategy = (args: {
  error: unknown;
  attempt: number;
}) => RetryDecision;

export interface RetryStrategyConfig {
  /** Default 6. */
  maxAttempts?: number;
  /** Default 5. */
  initialDelaySeconds?: number;
  /** Default 60. */
  maxDelaySeconds?: number;
  /** Default 2. */
  backoffRate?: number;
  /** Full jitter. Default true. */
  jitter?: boolean;
  /** Default: retry every error. */
  shouldRetry?: (error: unknown) => boolean;
}

export function createRetryStrategy(
  config?: RetryStrategyConfig,
): RetryStrategy;

export type StepSemantics =
  | "AT_LEAST_ONCE_PER_RETRY"
  | "AT_MOST_ONCE_PER_RETRY";

export interface StepOptions<T> {
  name?: string;
  fn: (args: { logger: Logger; attempt: number }) => T | Promise<T>;
  /** Default: createRetryStrategy(). */
  retryStrategy?: RetryStrategy;
  /** Default "AT_LEAST_ONCE_PER_RETRY". */
  semantics?: StepSemantics;
}

export interface DurableContext {
  /** True while this context replays operations that an earlier invocation completed. */
  readonly replaying: boolean;
  /** Writes to console. Silent while replaying. */
  readonly logger: Logger;
  step<T>(opts: StepOptions<T>): Promise<T>;
}

/** A client for the two durable execution APIs. Field names follow the Lambda API. */
export interface DurableExecutionClient {
  checkpoint(request: {
    DurableExecutionArn: string;
    CheckpointToken: string;
    Updates: object[];
    ClientToken?: string;
  }): Promise<{
    CheckpointToken?: string;
    NewExecutionState?: { Operations?: object[]; NextMarker?: string };
  }>;
  getExecutionState(request: {
    DurableExecutionArn: string;
    CheckpointToken: string;
    Marker?: string;
    MaxItems?: number;
  }): Promise<{ Operations?: object[]; NextMarker?: string }>;
}

export type DurableHandler<E = unknown, R = unknown> = (args: {
  event: E;
  ctx: DurableContext;
  lambdaContext: unknown;
}) => R | Promise<R>;

export interface DurableExecutionOutput {
  Status: "SUCCEEDED" | "FAILED" | "PENDING";
  Result?: string;
  Error?: ErrorObject;
}

export function withDurableExecution<E = unknown, R = unknown>(
  handler: DurableHandler<E, R>,
  config?: { client?: DurableExecutionClient },
): (event: unknown, lambdaContext?: unknown) => Promise<DurableExecutionOutput>;
