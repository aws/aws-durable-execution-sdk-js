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
// 9. If the SDK cannot tell which of several failures caused a wrapper, it does
//    not guess. It reports the wrapper's name. Two map items or parallel
//    branches that fail with the same message but different types are an
//    example.
//
// `error.message` is never changed by this rule.

/**
 * The SDK's wrapper error types: the `errorType` of every `DurableOperationError`
 * subclass that the SDK puts around the error that caused a failure, carrying it
 * as `cause`.
 *
 * This is the core SDK's `KNOWN_DURABLE_ERROR_TYPES` (`batch-result.ts`) without
 * `CallbackTimeoutError`: a timeout has no user error behind it, so it is always
 * reported under its own name. `BatchCompletionError` is not a wrapper either.
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
/** Name of the SDK error thrown for a chained invoke that failed. */
const INVOKE_ERROR = "InvokeError";

/**
 * Maximum number of SDK wrappers unwrapped (rule 3), and of nested operations
 * descended into to find a lost type.
 */
const MAX_DEPTH = 16;

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

type ErrorLike = { name?: unknown; message?: unknown; cause?: unknown };

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

/** The `errorType` of an SDK wrapper error, or `undefined` for any other value. */
function wrapperType(error: ErrorLike): string | undefined {
  const { errorType } = error as { errorType?: unknown };
  return typeof errorType === "string" && SDK_WRAPPER_TYPES.has(errorType)
    ? errorType
    : undefined;
}

/**
 * Whether a cause name carries no type. The SDK names the cause it synthesizes
 * for a callback failure (and, in some SDK versions, for an invoke failure)
 * `"Error"` when it has no `ErrorType`, so `"Error"` counts as no type here (and
 * only for those two causes).
 */
function isUntypedCause(name: unknown): boolean {
  return (
    typeof name !== "string" || isBlank(name) || name === DEFAULT_ERROR_NAME
  );
}

/**
 * Follows the chain of SDK wrappers from `error` (rule 3) and returns the error
 * at its end: the first error that is not an SDK wrapper, or the last wrapper
 * when the walk cannot go further. That is the wrapper with no error-like
 * `cause`, the error reached after 16 unwraps, the last error visited before a
 * repeat (for a cycle), or a callback failure with no type.
 */
function chainEnd(error: ErrorLike): ErrorLike {
  return walkChain(error).end;
}

/**
 * {@link chainEnd}, plus the type of the last SDK wrapper unwrapped to reach the
 * end (`undefined` when nothing was unwrapped).
 */
function walkChain(error: ErrorLike): {
  end: ErrorLike;
  via: string | undefined;
} {
  const seen = new Set<ErrorLike>();
  let current = error;
  let via: string | undefined;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const type = wrapperType(current);
    if (type === undefined) break;
    const cause = current.cause;
    if (!isErrorLike(cause) || seen.has(cause) || cause === current) break;
    // An external callback failure without a type has no user error behind it
    // (the SDK synthesized the cause), so it keeps the SDK name (spec B13).
    if (type === CALLBACK_EXTERNAL_ERROR && isUntypedCause(cause.name)) {
      break;
    }
    seen.add(current);
    via = type;
    current = cause;
  }
  return { end: current, via };
}

/**
 * Whether the chain of a failure ended at an invoke failure's cause that carries
 * no type. The SDK may build the cause of a live or replayed `InvokeError` as a
 * plain `Error` named `"Error"`, dropping the invoked function's `ErrorType`,
 * while the failed invoke operation is rebuilt from its checkpoint with the
 * type. Returns the cause's message, to find that operation.
 */
function untypedInvokeCause(
  error: ErrorLike,
): { message: unknown } | undefined {
  const { end, via } = walkChain(error);
  if (end === error || via !== INVOKE_ERROR) return undefined;
  return isUntypedCause(end.name) ? { message: end.message } : undefined;
}

/**
 * Where the chain of a failure lost the user's error type: it ended at an error
 * whose name is itself an SDK wrapper type. The SDK checkpoints a failed child
 * context (and so a map item, parallel branch or waitForCallback) with the type
 * of the wrapper it caught, `StepError`, so the user's type lives only in the
 * failed descendant operation.
 */
interface LostType {
  name: string;
  message: unknown;
}

function lostType(error: ErrorLike, end: ErrorLike): LostType | undefined {
  if (end === error || wrapperType(end) !== undefined) return undefined;
  const name = reduceTypeName(end.name);
  return SDK_WRAPPER_TYPES.has(name)
    ? { name, message: end.message }
    : undefined;
}

/** Marks a choice between failures with different names (rule 9). */
const AMBIGUOUS: unique symbol = Symbol("ambiguous");

/**
 * Names the errors in one record: every operation's error and the execution's
 * error. Built once per record from the full operations map the SDK passes to
 * the plugin (not the filtered list the record emits), so a nested failure is
 * found even with `operationDetail: "top-level"`. The indexes are built on
 * first use and the per-operation names are memoized.
 *
 * @internal Exported for tests.
 */
export class ErrorNameResolver {
  private children: Map<string, OperationInfo[]> | undefined;
  private depths: Map<string, number> | undefined;
  private readonly names = new Map<string, string>();
  /** Operations being named right now, to cut a malformed parent cycle. */
  private readonly inProgress = new Set<string>();

  constructor(private readonly operations: Record<string, OperationInfo>) {}

  /** `error.name` for an operation's error. */
  operationErrorName(op: OperationInfo): string {
    const cached = this.names.get(op.id);
    if (cached !== undefined) return cached;
    this.inProgress.add(op.id);
    try {
      const name = this.resolveOperation(op);
      this.names.set(op.id, name);
      return name;
    } finally {
      this.inProgress.delete(op.id);
    }
  }

  /**
   * `error.name` for the execution's error. When the error's chain lost the
   * user's type, the name is that of the failed operation the error came from,
   * so the two agree (rule 8). When several failed operations could be that
   * source and they have different names, the wrapper's name is reported
   * (rule 9).
   */
  executionErrorName(error: Error): string {
    const end = chainEnd(error);
    const lost = lostType(error, end);
    if (lost) {
      const name = this.agreedName(this.findFailedOperations(lost));
      if (name === AMBIGUOUS) return reduceTypeName(end.name);
      if (name !== undefined) return name;
    }
    // An invoke failure whose cause has no type: the invoked function's type is
    // kept by the failed invoke operation's checkpoint. Without that operation,
    // or when several such operations disagree, report the SDK wrapper rather
    // than a generic "Error".
    const invoke = untypedInvokeCause(error);
    if (invoke) {
      const name = this.agreedName(this.findFailedInvokes(invoke.message));
      return name === AMBIGUOUS || name === undefined ? INVOKE_ERROR : name;
    }
    return reduceTypeName(end.name);
  }

  private resolveOperation(op: OperationInfo): string {
    const error = op.error;
    if (!isErrorLike(error)) return DEFAULT_ERROR_NAME;

    // The checkpoint stores a callback's error as the external sender gave it
    // and the SDK rebuilds it as a StepError. Name it the way the callback
    // handler names what it throws, so the operation and the execution agree.
    if (op.type === "CALLBACK") {
      if (op.status === "TIMED_OUT") return CALLBACK_TIMEOUT_ERROR;
      const cause = wrapperType(error) ? error.cause : error;
      if (!isErrorLike(cause) || isUntypedCause(cause.name)) {
        return CALLBACK_EXTERNAL_ERROR;
      }
    }

    const end = chainEnd(error);
    const lost = lostType(error, end);
    // Descend at most 16 levels: `inProgress` already holds this operation, so
    // `<` allows 15 more. It also cuts a malformed parent cycle.
    if (lost && this.inProgress.size < MAX_DEPTH) {
      const wrapperName = reduceTypeName(end.name);
      const fromChildren = this.agreedName(
        this.failedChildren(op, lost),
        op.endTimestamp,
      );
      if (fromChildren === AMBIGUOUS) return wrapperName;
      if (fromChildren !== undefined) return fromChildren;
      // A promise combinator (`context.promise.all`, `race`, ...) is a child
      // context, but the promises it awaits belong to its parent context: the
      // failed step is a sibling of the combinator, not a child.
      const fromSiblings = this.agreedName(
        this.failedSiblings(op, lost),
        op.endTimestamp,
        (name) => !SDK_WRAPPER_TYPES.has(name),
      );
      if (fromSiblings === AMBIGUOUS) return wrapperName;
      if (fromSiblings !== undefined) return fromSiblings;
    }
    return reduceTypeName(end.name);
  }

  /**
   * The one name shared by `candidates` (rule 9: the SDK does not guess).
   *
   * - Candidates whose name fails `accept` are dropped.
   * - When `parentEnd` is known, candidates that ended after it are dropped,
   *   unless that would drop them all: a failure that ended after its parent
   *   cannot have caused the parent's failure.
   * - Returns `undefined` when no candidate is left, and {@link AMBIGUOUS} when
   *   the candidates left have different names.
   */
  private agreedName(
    candidates: OperationInfo[],
    parentEnd?: unknown,
    accept: (name: string) => boolean = () => true,
  ): string | typeof AMBIGUOUS | undefined {
    let named = candidates
      .map((op) => ({ op, name: this.operationErrorName(op) }))
      .filter(({ name }) => accept(name));
    const end = timestampMs(parentEnd);
    if (end !== undefined) {
      const inTime = named.filter(({ op }) => {
        const opEnd = timestampMs(op.endTimestamp);
        return opEnd === undefined || opEnd <= end;
      });
      if (inTime.length > 0) named = inTime;
    }
    let agreed: string | undefined;
    for (const { name } of named) {
      if (agreed === undefined) agreed = name;
      else if (agreed !== name) return AMBIGUOUS;
    }
    return agreed;
  }

  /**
   * The failed direct children of `op` that the lost error could have come
   * from: children whose error chain ends at the same message.
   */
  private failedChildren(op: OperationInfo, lost: LostType): OperationInfo[] {
    return (this.childIndex().get(op.id) ?? []).filter((child) =>
      this.endsAtMessage(child, lost.message),
    );
  }

  /**
   * The failed siblings of `op` (same `parentId`) that the lost error could
   * have come from: siblings whose error chain ends at the same message and
   * that ran within `op`, starting no earlier than `op` started. The start
   * check keeps an earlier, handled failure with the same message out.
   */
  private failedSiblings(op: OperationInfo, lost: LostType): OperationInfo[] {
    const siblings = op.parentId
      ? this.childIndex().get(op.parentId)
      : this.topLevel();
    const start = timestampMs(op.startTimestamp);
    return (siblings ?? []).filter((sibling) => {
      if (sibling.id === op.id || !this.endsAtMessage(sibling, lost.message)) {
        return false;
      }
      const siblingStart = timestampMs(sibling.startTimestamp);
      return (
        start === undefined ||
        siblingStart === undefined ||
        siblingStart >= start
      );
    });
  }

  private endsAtMessage(op: OperationInfo, message: unknown): boolean {
    return (
      !this.inProgress.has(op.id) &&
      op.type !== "EXECUTION" &&
      isErrorLike(op.error) &&
      chainEnd(op.error).message === message
    );
  }

  /**
   * The failed operations an execution error with a lost type could have come
   * from: operations whose own error chain ends at the same SDK type and
   * message. Only the shallowest are kept (the error propagated out of them).
   */
  private findFailedOperations(lost: LostType): OperationInfo[] {
    return this.shallowest((op) => {
      if (op.type === "EXECUTION" || !isErrorLike(op.error)) return false;
      const end = chainEnd(op.error);
      return (
        reduceTypeName(end.name) === lost.name && end.message === lost.message
      );
    });
  }

  /**
   * The failed chained invokes an execution error with an untyped invoke cause
   * could have come from: `CHAINED_INVOKE` operations whose error chain ends at
   * the same message. Only the shallowest are kept.
   */
  private findFailedInvokes(message: unknown): OperationInfo[] {
    return this.shallowest(
      (op) =>
        op.type === "CHAINED_INVOKE" &&
        isErrorLike(op.error) &&
        chainEnd(op.error).message === message,
    );
  }

  private shallowest(matches: (op: OperationInfo) => boolean): OperationInfo[] {
    const depths = this.depthIndex();
    let best: OperationInfo[] = [];
    let bestDepth = Number.POSITIVE_INFINITY;
    for (const op of Object.values(this.operations)) {
      if (!matches(op)) continue;
      const depth = depths.get(op.id) ?? 0;
      if (depth < bestDepth) {
        best = [op];
        bestDepth = depth;
      } else if (depth === bestDepth) {
        best.push(op);
      }
    }
    return best;
  }

  /** Operations with no parent, or whose parent is the execution. */
  private topLevel(): OperationInfo[] {
    const depths = this.depthIndex();
    return Object.values(this.operations).filter(
      (op) => op.type !== "EXECUTION" && (depths.get(op.id) ?? 0) === 0,
    );
  }

  private childIndex(): Map<string, OperationInfo[]> {
    if (!this.children) {
      this.children = new Map();
      for (const op of Object.values(this.operations)) {
        if (!op.parentId) continue;
        const list = this.children.get(op.parentId);
        if (list) list.push(op);
        else this.children.set(op.parentId, [op]);
      }
    }
    return this.children;
  }

  private depthIndex(): Map<string, number> {
    if (!this.depths) {
      const byId = new Map<string, OperationInfo>();
      for (const op of Object.values(this.operations)) byId.set(op.id, op);
      this.depths = new Map();
      for (const op of byId.values()) {
        let depth = 0;
        let parent = op.parentId ? byId.get(op.parentId) : undefined;
        while (parent && depth < MAX_DEPTH) {
          if (parent.type === "EXECUTION") break;
          depth++;
          parent = parent.parentId ? byId.get(parent.parentId) : undefined;
        }
        this.depths.set(op.id, depth);
      }
    }
    return this.depths;
  }
}

/** A timestamp in epoch milliseconds, or `undefined` when it is unusable. */
function timestampMs(ts: unknown): number | undefined {
  let ms: number;
  if (ts instanceof Date) ms = ts.getTime();
  else if (typeof ts === "number") ms = ts;
  else if (typeof ts === "string") ms = Date.parse(ts);
  else return undefined;
  return Number.isFinite(ms) ? ms : undefined;
}
