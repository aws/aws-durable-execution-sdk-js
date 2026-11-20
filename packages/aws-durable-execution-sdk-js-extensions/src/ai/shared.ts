import {
  type DurableContext,
  DurablePromise,
  type StepConfig,
} from "@aws/durable-execution-sdk-js";
import { DeciderInvalidResponseError, rebuildAiError } from "./errors";

/**
 * Runs `body` in one durable step, and rejects with an AI error as its own
 * class.
 *
 * @remarks
 * `body` gets the step's `signal` when the core SDK provides one. The SDK
 * aborts it when it no longer needs the result, for example when a `map` or
 * `parallel` batch completes early.
 *
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
  body: (signal: AbortSignal | undefined) => Promise<T>,
): DurablePromise<T> {
  const step = context.step(
    name,
    // An older core SDK has no StepContext.signal. The call then runs
    // without a signal.
    async (stepContext) => body(stepContext.signal),
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
 * Finds the option that a reply names. The match trims whitespace and ignores
 * case, and the result is the caller's own spelling.
 */
export function matchOption(
  options: readonly string[],
  reply: string,
): string | undefined {
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
