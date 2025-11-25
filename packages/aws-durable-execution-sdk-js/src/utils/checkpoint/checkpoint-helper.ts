import { CheckpointManager } from "./checkpoint-manager";
import { CheckpointFunction } from "../../testing/mock-checkpoint";
import { OperationUpdate } from "@aws-sdk/client-lambda";

export type CheckpointLike = CheckpointManager | CheckpointFunction;

export const callCheckpoint = async (
  checkpoint: CheckpointLike,
  stepId: string,
  data: Partial<OperationUpdate>
): Promise<void> => {
  if (typeof checkpoint === 'function') {
    return checkpoint(stepId, data);
  } else {
    return checkpoint.checkpoint(stepId, data);
  }
};
