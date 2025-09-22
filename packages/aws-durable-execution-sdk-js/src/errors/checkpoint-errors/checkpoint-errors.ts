import { TerminationReason } from "../../termination-manager/types";
import { UnrecoverableInvocationError } from "../unrecoverable-error/unrecoverable-error";

/**
 * Error thrown when a checkpoint operation fails
 * This is an unrecoverable invocation error that will terminate the current Lambda invocation,
 * but the execution might be able to continue with a new invocation
 */
export class CheckpointFailedError extends UnrecoverableInvocationError {
  readonly terminationReason = TerminationReason.CHECKPOINT_FAILED;

  constructor(message?: string, originalError?: Error) {
    super(message || "Checkpoint operation failed", originalError);
  }
}
