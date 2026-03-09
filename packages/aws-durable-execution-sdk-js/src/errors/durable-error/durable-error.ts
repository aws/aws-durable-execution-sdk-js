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
      default:
        return new StepError(
          errorObject.ErrorMessage || "Unknown error",
          cause,
          errorObject.ErrorData,
        );
    }
  }

  /**
   * Convert to ErrorObject for serialization
   */
  toErrorObject(): ErrorObject {
    return {
      ErrorType: this.errorType,
      ErrorMessage: this.message,
      ErrorData: this.errorData,
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
 * Error thrown when a callback operation fails
 * @public
 */
export class CallbackError extends DurableOperationError {
  readonly errorType = "CallbackError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Callback failed", cause, errorData);
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
 * Error thrown when a wait for condition operation fails
 * @public
 */
export class WaitForConditionError extends DurableOperationError {
  readonly errorType = "WaitForConditionError";

  constructor(message?: string, cause?: Error, errorData?: string) {
    super(message || "Wait for condition failed", cause, errorData);
  }
}
