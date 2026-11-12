import {
  type DurableContext,
  DurablePromise,
  type StepConfig,
} from "@aws/durable-execution-sdk-js";
import {
  AiTimeoutError,
  DeciderInvalidResponseError,
  rebuildAiError,
} from "./errors";

/** Time that a request leaves for the step to record its outcome. */
export const INVOCATION_RESERVE_MS = 10_000;

/**
 * The most options of `classify`. A Strands Decider `choice` question accepts
 * at most 255.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_CLASSIFY_OPTIONS = 255;
/**
 * The most entries of a `score` scale. A Strands Decider `score` question
 * accepts at most 10 levels.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_SCORE_LEVELS = 10;

/**
 * Returns a signal that fires {@link INVOCATION_RESERVE_MS} before the
 * invocation runs out of time. A compute that reports no remaining time gets
 * no signal.
 */
export function deadlineSignal(
  context: DurableContext,
): AbortSignal | undefined {
  const lambdaContext = context.lambdaContext as
    | { getRemainingTimeInMillis?: unknown }
    | undefined;
  let remaining: unknown;
  try {
    // The lookup is inside the try too, because a getter can throw.
    const read = lambdaContext?.getRemainingTimeInMillis;
    if (typeof read !== "function") {
      return undefined;
    }
    remaining = read.call(lambdaContext);
  } catch {
    // A deadline that cannot be read means no deadline, as in the core SDK.
    // The call then runs without the reserve, and does not fail for it.
    return undefined;
  }
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
    return undefined;
  }
  return AbortSignal.timeout(Math.max(remaining - INVOCATION_RESERVE_MS, 1));
}

/**
 * The signals of one request.
 *
 * - `deadline` fires {@link INVOCATION_RESERVE_MS} before the invocation runs
 *   out of time.
 * - `signal` fires on the deadline, or when the SDK cancels the step, for
 *   example when a `map` or `parallel` batch completes early.
 *
 * The request is sent with `signal`. {@link deadlineError} checks only
 * `deadline`, so a cancelled step does not count as a timeout.
 */
export interface RequestSignals {
  signal: AbortSignal | undefined;
  deadline: AbortSignal | undefined;
}

/** Returns the signals of one request. */
export function requestSignals(
  context: DurableContext,
  stepSignal: AbortSignal | undefined,
): RequestSignals {
  const deadline = deadlineSignal(context);
  const signals = [stepSignal, deadline].filter(
    (value): value is AbortSignal => value !== undefined,
  );
  return {
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    deadline,
  };
}

/**
 * Runs `body` in one durable step, and rejects with an AI error as its own
 * class.
 *
 * @remarks
 * The SDK rebuilds a failed step as a `StepError`, on the first run and on
 * replay. Its `cause.name` and `errorData` hold the AI error type and data.
 * So the error is rebuilt as that AI class. Any other failure stays a
 * `StepError`.
 *
 * The step is created when this function runs, so it keeps its place in the
 * operation order. The returned promise only maps the error.
 */
export function aiStep<T>(
  context: DurableContext,
  name: string,
  config: StepConfig<T>,
  body: (signals: RequestSignals) => Promise<T>,
): DurablePromise<T> {
  const step = context.step(
    name,
    async (stepContext) => body(requestSignals(context, stepContext.signal)),
    config,
  );
  return new DurablePromise<T>(() =>
    step.then(
      (value) => value,
      (error: unknown) => {
        throw rebuildAiError(error) ?? error;
      },
    ),
  );
}

const ABORT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "AbortError",
  "TimeoutError",
]);

/** The errors in the `cause` chain of `error`, starting with `error`. */
export function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined; depth++) {
    chain.push(current);
    current = (current as { cause?: unknown } | null)?.cause;
  }
  return chain;
}

/**
 * Whether `error`, or an error in its `cause` chain, is an abort. The
 * deadline signal is an `AbortSignal.timeout`, whose reason is a
 * `TimeoutError`, and clients report an abort as an `AbortError`.
 */
function isAbort(error: unknown): boolean {
  return causeChain(error).some((link) =>
    ABORT_ERROR_NAMES.has((link as { name?: unknown } | null)?.name as string),
  );
}

/**
 * Turns an abort caused by the invocation deadline into an
 * {@link AiTimeoutError}, so the step retries in a new invocation. Any other
 * error passes through, also when it arrives after the deadline, so a
 * permanent failure such as HTTP 401 keeps its own message and is not
 * retried.
 */
export function deadlineError(
  error: unknown,
  signal: AbortSignal | undefined,
): unknown {
  if (signal?.aborted && !(error instanceof AiTimeoutError) && isAbort(error)) {
    return new AiTimeoutError(
      "The request was stopped 10 seconds before the invocation runs out of time.",
      { cause: error },
    );
  }
  return error;
}

/**
 * Serializes an input for the model. A string stays as it is, and
 * `undefined` becomes an empty string.
 *
 * @throws \{TypeError\} When `JSON.stringify` cannot encode the input.
 */
export function serializeInput(input: unknown): string {
  if (input === undefined) {
    return "";
  }
  if (typeof input === "string") {
    return input;
  }
  const json = JSON.stringify(input);
  if (json === undefined) {
    throw new TypeError("The input cannot be encoded as JSON.");
  }
  return json;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Checks a question.
 *
 * @throws \{TypeError\} When the question is not a non-empty string.
 */
export function validateQuestion(
  question: unknown,
): asserts question is string {
  if (typeof question !== "string" || question.trim() === "") {
    throw new TypeError("The question must be a non-empty string.");
  }
}

/**
 * Checks the options of `classify` or `label`: at least two non-empty strings
 * that differ after trimming and ignoring case, and at most `max`.
 *
 * @throws \{TypeError\} When an option is not valid.
 * @throws \{RangeError\} When there are fewer than two options, or more than
 * `max`.
 */
export function validateOptions(
  options: unknown,
  max = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (!Array.isArray(options)) {
    throw new TypeError("The options must be an array of strings.");
  }
  if (options.length < 2) {
    throw new RangeError("The options must have at least two entries.");
  }
  if (options.length > max) {
    throw new RangeError(`The options must have at most ${max} entries.`);
  }
  const seen = new Set<string>();
  for (const option of options) {
    if (typeof option !== "string" || option.trim() === "") {
      throw new TypeError("Every option must be a non-empty string.");
    }
    const key = normalize(option);
    if (seen.has(key)) {
      throw new TypeError(
        `The options must be unique, ignoring case and surrounding whitespace. "${option}" is repeated.`,
      );
    }
    seen.add(key);
  }
  return options as readonly string[];
}

/**
 * Checks the scale of `score`: from 2 to {@link MAX_SCORE_LEVELS} non-empty
 * strings.
 *
 * @throws \{TypeError\} When an entry is not a non-empty string.
 * @throws \{RangeError\} When there are fewer than 2 entries or more than
 * {@link MAX_SCORE_LEVELS}.
 */
export function validateScale(scale: unknown): readonly string[] {
  if (!Array.isArray(scale)) {
    throw new TypeError("The scale must be an array of strings.");
  }
  if (scale.length < 2) {
    throw new RangeError("The scale must have at least two entries.");
  }
  if (scale.length > MAX_SCORE_LEVELS) {
    throw new RangeError(
      `The scale must have at most ${MAX_SCORE_LEVELS} entries.`,
    );
  }
  for (const entry of scale) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new TypeError("Every scale entry must be a non-empty string.");
    }
  }
  return scale as readonly string[];
}

/**
 * Finds the option that a reply names. The match trims whitespace and ignores
 * case, and the result is the caller's own spelling.
 */
export function matchOption(
  options: readonly string[],
  reply: unknown,
): string | undefined {
  if (typeof reply !== "string") {
    return undefined;
  }
  const key = normalize(reply);
  return options.find((option) => normalize(option) === key);
}

/** Maps a position on a scale of `levels` entries, 0-based, to 0..1. */
export function toUnitScore(zeroBasedPosition: number, levels: number): number {
  return Math.min(1, Math.max(0, zeroBasedPosition / (levels - 1)));
}

export function invalid(message: string, cause?: unknown): never {
  throw new DeciderInvalidResponseError(message, { cause });
}

/**
 * Returns a promise that rejects with `error` and creates no durable
 * operation.
 */
export function rejected<T>(error: unknown): DurablePromise<T> {
  return new DurablePromise<T>(() => Promise.reject(error));
}
