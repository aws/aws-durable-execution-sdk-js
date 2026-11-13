import { DurableOperationError } from "@aws/durable-execution-sdk-js";

/** The options of an AI error. `errorData` is set when the SDK rebuilds it. */
interface AiErrorOptions {
  cause?: unknown;
  errorData?: string | undefined;
}

function asError(cause: unknown): Error | undefined {
  return cause instanceof Error ? cause : undefined;
}

/** Reads one field of the JSON in `errorData`. */
function dataField(errorData: string | undefined, key: string): unknown {
  if (errorData === undefined) {
    return undefined;
  }
  try {
    const data: unknown = JSON.parse(errorData);
    return typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The base class of the errors that the `decider` and `llm` operations throw.
 *
 * @remarks
 * An operation call rejects with the class that the step's last attempt
 * threw, on the first run and on replay. The SDK checkpoints the error type,
 * the message, and `errorData`. So a field such as {@link DeciderError.status}
 * is stored in `errorData` as JSON, and it is the same on replay.
 *
 * The class is restored at the operation's own boundary. A caller's own
 * `runInChildContext` wraps the failure in `ChildContextError`. The inner
 * error is then a `StepError` whose `cause.name` is the AI error type.
 *
 * Any other failure of the step, such as an AWS access-denied error, rejects
 * with the SDK's `StepError`.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class AiError extends DurableOperationError {
  readonly errorType: string = "AiError";

  constructor(message: string, options?: AiErrorOptions) {
    super(message, asError(options?.cause), options?.errorData);
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
  override readonly errorType: string = "DeciderError";

  constructor(message: string, options?: AiErrorOptions & { status?: number }) {
    super(message, {
      cause: options?.cause,
      errorData:
        options?.status === undefined
          ? options?.errorData
          : JSON.stringify({ status: options.status }),
    });
  }

  /** The HTTP status, when the decision model answered. */
  get status(): number | undefined {
    const status = dataField(this.errorData, "status");
    return typeof status === "number" ? status : undefined;
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
  override readonly errorType: string = "DeciderInvalidResponseError";
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
  override readonly errorType: string = "AiTimeoutError";
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
  override readonly errorType: string = "LlmStoppedError";

  constructor(stopReason: string, options?: AiErrorOptions) {
    super(
      `The model stopped with the reason "${stopReason}". The reply is not returned.`,
      {
        cause: options?.cause,
        errorData: options?.errorData ?? JSON.stringify({ stopReason }),
      },
    );
  }

  /** The Converse `stopReason`, such as `guardrail_intervened`. */
  get stopReason(): string {
    const reason = dataField(this.errorData, "stopReason");
    return typeof reason === "string" ? reason : "";
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
  override readonly errorType: string = "LlmMaxTokensError";
}

/**
 * Restores an AI error from the error that the SDK rebuilt from a
 * checkpoint, or returns `undefined` for any other error.
 *
 * The SDK rebuilds an error type it does not know as a `StepError`, and it
 * sets `cause.name` to the checkpointed type. The message and `errorData` are
 * kept, so the AI error is rebuilt from them.
 */
export function rebuildAiError(error: unknown): AiError | undefined {
  if (error instanceof AiError) {
    return error;
  }
  if (!(error instanceof DurableOperationError)) {
    return undefined;
  }
  const type =
    error.errorType === "StepError" ? error.cause?.name : error.errorType;
  const options = { cause: error.cause, errorData: error.errorData };
  switch (type) {
    case "AiError":
      return new AiError(error.message, options);
    case "DeciderError":
      return new DeciderError(error.message, options);
    case "DeciderInvalidResponseError":
      return new DeciderInvalidResponseError(error.message, options);
    case "AiTimeoutError":
      return new AiTimeoutError(error.message, options);
    case "LlmMaxTokensError":
      return new LlmMaxTokensError(error.message, options);
    case "LlmStoppedError": {
      const reason = dataField(error.errorData, "stopReason");
      return new LlmStoppedError(
        typeof reason === "string" ? reason : "unknown",
        options,
      );
    }
    default:
      return undefined;
  }
}
