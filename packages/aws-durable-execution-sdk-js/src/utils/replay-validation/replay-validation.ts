import { Operation, OperationType } from "@aws-sdk/client-lambda";
import { OperationSubType, ExecutionContext } from "../../types";
import { terminateForUnrecoverableError } from "../termination-helper/termination-helper";
import { NonDeterministicExecutionError } from "../../errors/non-deterministic-error/non-deterministic-error";

export const validateReplayConsistency = (
  stepId: string,
  currentOperation: {
    type: OperationType;
    name: string | undefined;
    subType: OperationSubType;
  },
  checkpointData: Operation | undefined,
  context: ExecutionContext,
): void => {
  // Skip validation if no checkpoint data exists or if Type is undefined (first execution)
  if (!checkpointData?.Type) {
    return;
  }

  // Validate operation type
  if (checkpointData.Type !== currentOperation.type) {
    const error = new NonDeterministicExecutionError(
      `Non-deterministic execution detected: Operation type mismatch for step "${stepId}". ` +
        `Expected type "${checkpointData.Type}", but got "${currentOperation.type}". ` +
        `This indicates non-deterministic control flow in your workflow code.`,
    );
    terminateForUnrecoverableError(context, error, stepId);
  }

  // Validate operation name (including undefined)
  if (checkpointData.Name !== currentOperation.name) {
    const error = new NonDeterministicExecutionError(
      `Non-deterministic execution detected: Operation name mismatch for step "${stepId}". ` +
        `Expected name "${checkpointData.Name ?? "undefined"}", but got "${currentOperation.name ?? "undefined"}". ` +
        `This indicates non-deterministic control flow in your workflow code.`,
    );
    terminateForUnrecoverableError(context, error, stepId);
  }

  // Validate operation subtype
  if (checkpointData.SubType !== currentOperation.subType) {
    const error = new NonDeterministicExecutionError(
      `Non-deterministic execution detected: Operation subtype mismatch for step "${stepId}". ` +
        `Expected subtype "${checkpointData.SubType}", but got "${currentOperation.subType}". ` +
        `This indicates non-deterministic control flow in your workflow code.`,
    );
    terminateForUnrecoverableError(context, error, stepId);
  }
};
