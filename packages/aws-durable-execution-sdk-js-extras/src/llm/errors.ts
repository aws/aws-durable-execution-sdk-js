/**
 * The base class of the errors that the `llm` operations throw.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
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
export class LlmInvalidResponseError extends LlmError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmInvalidResponseError";
  }
}

/**
 * The decision model endpoint answered with an HTTP error, or could not be
 * reached.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class LlmDeciderError extends LlmError {
  /** The HTTP status, when the endpoint answered. */
  readonly status: number | undefined;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options);
    this.name = "LlmDeciderError";
    this.status = options?.status;
  }
}
