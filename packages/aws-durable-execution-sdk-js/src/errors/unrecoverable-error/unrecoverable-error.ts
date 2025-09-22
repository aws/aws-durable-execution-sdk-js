import { TerminationReason } from "../../termination-manager/types";

/**
 * Base class for all unrecoverable errors
 * Any error that inherits from this class indicates a fatal condition
 */
export abstract class UnrecoverableError extends Error {
  abstract readonly terminationReason: TerminationReason;
  readonly isUnrecoverable = true;

  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;

    // Preserve the original stack trace if available
    if (originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }
}

/**
 * Base class for errors that make the entire execution unrecoverable
 * These errors indicate that the execution cannot continue and should be terminated completely
 */
export abstract class UnrecoverableExecutionError extends UnrecoverableError {
  readonly isUnrecoverableExecution = true;

  constructor(message: string, originalError?: Error) {
    super(`[Unrecoverable Execution] ${message}`, originalError);
  }
}

/**
 * Base class for errors that make the current invocation unrecoverable
 * These errors indicate that the current Lambda invocation should be terminated,
 * but the execution might be able to continue with a new invocation
 */
export abstract class UnrecoverableInvocationError extends UnrecoverableError {
  readonly isUnrecoverableInvocation = true;

  constructor(message: string, originalError?: Error) {
    super(`[Unrecoverable Invocation] ${message}`, originalError);
  }
}

/**
 * Type guard to check if an error is any kind of unrecoverable error
 */
export function isUnrecoverableError(
  error: unknown,
): error is UnrecoverableError {
  return (
    error instanceof Error &&
    "isUnrecoverable" in error &&
    error.isUnrecoverable === true
  );
}

/**
 * Type guard to check if an error is an unrecoverable execution error
 */
export function isUnrecoverableExecutionError(
  error: unknown,
): error is UnrecoverableExecutionError {
  return (
    error instanceof Error &&
    "isUnrecoverableExecution" in error &&
    error.isUnrecoverableExecution === true
  );
}

/**
 * Type guard to check if an error is an unrecoverable invocation error
 */
export function isUnrecoverableInvocationError(
  error: unknown,
): error is UnrecoverableInvocationError {
  return (
    error instanceof Error &&
    "isUnrecoverableInvocation" in error &&
    error.isUnrecoverableInvocation === true
  );
}
