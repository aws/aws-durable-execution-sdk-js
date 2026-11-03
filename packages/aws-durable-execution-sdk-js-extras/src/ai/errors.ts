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
