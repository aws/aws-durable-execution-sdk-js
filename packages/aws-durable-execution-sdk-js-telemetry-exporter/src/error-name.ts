import type { OperationInfo } from "@aws/durable-execution-sdk-js";

// --- error.name ---
//
// The rule, shared with the Python and Java exporters:
//
// 1. A record names the error that caused the failure. A wrapper error that the
//    SDK added is never the name, except in the bounded cases of rules 3 and 9.
// 2. The SDK unwraps an error only when the error's type is one of the SDK's own
//    wrapper types. A user error is never unwrapped, even if it has a cause.
// 3. Unwrapping follows the chain of SDK wrappers. The depth counts unwrap
//    steps, one per wrapper passed, not levels in the operation tree. At most 16
//    unwraps happen. If the error reached after 16 unwraps is still a wrapper,
//    its name is reported. If the chain reaches an error it has already
//    visited, the walk stops and the last error visited before the repeat is
//    reported.
// 4. If the chain ends at a user error, the name is that error's type name.
// 5. If the chain ends at an SDK error that is not a wrapper, the name is that
//    SDK error's simple class name. A callback timeout is an example.
// 6. A type name that is a qualified string is reduced to its last segment after
//    any `.` or `$`. If that segment is empty, the string is kept as it is. A
//    missing type, or a type made only of blank characters, is `Error`. The
//    blank characters are the six ASCII whitespace characters: space, `\t`,
//    `\n`, `\r`, `\f` and `\v`. No other character counts as blank, and names
//    are never trimmed.
// 7. A failure gets the same name whether the record is built live or from a
//    replayed checkpoint.
// 8. When the execution fails because an operation's error propagated, the
//    execution `error.name` equals that operation's `error.name`.
// 9. If a checkpoint holds only a wrapper type, which an older SDK can write,
//    the name is that wrapper's name. The exporter never guesses a cause from
//    other operations.
//
// `error.message` is never changed by this rule.
//
// The core SDK checkpoints a failed context (child context, map item, parallel
// branch, promise combinator, waitForCallback) with the error its wrappers
// carry, so every failed operation's own error names the user's type. The
// exporter needs no other operation to name one.

/**
 * The SDK's wrapper error types: the `errorType` of every `DurableOperationError`
 * subclass that the SDK puts around the error that caused a failure, carrying it
 * as `cause`. `CallbackTimeoutError` and `BatchCompletionError` are not wrappers.
 *
 * Matched by the `errorType` string rather than with `instanceof`, so it holds
 * when the plugin and the SDK resolve to different copies of the SDK module
 * (CommonJS and ES module builds) and when a bundler renames the SDK's classes.
 */
const SDK_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "StepError",
  "CallbackError",
  "CallbackExternalError",
  "CallbackSubmitterError",
  "InvokeError",
  "ChildContextError",
  "PromiseCombinatorError",
  "WaitForConditionError",
]);

/** Name of the SDK error thrown for a callback that timed out. */
const CALLBACK_TIMEOUT_ERROR = "CallbackTimeoutError";
/** Name of the SDK error thrown for a callback that was failed externally. */
const CALLBACK_EXTERNAL_ERROR = "CallbackExternalError";

/** Maximum number of SDK wrappers unwrapped (rule 3). */
const MAX_UNWRAPS = 16;

/** Name reported for a missing, blank or otherwise unusable type name. */
const DEFAULT_ERROR_NAME = "Error";

/**
 * Reduces an error type string to the name a record reports.
 *
 * - A missing or empty value, or one made only of the six ASCII whitespace
 *   characters (space, `\t`, `\n`, `\r`, `\f`, `\v`), gives `"Error"`. Any other
 *   character, such as U+00A0 or U+FEFF, is not blank.
 * - Otherwise the value is reduced to its last segment after any `.` or `$`
 *   (`"a.b.Outer$PaymentError"` → `"PaymentError"`). When that segment is empty
 *   (`"trailing."`, `"Outer$"`, `"."`), the value is returned unchanged.
 * - The value is never trimmed: `" PaymentError "` is returned as it is.
 * - A non-string value is converted with `String(...)` first.
 *
 * @internal Exported for tests.
 */
export function reduceTypeName(typeName: unknown): string {
  if (typeName === undefined || typeName === null) return DEFAULT_ERROR_NAME;
  let value: string;
  try {
    value = typeof typeName === "string" ? typeName : String(typeName);
  } catch {
    // A name whose conversion throws (a hostile toString) must not break the record.
    return DEFAULT_ERROR_NAME;
  }
  if (isBlank(value)) return DEFAULT_ERROR_NAME;
  const segment = value.slice(
    Math.max(value.lastIndexOf("."), value.lastIndexOf("$")) + 1,
  );
  return segment || value;
}

/** The six ASCII whitespace characters of rule 6, and nothing else. */
const BLANK = /^[ \t\n\r\f\v]*$/;

/** Whether a string is empty or made only of the six ASCII whitespace characters. */
function isBlank(value: string): boolean {
  return BLANK.test(value);
}

type ErrorLike = { name?: unknown; cause?: unknown };

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

function isWrapper(error: ErrorLike): boolean {
  const { errorType } = error as { errorType?: unknown };
  return typeof errorType === "string" && SDK_WRAPPER_TYPES.has(errorType);
}

/**
 * Follows the chain of SDK wrappers from `error` (rule 3) and returns the error
 * at its end: the first error that is not an SDK wrapper, or the last wrapper
 * when the walk cannot go further. That is a wrapper with no error-like `cause`,
 * the error reached after 16 unwraps, or the last error visited before a repeat.
 */
function chainEnd(error: ErrorLike): ErrorLike {
  const seen = new Set<ErrorLike>([error]);
  let current = error;
  for (let unwraps = 0; unwraps < MAX_UNWRAPS; unwraps++) {
    if (!isWrapper(current)) break;
    const cause = current.cause;
    if (!isErrorLike(cause) || seen.has(cause)) break;
    seen.add(cause);
    current = cause;
  }
  return current;
}

/** `error.name` for an error: the reduced name at the end of its chain. */
function nameOf(error: ErrorLike): string {
  return reduceTypeName(chainEnd(error).name);
}

/**
 * `error.name` for an operation's error: the reduced type of the operation's
 * own checkpointed error, at the end of its cause chain.
 *
 * A callback is named the way the callback handler names what it throws: a
 * timeout is `CallbackTimeoutError`, and a failure with no type is
 * `CallbackExternalError`. The explicit type `"Error"` stays `Error` (B13b).
 * An older SDK rebuilt a callback's error with a cause named `"Error"` even
 * when the type was missing; such a record reports `Error`.
 *
 * @internal Exported for tests.
 */
export function operationErrorName(op: OperationInfo): string {
  if (op.type === "CALLBACK" && op.status === "TIMED_OUT") {
    return CALLBACK_TIMEOUT_ERROR;
  }
  const error = op.error;
  if (!isErrorLike(error)) return DEFAULT_ERROR_NAME;
  if (op.type === "CALLBACK") {
    const end = chainEnd(error);
    if (end === error || typeof end.name !== "string" || isBlank(end.name)) {
      return CALLBACK_EXTERNAL_ERROR;
    }
  }
  return nameOf(error);
}

/**
 * `error.name` for the execution's error: the reduced name at the end of its
 * chain of SDK wrappers (rules 2 to 6). When the chain ends at an error named
 * after a wrapper type, which a checkpoint from an older SDK can hold, that
 * name is reported (rule 9).
 *
 * @internal Exported for tests.
 */
export function executionErrorName(error: Error): string {
  return nameOf(error);
}
