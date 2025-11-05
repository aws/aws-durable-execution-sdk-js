import { TerminationReason } from "../../termination-manager/types";
import {
  UnrecoverableInvocationError,
  UnrecoverableExecutionError,
} from "../unrecoverable-error/unrecoverable-error";

/**
 * Error thrown when a checkpoint operation fails due to invocation-level issues
 * (e.g., 5xx errors, invalid checkpoint token)
 * This will terminate the current Lambda invocation, but the execution can continue with a new invocation
 */
export class CheckpointUnrecoverableInvocationError extends UnrecoverableInvocationError {
  readonly terminationReason = TerminationReason.CHECKPOINT_FAILED;

  constructor(message?: string, originalError?: Error) {
    super(message || "Checkpoint operation failed", originalError);
  }
}

/**
 * Error thrown when a checkpoint operation fails due to execution-level issues
 * (e.g., 4xx errors other than invalid checkpoint token)
 * This will terminate the entire execution and cannot be recovered
 */
export class CheckpointUnrecoverableExecutionError extends UnrecoverableExecutionError {
  readonly terminationReason = TerminationReason.CHECKPOINT_FAILED;

  constructor(message?: string, originalError?: Error) {
    super(message || "Checkpoint operation failed", originalError);
  }
}
