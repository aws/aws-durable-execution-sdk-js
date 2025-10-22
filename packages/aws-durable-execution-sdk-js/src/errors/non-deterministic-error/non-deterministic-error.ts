import { UnrecoverableExecutionError } from "../unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";

/**
 * Error thrown when non-deterministic code is detected during replay
 */
export class NonDeterministicExecutionError extends UnrecoverableExecutionError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor(message: string) {
    super(message);
    this.name = "NonDeterministicExecutionError";
  }
}
