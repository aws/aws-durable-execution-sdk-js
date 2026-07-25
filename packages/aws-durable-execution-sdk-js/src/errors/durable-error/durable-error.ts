import { ErrorObject } from "@aws-sdk/client-lambda";
import { STORE_STACK_TRACES } from "../../utils/constants/constants";
// Type-only import to avoid a runtime circular dependency with types/batch.
import type { CompletionReason } from "../../types/core";

/**
 * Base class for all durable operation errors
 * @public
 */
export abstract class DurableOperationError extends Error {
  abstract readonly errorType: string;
  public cause?: Error;
  public errorData?: string;
  public stackTrace?: string[];

  constructor(message: string, cause?: Error, errorData?: string) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    this.errorData = errorData;

    // Preserve original stack trace if cause exists and stack traces are enabled
    if (STORE_STACK_TRACES && cause?.stack) {
      this.stackTrace = cause.stack.split(/\r?\n/);
    }
  }

  /**
   * Create DurableOperationError from ErrorObject (for reconstruction during replay)
   */
  static fromErrorObject(errorObject: ErrorObject): DurableOperationError {
    const cause = new Error(errorObject.ErrorMessage);
    cause.name = errorObject.ErrorType || "Error";
    cause.stack = errorObject.StackTrace?.join("\n");

    // Determine error type and create appropriate instance
    switch (errorObject.ErrorType) {
      case "StepError":
        return new StepError(
          errorObject.ErrorMessage || "Step failed",
          cause,
          errorObject.ErrorData,
        );
      case "CallbackError":
        return new CallbackError(
          errorObject.ErrorMessage || "Callback failed",
          cause,
          errorObject.ErrorData,
        );
      case "CallbackExternalError":
        return new CallbackExternalError(
          errorObject.ErrorMessage || "Callback failed",
          cause,
          errorObject.ErrorData,
        );
      case "CallbackTimeoutError":
        return new CallbackTimeoutError(
          errorObject.ErrorMessage || "Callback timed out",
          cause,
          errorObject.ErrorData,
        );
      case "CallbackSubmitterError":
        return new CallbackSubmitterError(
          errorObject.ErrorMessage || "Callback submitter failed",
          cause,
          errorObject.ErrorData,
        );
      case "InvokeError":
        return new InvokeError(
          errorObject.ErrorMessage || "Invoke failed",
          cause,
          errorObject.ErrorData,
        );
      case "ChildContextError":
        return new ChildContextError(
          errorObject.ErrorMessage || "Child context failed",
          cause,
          errorObject.ErrorData,
        );
      case "WaitForConditionError":
        return new WaitForConditionError(
          errorObject.ErrorMessage || "Wait for condition failed",
          cause,
          errorObject.ErrorData,
        );
      case "PromiseCombinatorError":
        return new PromiseCombinatorError(
          errorObject.ErrorMessage || "Promise combinator failed",
          cause,
          errorObject.ErrorData,
        );
      case "DagExecutionError":
        return new DagExecutionError(
          errorObject.ErrorMessage || "DAG execution had failures",
          cause,
          errorObject.ErrorData,
        );
      case "DagCyclicDependencyError":
        return new DagCyclicDependencyError(
          [],
          errorObject.ErrorMessage || "DAG cyclic dependency",
          cause,
          errorObject.ErrorData,
        );
      case "DagInvalidTaskNameError":
        return new DagInvalidTaskNameError(
          "",
          errorObject.ErrorMessage || "Invalid DAG task name",
          cause,
          errorObject.ErrorData,
        );
      case "DagDuplicateTaskError":
        return new DagDuplicateTaskError(
          "",
          errorObject.ErrorMessage || "Duplicate DAG task name",
          cause,
          errorObject.ErrorData,
        );
      case "DagInvalidDependencyError":
        return new DagInvalidDependencyError(
          "",
          errorObject.ErrorMessage || "Invalid DAG dependency",
          cause,
          errorObject.ErrorData,
        );
      case "DagPredicateError":
        // The offending task name is not a serialized ErrorObject field, so
        // (like the sibling registration errors above) it reconstructs empty;
        // the name is preserved in ErrorMessage. Without this case the caller
        // awaiting dag() would observe a StepError, not a DagPredicateError,
        // because the child-context boundary always re-materialises the thrown
        // error via fromErrorObject (see run-in-child-context-handler).
        return new DagPredicateError(
          "",
          errorObject.ErrorMessage || "DAG runIf predicate threw",
          cause,
          errorObject.ErrorData,
        );
      default:
        return new StepError(
          errorObject.ErrorMessage || "Unknown error",
          cause,
          errorObject.ErrorData,
        );
    }
  }

  /**
   * Convert to ErrorObject for serialization.
   * When errorData is undefined, walks the cause chain to surface the first
   * errorData found — prevents loss across runInChildContext boundaries.
   */
  toErrorObject(): ErrorObject {
    let errorData = this.errorData;
    if (errorData === undefined) {
      let node: unknown = this.cause;
      for (let i = 0; i < 10 && node; i++) {
        if (
          node instanceof DurableOperationError &&
          typeof node.errorData === "string"
        ) {
          errorData = node.errorData;
          break;
        }
        node = node instanceof Error ? node.cause : undefined;
      }
    }
    return {
      ErrorType: this.errorType,
      ErrorMessage: this.message,
      ErrorData: errorData,
      StackTrace: STORE_STACK_TRACES
        ? this.cause?.stack?.split(/\r?\n/) || this.stack?.split(/\r?\n/)
        : undefined,
    };
  }
}

/**
 * Error thrown when a step operation fails
 * @public
 */
export class StepError extends DurableOperationError {
  readonly errorType = "StepError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Step failed", cause, errorData);
  }
}

/**
 * Base error for all callback operation failures.
 *
 * Acts as the parent class for the more specific callback errors, so callers
 * can catch every callback-related failure with a single
 * `instanceof CallbackError` check:
 *
 * ```
 * CallbackError
 *   +- CallbackExternalError   // external entity reported failure
 *   +- CallbackTimeoutError    // callback timed out
 *   +- CallbackSubmitterError  // submitter function failed
 * ```
 *
 * It is also thrown directly for internal callback failures that do not fall
 * into one of the more specific categories (e.g. a missing callback ID).
 *
 * @public
 */
export class CallbackError extends DurableOperationError {
  readonly errorType: string = "CallbackError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Callback failed", cause, errorData);
  }
}

/**
 * Error thrown when the external entity completes a callback with a failure
 * (e.g. via SendDurableExecutionCallbackFailure) instead of a success.
 * @public
 */
export class CallbackExternalError extends CallbackError {
  readonly errorType = "CallbackExternalError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Callback failed", cause, errorData);
  }
}

/**
 * Error thrown when a callback operation times out
 * @public
 */
export class CallbackTimeoutError extends CallbackError {
  readonly errorType = "CallbackTimeoutError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Callback timed out", cause, errorData);
  }
}

/**
 * Error thrown when a callback submitter fails
 * @public
 */
export class CallbackSubmitterError extends CallbackError {
  readonly errorType = "CallbackSubmitterError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Callback submitter failed", cause, errorData);
  }
}

/**
 * Error thrown when an invoke operation fails
 * @public
 */
export class InvokeError extends DurableOperationError {
  readonly errorType = "InvokeError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Invoke failed", cause, errorData);
  }
}

/**
 * Error thrown when a child context operation fails
 * @public
 */
export class ChildContextError extends DurableOperationError {
  readonly errorType = "ChildContextError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Child context failed", cause, errorData);
  }
}

/**
 * Error thrown when a promise combinator operation fails
 * @public
 */
export class PromiseCombinatorError extends DurableOperationError {
  readonly errorType = "PromiseCombinatorError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Promise combinator failed", cause, errorData);
  }
}

/**
 * Error thrown when a wait for condition operation fails
 * @public
 */
export class WaitForConditionError extends DurableOperationError {
  readonly errorType = "WaitForConditionError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Wait for condition failed", cause, errorData);
  }
}

/**
 * Error thrown by {@link BatchResult.throwIfError} when a map/parallel batch
 * completed as failed because a custom `shouldComplete` decision returned a
 * `FAILED` outcome (`CUSTOM_COMPLETION_FAILED`) — even when no individual item
 * failed (e.g. a required quorum could not be met).
 * @public
 */
export class BatchCompletionError extends DurableOperationError {
  readonly errorType = "BatchCompletionError";

  constructor(
    /** The completion reason that caused the batch to be treated as failed. */
    public readonly completionReason: CompletionReason,
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message ||
        `Batch completed as failed by shouldComplete (${completionReason})`,
      cause,
      errorData,
    );
  }
}

/**
 * Error thrown by `DagResult.throwIfError` when one or more DAG tasks failed
 * (or a custom completion decision returned a `FAILED` outcome). Carries the
 * first failed task's error as `cause`.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagExecutionError extends DurableOperationError {
  readonly errorType = "DagExecutionError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "DAG execution had failures", cause, errorData);
  }
}

/**
 * Error thrown at DAG registration when a cyclic dependency is detected.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagCyclicDependencyError extends DurableOperationError {
  readonly errorType = "DagCyclicDependencyError";

  constructor(
    public readonly cyclicTasks: string[] = [],
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message ||
        `DAG contains a cyclic dependency among tasks: ${cyclicTasks.join(", ")}`,
      cause,
      errorData,
    );
  }
}

/**
 * Error thrown at DAG registration when a task name is invalid.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagInvalidTaskNameError extends DurableOperationError {
  readonly errorType = "DagInvalidTaskNameError";

  constructor(
    public readonly taskName: string = "",
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(message || `Invalid DAG task name: "${taskName}"`, cause, errorData);
  }
}

/**
 * Error thrown at DAG registration when two tasks share a name in one scope.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagDuplicateTaskError extends DurableOperationError {
  readonly errorType = "DagDuplicateTaskError";

  constructor(
    public readonly taskName: string = "",
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message || `Duplicate DAG task name: "${taskName}"`,
      cause,
      errorData,
    );
  }
}

/**
 * Error thrown at DAG registration when a task depends on a handle not
 * registered in the current DAG scope.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagInvalidDependencyError extends DurableOperationError {
  readonly errorType = "DagInvalidDependencyError";

  constructor(
    public readonly taskName: string = "",
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message ||
        `Task "${taskName}" depends on a task that is not registered in this DAG`,
      cause,
      errorData,
    );
  }
}

/**
 * Error thrown when a task's `runIf` predicate throws during scheduling.
 *
 * `runIf` is specified as a synchronous, deterministic, pure predicate over
 * resolved upstream results; it is re-evaluated on every replay and is never a
 * checkpointed operation. A predicate that throws is therefore a defect in
 * deterministic code, not a business outcome. When it throws, the task gets NO
 * terminal state (neither `FAILED` nor `SKIPPED`), the scheduler aborts without
 * starting any further tasks, and the `dag(...)` operation fails with this
 * error. Aborting — rather than recording the task `FAILED` — prevents a
 * predicate defect from silently driving downstream `ALL_FAILED` /
 * `ANY_FAILED` / `ALL_DONE` compensation paths (e.g. issuing a refund because a
 * predicate hit a `TypeError`).
 *
 * Carries the offending task's name (`taskName`) and the original thrown error
 * as `cause`. This is distinct from a throwing task **body**, which remains a
 * normal task `FAILED`.
 *
 * The default message names the offending task **and** the cause's type and
 * message — e.g. `runIf predicate for DAG task "decide" threw TypeError: boom`.
 * This is deliberate: the structured `taskName` and `cause`
 * fields do not survive the DAG container's child-context round-trip (a
 * limitation shared by the whole `Dag*Error` family — see
 * {@link DurableOperationError.fromErrorObject}), so a caller awaiting
 * `dag(...)` after that boundary can only recover *which* task threw and
 * *what* it threw by reading the message. Baking both into the message keeps
 * JS on par with Java (`DagPredicateException` names the task plus the original
 * error) and Go (`DagPredicateError.Error()` names the task and wraps the
 * cause). In-process consumers (before the boundary) still get the structured
 * `taskName` and `cause`.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagPredicateError extends DurableOperationError {
  readonly errorType = "DagPredicateError";

  constructor(
    public readonly taskName: string = "",
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message || DagPredicateError.buildMessage(taskName, cause),
      cause,
      errorData,
    );
  }

  /**
   * Builds the default message, naming the offending task and — when a cause
   * is present — the cause's type and message. Mirrors Java's
   * `DagPredicateException.buildMessage`: append the cause type, then `": "` +
   * message only when the cause carries a (non-empty) message.
   */
  private static buildMessage(taskName: string, cause?: Error): string {
    const base = `runIf predicate for DAG task "${taskName}" threw`;
    if (!cause) {
      return base;
    }
    const type = cause.name || "Error";
    return cause.message
      ? `${base} ${type}: ${cause.message}`
      : `${base} ${type}`;
  }
}
