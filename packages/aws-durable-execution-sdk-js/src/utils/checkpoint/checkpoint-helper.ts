import { OperationUpdate } from "@aws-sdk/client-lambda";

export interface Checkpoint {
  checkpoint(stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  forceCheckpoint?(): Promise<void>;
  force?(): Promise<void>;
  setTerminating?(): void;
  hasPendingAncestorCompletion?(stepId: string): boolean;
  waitForQueueCompletion(): Promise<void>;
}
