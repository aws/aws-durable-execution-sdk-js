import { TerminationReason } from "../../termination-manager/types";
import { UnrecoverableInvocationError } from "../unrecoverable-error/unrecoverable-error";

export class DurableExecutionNotEnabledError extends UnrecoverableInvocationError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor() {
    super(
      "This Lambda handler is wrapped with withDurableExecution() but durable executions is not enabled for this function. Recreate the function with durable execution enabled, or remove the withDurableExecution() wrapper",
    );
    this.name = "DurableExecutionNotEnabledError";
  }
}
