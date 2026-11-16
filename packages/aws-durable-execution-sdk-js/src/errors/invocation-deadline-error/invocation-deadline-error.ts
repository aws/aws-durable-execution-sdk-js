import { TerminationReason } from "../../termination-manager/types";
import { UnrecoverableInvocationError } from "../unrecoverable-error/unrecoverable-error";

/**
 * The invocation's deadline passed before the handler finished.
 *
 * Thrown from the invocation, so it is an invocation error and Lambda retries the
 * invocation. It does not fail the execution. Lambda has usually answered with its own
 * timeout already, so this answer is then ignored.
 */
export class InvocationDeadlineError extends UnrecoverableInvocationError {
  override name = "InvocationDeadlineError";
  readonly terminationReason = TerminationReason.INVOCATION_DEADLINE_PASSED;

  constructor() {
    super("Invocation deadline passed");
  }
}
