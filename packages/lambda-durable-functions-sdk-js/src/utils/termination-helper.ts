import { ExecutionContext } from "../types";
import { UnrecoverableError } from "../errors/unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../termination-manager/types";

/**
 * Terminates execution and returns a never-resolving promise to prevent code progression
 * @param context - The execution context containing the termination manager
 * @param reason - The termination reason
 * @param message - The termination message
 * @returns A never-resolving promise
 */
export function terminate<T>(
  context: ExecutionContext,
  reason: TerminationReason,
  message: string,
): Promise<T> {
  // Terminate execution with appropriate message
  context.terminationManager.terminate({
    reason,
    message,
  });

  // Return a never-resolving promise to ensure the execution doesn't continue
  return new Promise<T>(() => {});
}

/**
 * Terminates execution for unrecoverable errors and returns a never-resolving promise
 * @param context - The execution context containing the termination manager
 * @param error - The unrecoverable error that caused termination
 * @param stepIdentifier - The step name or ID for error messaging
 * @returns A never-resolving promise
 */
export function terminateForUnrecoverableError<T>(
  context: ExecutionContext,
  error: UnrecoverableError,
  stepIdentifier: string,
): Promise<T> {
  return terminate(
    context,
    error.terminationReason,
    `Unrecoverable error in step ${stepIdentifier}: ${error.message}`,
  );
}
