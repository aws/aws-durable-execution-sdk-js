/**
 * How far a {@link DurableExecutionClient} failure reaches.
 *
 * The SDK already distinguishes these two outcomes internally; this is the vocabulary a
 * transport uses to select between them.
 *
 * @public
 */
export const DurableExecutionClientErrorScope = {
  /**
   * The current invocation cannot continue, but the execution can resume in a new one.
   * Appropriate for transient conditions: timeouts, throttling, connection failures, or a
   * backend returning a server-side error.
   */
  INVOCATION: "INVOCATION",

  /**
   * The execution cannot proceed at all and must fail. Appropriate for conditions that
   * retrying cannot resolve: a rejected request, missing permissions, an unknown or
   * finished execution, or misconfiguration.
   */
  EXECUTION: "EXECUTION",
} as const;

/**
 * How far a {@link DurableExecutionClient} failure reaches.
 *
 * @public
 */
export type DurableExecutionClientErrorScope =
  (typeof DurableExecutionClientErrorScope)[keyof typeof DurableExecutionClientErrorScope];

/**
 * Options for {@link DurableExecutionClientError}.
 *
 * @public
 */
export interface DurableExecutionClientErrorOptions {
  /**
   * How far the failure reaches. Defaults to
   * {@link DurableExecutionClientErrorScope.INVOCATION}, because assuming a failure is
   * transient is the safe default: the execution gets another attempt rather than being
   * failed on the strength of an error the SDK does not understand.
   */
  scope?: DurableExecutionClientErrorScope;

  /** The underlying error, preserved for diagnostics. */
  cause?: unknown;
}

/**
 * Error a {@link DurableExecutionClient} throws to tell the SDK how to treat a failure.
 *
 * The SDK has to decide, for every failed client call, whether to end the invocation and
 * let the execution resume later or to fail the execution outright. For the Lambda
 * transport it infers this from the AWS SDK's error shape — HTTP status codes and
 * exception names. A transport that does not produce AWS-shaped errors has no way to
 * express the distinction, and would be treated as transient in every case, so a permanent
 * failure would be retried until the execution timed out.
 *
 * Throwing this error states the classification directly, so any transport can express it
 * without imitating another one's error shape.
 *
 * @example
 * ```typescript
 * class HttpDurableExecutionClient implements DurableExecutionClient {
 *   async checkpoint(params: CheckpointDurableExecutionRequest) {
 *     const response = await fetch(this.endpoint, { ... });
 *
 *     if (!response.ok) {
 *       throw new DurableExecutionClientError(
 *         `Checkpoint rejected: ${response.status}`,
 *         {
 *           // 4xx will not succeed on retry; 5xx might.
 *           scope:
 *             response.status < 500
 *               ? DurableExecutionClientErrorScope.EXECUTION
 *               : DurableExecutionClientErrorScope.INVOCATION,
 *         },
 *       );
 *     }
 *
 *     return response.json();
 *   }
 * }
 * ```
 *
 * @public
 */
export class DurableExecutionClientError extends Error {
  /**
   * Structural marker used by {@link isDurableExecutionClientError}.
   *
   * The SDK identifies this error by property rather than by `instanceof`, so that it is
   * still recognized when the transport and the SDK are bundled separately and therefore
   * hold different copies of this class.
   */
  readonly isDurableExecutionClientError = true;

  /** How far the failure reaches. */
  readonly scope: DurableExecutionClientErrorScope;

  constructor(message: string, options?: DurableExecutionClientErrorOptions) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "DurableExecutionClientError";
    this.scope = options?.scope ?? DurableExecutionClientErrorScope.INVOCATION;
  }
}

/**
 * Returns true when an error carries a {@link DurableExecutionClientError} classification.
 *
 * Matches structurally rather than by `instanceof`, so a transport bundled separately from
 * the SDK is still recognized. An error claiming the marker but carrying an unrecognized
 * scope is not matched, so a malformed value falls through to the SDK's normal handling
 * rather than being acted on.
 *
 * @param error - The thrown value to inspect.
 *
 * @public
 */
export function isDurableExecutionClientError(
  error: unknown,
): error is DurableExecutionClientError {
  if (
    !(error instanceof Error) ||
    !("isDurableExecutionClientError" in error)
  ) {
    return false;
  }

  const candidate = error as {
    isDurableExecutionClientError?: unknown;
    scope?: unknown;
  };

  return (
    candidate.isDurableExecutionClientError === true &&
    (candidate.scope === DurableExecutionClientErrorScope.INVOCATION ||
      candidate.scope === DurableExecutionClientErrorScope.EXECUTION)
  );
}
