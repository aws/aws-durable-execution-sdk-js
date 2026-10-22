import type { OperationInfo } from "@aws/durable-execution-sdk-js";

// --- error.name ---
//
// The rule, shared with the Python and Java exporters:
//
// 1. A record names the error that caused the failure. A wrapper error that the
//    SDK added is never the name.
// 2. The SDK unwraps an error only when the error's type is one of the SDK's own
//    wrapper types. A user error is never unwrapped, even if it has a cause.
// 3. Unwrapping follows the whole chain of SDK wrappers, up to a depth of 16. A
//    cycle stops the walk.
// 4. If the chain ends at a user error, the name is that error's type name.
// 5. If the chain ends at an SDK error that is not a wrapper, the name is that
//    SDK error's simple class name. A callback timeout is an example.
// 6. A type name that is a qualified string is reduced to its last segment after
//    any `.` or `$`. If that segment is empty, the string is kept as it is.
// 7. A failure gets the same name whether the record is built live or from a
//    replayed checkpoint.
// 8. When the execution fails because an operation's error propagated, the
//    execution `error.name` equals that operation's `error.name`.
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

/** Maximum number of SDK wrappers unwrapped, and of nested operations searched. */
const MAX_DEPTH = 16;

/** Name reported for a missing, blank or otherwise unusable type name. */
const DEFAULT_ERROR_NAME = "Error";

/**
 * Reduces an error type string to the name a record reports.
 *
 * - A missing, empty or whitespace-only value gives `"Error"`.
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
  if (value.trim() === "") return DEFAULT_ERROR_NAME;
  const segment = value.slice(
    Math.max(value.lastIndexOf("."), value.lastIndexOf("$")) + 1,
  );
  return segment || value;
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
 * Whether a cause name carries no type. The SDK names a callback failure's cause
 * `"Error"` when the external sender gave no `ErrorType`, so `"Error"` counts as
 * no type here (and only here).
 */
function isUntypedCallbackCause(name: unknown): boolean {
  return (
    typeof name !== "string" ||
    name.trim() === "" ||
    name === DEFAULT_ERROR_NAME
  );
}

/**
 * Follows the chain of SDK wrappers from `error` (rule 3) and returns the error
 * at its end: the first error that is not an SDK wrapper, or the last wrapper
 * when the walk cannot go further (no error-like `cause`, a cycle, the depth
 * limit, or a callback failure with no type).
 */
function chainEnd(error: ErrorLike): ErrorLike {
  const seen = new Set<ErrorLike>();
  let current = error;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const type = wrapperType(current);
    if (type === undefined) break;
    const cause = current.cause;
    if (!isErrorLike(cause) || seen.has(cause) || cause === current) break;
    // An external callback failure without a type has no user error behind it
    // (the SDK synthesized the cause), so it keeps the SDK name (spec B13).
    if (
      type === CALLBACK_EXTERNAL_ERROR &&
      isUntypedCallbackCause(cause.name)
    ) {
      break;
    }
    seen.add(current);
    current = cause;
  }
  return current;
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

function epochMs(ts: unknown): number {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

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
   * so the two agree (rule 8).
   */
  executionErrorName(error: Error): string {
    const end = chainEnd(error);
    const lost = lostType(error, end);
    if (lost) {
      const source = this.findFailedOperation(lost);
      if (source) return this.operationErrorName(source);
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
      if (!isErrorLike(cause) || isUntypedCallbackCause(cause.name)) {
        return CALLBACK_EXTERNAL_ERROR;
      }
    }

    const end = chainEnd(error);
    const lost = lostType(error, end);
    // Descend at most 16 levels; the in-progress set also cuts a malformed
    // parent cycle.
    if (lost && this.inProgress.size <= MAX_DEPTH) {
      const child = this.findFailedChild(op, lost);
      if (child) return this.operationErrorName(child);
    }
    return reduceTypeName(end.name);
  }

  /**
   * The failed direct child of `op` that the lost error came from: a child whose
   * error has the same message. The latest to end wins.
   */
  private findFailedChild(
    op: OperationInfo,
    lost: LostType,
  ): OperationInfo | undefined {
    const candidates = (this.childIndex().get(op.id) ?? []).filter(
      (child) =>
        !this.inProgress.has(child.id) &&
        isErrorLike(child.error) &&
        chainEnd(child.error).message === lost.message,
    );
    return latest(candidates);
  }

  /**
   * The failed operation an execution error with a lost type came from: an
   * operation whose own error chain ends at the same SDK type and message. The
   * shallowest wins (the error propagated out of it); among equals, the latest
   * to end.
   */
  private findFailedOperation(lost: LostType): OperationInfo | undefined {
    const depths = this.depthIndex();
    let best: OperationInfo[] = [];
    let bestDepth = Number.POSITIVE_INFINITY;
    for (const op of Object.values(this.operations)) {
      if (op.type === "EXECUTION" || !isErrorLike(op.error)) continue;
      const end = chainEnd(op.error);
      if (
        reduceTypeName(end.name) !== lost.name ||
        end.message !== lost.message
      ) {
        continue;
      }
      const depth = depths.get(op.id) ?? 0;
      if (depth < bestDepth) {
        best = [op];
        bestDepth = depth;
      } else if (depth === bestDepth) {
        best.push(op);
      }
    }
    return latest(best);
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

function latest(ops: OperationInfo[]): OperationInfo | undefined {
  let best: OperationInfo | undefined;
  for (const op of ops) {
    if (!best || epochMs(op.endTimestamp) >= epochMs(best.endTimestamp)) {
      best = op;
    }
  }
  return best;
}
