import { ExecutionContext } from "../../types";
import { UnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";

/**
 * Terminates execution for unrecoverable errors and returns a never-resolving promise
 *
 * The error itself is carried on the termination details, not just its message: the
 * invocation-level handling in `with-durable-execution.ts` reports the error to
 * plugins and serializes it into the Lambda response, and both need the concrete
 * error (its `name`, and its stack when stack storage is enabled) rather than a
 * flattened string. `CHECKPOINT_FAILED` goes further and rethrows the carried error
 * to fail the invocation, so omitting it there would rethrow `undefined`.
 *
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
    error,
  });

  return new Promise<T>(() => {}); // Never-resolving promise
}
