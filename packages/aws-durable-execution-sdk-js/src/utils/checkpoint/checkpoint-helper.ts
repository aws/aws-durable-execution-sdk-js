import { OperationUpdate } from "@aws-sdk/client-lambda";

export interface Checkpoint {
  checkpoint(stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  forceCheckpoint?(): Promise<void>;
  force?(): Promise<void>;
  setTerminating?(): void;
  hasPendingAncestorCompletion?(stepId: string): boolean;
}

export const callCheckpoint = async (
  checkpoint: Checkpoint,
  stepId: string,
  data: Partial<OperationUpdate>
): Promise<void> => {
  return checkpoint.checkpoint(stepId, data);
};
