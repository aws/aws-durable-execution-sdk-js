import { EventEmitter } from "events";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";
import { ExecutionContext, DurableLogger } from "./types";
import { createDefaultLogger } from "./utils/logger/default-logger";

export class DurableExecution {
  public readonly checkpointManager: CheckpointManager;
  public readonly stepDataEmitter: EventEmitter;

  constructor(
    executionContext: ExecutionContext,
    checkpointToken: string,
    logger?: DurableLogger,
  ) {
    this.stepDataEmitter = new EventEmitter();
    
    this.checkpointManager = new CheckpointManager(
      executionContext.durableExecutionArn,
      executionContext._stepData,
      executionContext.state,
      executionContext.terminationManager,
      executionContext.activeOperationsTracker,
      checkpointToken,
      this.stepDataEmitter,
      logger || createDefaultLogger(),
    );
  }

  setTerminating(): void {
    this.checkpointManager.setTerminating();
  }
}
