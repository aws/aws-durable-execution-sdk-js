/**
 * The base class of the errors that the `decider` and `llm` operations throw.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class AiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiError";
  }
}

/**
 * The decision model could not be reached, or answered with an HTTP error.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class DeciderError extends AiError {
  /** The HTTP status, when the decision model answered. */
  readonly status: number | undefined;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options);
    this.name = "DeciderError";
    this.status = options?.status;
  }
}

/**
 * The decision model answered, but the answer is not usable: it has the wrong
 * shape, or it names an option that the caller did not offer. This usually
 * means that the server speaks another version of the `/v1/systemone` API.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class DeciderInvalidResponseError extends AiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeciderInvalidResponseError";
  }
}

/**
 * The request was cut off 10 seconds before the invocation runs out of time,
 * so the step can record the failure. A later attempt runs in a new
 * invocation, so the default retry strategy retries it.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class AiTimeoutError extends AiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiTimeoutError";
  }
}

/**
 * The text model stopped for a reason other than the end of its reply, such
 * as a guardrail that intervened or a filtered reply. The reply is not
 * returned. The default retry strategy retries `malformed_model_output` and
 * `malformed_tool_use`, because a new reply can succeed. It does not retry
 * the other reasons, because the same input stops the same way.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class LlmStoppedError extends AiError {
  /** The Converse `stopReason`, such as `guardrail_intervened`. */
  readonly stopReason: string;

  constructor(stopReason: string) {
    super(
      `The model stopped with the reason "${stopReason}". The reply is not returned.`,
    );
    this.name = "LlmStoppedError";
    this.stopReason = stopReason;
  }
}

/**
 * The text model's reply stopped at the `maxTokens` limit. A retry with the
 * same limit stops at the same place, so raise `maxTokens`.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class LlmMaxTokensError extends AiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmMaxTokensError";
  }
}
