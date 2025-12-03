import { ExecutionContext } from "../../types";
import { UnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";

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
  context.terminationManager.terminate({
    reason: error.terminationReason,
    message: `Unrecoverable error in step ${stepIdentifier}: ${error.message}`,
  });

  return new Promise<T>(() => {}); // Never-resolving promise
}
