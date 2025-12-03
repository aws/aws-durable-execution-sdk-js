import { CheckpointManager } from "../utils/checkpoint/checkpoint-manager";
import { OperationUpdate } from "@aws-sdk/client-lambda";
import { DurableExecutionClient } from "../types/durable-execution";
import { TerminationManager } from "../termination-manager/termination-manager";
import { DurableLogger } from "../types/durable-logger";
import { EventEmitter } from "events";

export class MockCheckpointManager extends CheckpointManager {
  public checkpointCalls: Array<{
    stepId: string;
    data: Partial<OperationUpdate>;
  }> = [];
  public forceCheckpointCalls: number = 0;
  public setTerminatingCalls: number = 0;

  constructor() {
    // Create a minimal mock - pass empty/mock values for required constructor params
    super(
      "mock-arn",
      {},
      {} as DurableExecutionClient,
      {} as TerminationManager,
      "mock-token",
      {} as EventEmitter,
      {} as DurableLogger,
      new Set<string>(),
    );
  }

  async checkpoint(
    stepId: string,
    data: Partial<OperationUpdate>,
  ): Promise<void> {
    this.checkpointCalls.push({ stepId, data });
    return Promise.resolve();
  }

  async forceCheckpoint(): Promise<void> {
    this.forceCheckpointCalls++;
    return Promise.resolve();
  }

  setTerminating(): void {
    this.setTerminatingCalls++;
  }

  hasPendingAncestorCompletion(_stepId: string): boolean {
    return false;
  }

  getQueueStatus(): { queueLength: number; isProcessing: boolean } {
    return { queueLength: 0, isProcessing: false };
  }
}

export const createMockCheckpointManager = (): MockCheckpointManager =>
  new MockCheckpointManager();
