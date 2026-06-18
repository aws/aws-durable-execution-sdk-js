import { ErrorObject } from "@aws-sdk/client-lambda";
import { STORE_STACK_TRACES } from "../../utils/constants/constants";

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
