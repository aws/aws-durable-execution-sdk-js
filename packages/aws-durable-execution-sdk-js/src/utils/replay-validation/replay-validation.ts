import { Operation, OperationType } from "../../types/wire";
import { OperationSubType, ExecutionContext } from "../../types";
import { terminateForUnrecoverableError } from "../termination-helper/termination-helper";
import { NonDeterministicExecutionError } from "../../errors/non-deterministic-error/non-deterministic-error";

/**
 * Checks that an operation about to be replayed is the same operation that was
 * checkpointed at this position. A mismatch means the workflow took a different
 * path than it did on the invocation that produced the checkpoint, so the
 * checkpoint at hand belongs to a different operation and nothing after this point
 * can be trusted.
 *
 * @returns `undefined` when the operation matches its checkpoint. On a mismatch the
 *   execution has already been terminated and a never-resolving promise is returned:
 *   the caller MUST return or await it, so that handler code stops instead of racing
 *   the termination while acting on checkpoint data known to be the wrong operation's
 *   (deserializing another step's result, or re-running a step body for its side
 *   effects). Termination is what turns this into a FAILED invocation carrying the
 *   diagnostic below; the promise only stops the caller from continuing meanwhile.
 */
export const validateReplayConsistency = (
  stepId: string,
  currentOperation: {
    type: OperationType;
    name: string | undefined;
    subType: OperationSubType;
  },
  checkpointData: Operation | undefined,
  context: ExecutionContext,
): Promise<never> | undefined => {
  // Skip validation if no checkpoint data exists or if Type is undefined (first execution)
  if (!checkpointData || !checkpointData.Type) {
    return undefined;
  }

  // Validate operation type
  if (checkpointData.Type !== currentOperation.type) {
    const error = new NonDeterministicExecutionError(
      `Non-deterministic execution detected: Operation type mismatch for step "${stepId}". ` +
        `Expected type "${checkpointData.Type}", but got "${currentOperation.type}". ` +
        `This indicates non-deterministic control flow in your workflow code.`,
    );
    return terminateForUnrecoverableError(context, error, stepId);
  }

  // Validate operation name (including undefined)
  if (checkpointData.Name !== currentOperation.name) {
    const error = new NonDeterministicExecutionError(
      `Non-deterministic execution detected: Operation name mismatch for step "${stepId}". ` +
        `Expected name "${checkpointData.Name ?? "undefined"}", but got "${currentOperation.name ?? "undefined"}". ` +
        `This indicates non-deterministic control flow in your workflow code.`,
    );
    return terminateForUnrecoverableError(context, error, stepId);
  }

  // Validate operation subtype
  if (checkpointData.SubType !== currentOperation.subType) {
    const error = new NonDeterministicExecutionError(
      `Non-deterministic execution detected: Operation subtype mismatch for step "${stepId}". ` +
        `Expected subtype "${checkpointData.SubType}", but got "${currentOperation.subType}". ` +
        `This indicates non-deterministic control flow in your workflow code.`,
    );
    return terminateForUnrecoverableError(context, error, stepId);
  }

  return undefined;
};
