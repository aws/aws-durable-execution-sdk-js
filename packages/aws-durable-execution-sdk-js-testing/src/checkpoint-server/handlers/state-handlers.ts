import { GetDurableExecutionStateResponse } from "@aws/durable-execution-sdk-js";
import { createExecutionId } from "../utils/tagged-strings";
import { ExecutionManager } from "../storage/execution-manager";

/**
 * The API for GetDurableExecutionState used by the Language SDK and DEX service model.
 */
export function processGetDurableExecutionState(
  durableExecutionArn: string | undefined,
  executionManager: ExecutionManager,
): GetDurableExecutionStateResponse {
  const executionData = executionManager.getCheckpointsByExecution(
    createExecutionId(durableExecutionArn),
  );

  if (!executionData) {
    throw new Error("Execution not found");
  }

  const output: GetDurableExecutionStateResponse = {
    Operations: executionData.getState(),
    NextMarker: undefined,
  };

  return output;
}
