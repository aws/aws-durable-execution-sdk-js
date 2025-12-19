import { CheckpointManager } from "../utils/checkpoint/checkpoint-manager";
import { ExecutionContext, DurableLogger } from "../types";
import { EventEmitter } from "events";

export const createTestCheckpointManager = (
  context: ExecutionContext,
  checkpointToken: string,
  emitter: EventEmitter,
  logger: DurableLogger,
): CheckpointManager => {
  return new CheckpointManager(
    context.durableExecutionArn,
    context._stepData,
    context.durableExecutionClient,
    context.terminationManager,
    checkpointToken,
    emitter,
    logger,
    new Set<string>(),
  );
};
