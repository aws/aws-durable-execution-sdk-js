import {
  CheckpointDurableExecutionRequest,
  OperationUpdate,
  Operation,
  OperationStatus,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { ExecutionContext, Logger } from "../../types";
import { log } from "../logger/logger";
import { TerminationReason } from "../../termination-manager/types";
import { hashId } from "../step-id-utils/step-id-utils";
import { EventEmitter } from "events";
import {
  CheckpointUnrecoverableInvocationError,
  CheckpointUnrecoverableExecutionError,
} from "../../errors/checkpoint-errors/checkpoint-errors";

export const STEP_DATA_UPDATED_EVENT = "stepDataUpdated";

interface QueuedCheckpoint {
  stepId: string;
  data: Partial<OperationUpdate>;
  resolve: () => void;
  reject: (error: Error) => void;
}

class CheckpointHandler {
  private queue: QueuedCheckpoint[] = [];
  private isProcessing = false;
  private currentTaskToken: string;
  private forceCheckpointPromises: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly MAX_PAYLOAD_SIZE = 750 * 1024; // 750KB in bytes
  private isTerminating = false;
  private pendingCompletions = new Set<string>(); // Track stepIds with pending SUCCEED/FAIL
  private static textEncoder = new TextEncoder();

  constructor(
    private context: ExecutionContext,
    initialTaskToken: string,
    private stepDataEmitter: EventEmitter,
    private logger?: Logger,
  ) {
    this.currentTaskToken = initialTaskToken;
  }

  setTerminating(): void {
    this.isTerminating = true;
    log("🛑", "Checkpoint handler marked as terminating");
  }

  async forceCheckpoint(): Promise<void> {
    if (this.isTerminating) {
      log("⚠️", "Force checkpoint skipped - termination in progress");
      return new Promise(() => {}); // Never resolves during termination
    }

    return new Promise<void>((resolve, reject) => {
      this.forceCheckpointPromises.push({ resolve, reject });

      // Only trigger processing if not already processing
      // If processing, the current batch will resolve these promises
      if (!this.isProcessing) {
        setImmediate(() => {
          this.processQueue();
        });
      }
    });
  }

  async checkpoint(
    stepId: string,
    data: Partial<OperationUpdate>,
  ): Promise<void> {
    if (this.isTerminating) {
      log("⚠️", "Checkpoint skipped - termination in progress:", { stepId });
      return new Promise(() => {}); // Never resolves during termination
    }

    return new Promise<void>((resolve, reject) => {
      // Track pending completions for ancestor checking
      if (
        data.Action === OperationAction.SUCCEED ||
        data.Action === OperationAction.FAIL
      ) {
        this.pendingCompletions.add(stepId);
      }

      const queuedItem: QueuedCheckpoint = {
        stepId,
        data,
        resolve,
        reject,
      };

      this.queue.push(queuedItem);

      log("📥", "Checkpoint queued:", {
        stepId,
        queueLength: this.queue.length,
        isProcessing: this.isProcessing,
      });

      // Process immediately if not already processing
      if (!this.isProcessing) {
        // Use setImmediate to process in the next tick to allow other synchronous operations to complete
        setImmediate(() => {
          this.processQueue();
        });
      }
    });
  }

  /**
   * Checks if any ancestor operation in the parent chain has finished (SUCCEEDED or FAILED).
   *
   * This is critical for maintaining deterministic workflow replay. When an ancestor operation
   * completes, its outcome is finalized and checkpointed. If we allow child operations to
   * checkpoint after their ancestor has finished, those child operations could be replayed
   * and potentially change the ancestor's result, breaking determinism.
   *
   * For example, if a parallel branch completes and then a child operation within that branch
   * tries to checkpoint, replaying that checkpoint could alter the parallel operation's outcome,
   * leading to non-deterministic behavior across executions.
   *
   * @param parentId - The parent operation ID to start checking from (unhashed)
   * @returns true if any ancestor has status SUCCEEDED or FAILED, false otherwise
   */
  private hasFinishedAncestor(parentId?: string): boolean {
    if (!parentId) {
      return false;
    }

    // Start with the unhashed parent ID, hash it to look up in _stepData
    let currentHashedId: string | undefined = hashId(parentId);

    while (currentHashedId) {
      const parentOperation: Operation | undefined =
        this.context._stepData[currentHashedId];

      if (
        parentOperation?.Status === OperationStatus.SUCCEEDED ||
        parentOperation?.Status === OperationStatus.FAILED
      ) {
        return true;
      }

      // ParentId in the operation is already hashed
      currentHashedId = parentOperation?.ParentId;
    }

    return false;
  }

  /**
   * Classifies checkpoint errors based on AWS SDK error response
   * - 4xx with "Invalid Checkpoint Token" -\> CheckpointUnrecoverableInvocationError
   * - Other 4xx -\> CheckpointUnrecoverableExecutionError
   * - 5xx -\> CheckpointUnrecoverableInvocationError
   */
  private classifyCheckpointError(
    error: unknown,
  ):
    | CheckpointUnrecoverableInvocationError
    | CheckpointUnrecoverableExecutionError {
    const originalError =
      error instanceof Error ? error : new Error(String(error));

    // Check if it's an AWS SDK error with status code
    const awsError = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
      message?: string;
    };

    const statusCode = awsError.$metadata?.httpStatusCode;
    const errorName = awsError.name;
    const errorMessage = awsError.message || originalError.message;

    log("🔍", "Classifying checkpoint error:", {
      statusCode,
      errorName,
      errorMessage,
    });

    // 4xx error with InvalidParameterValueException and "Invalid Checkpoint Token" message
    if (
      statusCode &&
      statusCode >= 400 &&
      statusCode < 500 &&
      errorName === "InvalidParameterValueException" &&
      errorMessage.startsWith("Invalid Checkpoint Token")
    ) {
      return new CheckpointUnrecoverableInvocationError(
        `Checkpoint failed: ${errorMessage}`,
        originalError,
      );
    }

    // Other 4xx errors
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return new CheckpointUnrecoverableExecutionError(
        `Checkpoint failed: ${errorMessage}`,
        originalError,
      );
    }

    // 5xx errors or unknown errors (treat as invocation errors)
    return new CheckpointUnrecoverableInvocationError(
      `Checkpoint failed: ${errorMessage}`,
      originalError,
    );
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    const hasQueuedItems = this.queue.length > 0;
    const hasForceRequests = this.forceCheckpointPromises.length > 0;

    // Only proceed if we have actual queue items OR force requests with no ongoing processing
    if (!hasQueuedItems && !hasForceRequests) {
      return;
    }

    this.isProcessing = true;

    // Pick items from queue up to size limit
    const batch: QueuedCheckpoint[] = [];
    let skippedCount = 0;
    const baseSize = this.currentTaskToken.length + 100; // Base payload overhead
    let currentSize = baseSize;

    while (this.queue.length > 0) {
      const nextItem = this.queue[0];
      const itemSize = CheckpointHandler.textEncoder.encode(
        JSON.stringify(nextItem),
      ).length;

      if (currentSize + itemSize > this.MAX_PAYLOAD_SIZE && batch.length > 0) {
        break;
      }

      this.queue.shift();

      // Check if ancestor is finished - skip if so
      if (this.hasFinishedAncestor(nextItem.data.ParentId)) {
        log("⚠️", "Checkpoint skipped - ancestor finished:", {
          stepId: nextItem.stepId,
          parentId: nextItem.data.ParentId,
        });
        skippedCount++;
        continue;
      }

      batch.push(nextItem);
      currentSize += itemSize;
    }

    log("🔄", "Processing checkpoint batch:", {
      batchSize: batch.length,
      remainingInQueue: this.queue.length,
      estimatedSize: currentSize,
      maxSize: this.MAX_PAYLOAD_SIZE,
    });

    try {
      // Only call checkpoint API if we have actual updates OR force requests
      if (batch.length > 0 || this.forceCheckpointPromises.length > 0) {
        await this.processBatch(batch);
      }

      // Remove processed items from pendingCompletions
      batch.forEach((item) => {
        if (
          item.data.Action === OperationAction.SUCCEED ||
          item.data.Action === OperationAction.FAIL
        ) {
          this.pendingCompletions.delete(item.stepId);
        }
        item.resolve();
      });

      // Collect and resolve ALL force promises after checkpoint completes
      // This ensures force requests that came in during processing are included
      const forcePromises = this.forceCheckpointPromises.splice(0);
      forcePromises.forEach((promise) => {
        promise.resolve();
      });

      log("✅", "Checkpoint batch processed successfully:", {
        batchSize: batch.length,
        skippedCount,
        forceRequests: forcePromises.length,
        newTaskToken: this.currentTaskToken,
      });
    } catch (error) {
      log("❌", "Checkpoint batch failed:", {
        batchSize: batch.length,
        error,
      });

      // Classify the error and terminate with appropriate error type
      const checkpointError = this.classifyCheckpointError(error);

      // Terminate execution on checkpoint failure with detailed message
      // No need to reject individual promises - termination will handle cleanup
      this.context.terminationManager.terminate({
        reason: TerminationReason.CHECKPOINT_FAILED,
        message: checkpointError.message,
        error: checkpointError,
      });
    } finally {
      this.isProcessing = false;

      // If there are more items in the queue, process them immediately
      if (this.queue.length > 0) {
        setImmediate(() => {
          this.processQueue();
        });
      }
    }
  }

  private async processBatch(batch: QueuedCheckpoint[]): Promise<void> {
    // Convert queued items to OperationUpdates with hashed IDs
    const updates: OperationUpdate[] = batch.map((item) => {
      const hashedStepId = hashId(item.stepId);

      const update = {
        Type: item.data.Type || "STEP", // Default type if not specified
        Action: item.data.Action || "START", // Default action if not specified
        ...item.data,
        // Override with hashed IDs AFTER spreading item.data to prevent override
        Id: hashedStepId, // Hash the stepId before sending to API
        // Hash ParentId if it exists
        ...(item.data.ParentId && { ParentId: hashId(item.data.ParentId) }),
      };

      return update;
    });

    const checkpointData: CheckpointDurableExecutionRequest = {
      DurableExecutionArn: this.context.durableExecutionArn,
      CheckpointToken: this.currentTaskToken,
      Updates: updates,
    };

    log("⏺️", "Creating checkpoint batch:", {
      batchSize: updates.length,
      checkpointToken: this.currentTaskToken,
      updates: updates.map((u) => ({
        Id: u.Id,
        Action: u.Action,
        Type: u.Type,
      })),
    });

    const response = await this.context.state.checkpoint(
      this.currentTaskToken,
      checkpointData,
      this.logger,
    );

    if (response.CheckpointToken) {
      this.currentTaskToken = response.CheckpointToken;
    }

    // Update context.stepData with new execution state from checkpoint response
    if (response.NewExecutionState?.Operations) {
      this.updateStepDataFromCheckpointResponse(
        response.NewExecutionState.Operations,
      );
    }
  }

  /**
   * Updates context.stepData with operations returned from checkpoint API
   * Operations from API already have hashed IDs, so we store them as-is
   * @param operations - Array of operations from checkpoint response
   */
  private updateStepDataFromCheckpointResponse(operations: Operation[]): void {
    log("🔄", "Updating stepData from checkpoint response:", {
      operationCount: operations.length,
      operationIds: operations.map((op) => op.Id).filter(Boolean),
    });

    // Merge new operations into existing stepData
    // IDs from backend are already hashed, store directly
    operations.forEach((operation) => {
      if (operation.Id) {
        // Store operation with the already-hashed ID from backend
        this.context._stepData[operation.Id] = operation;

        log("📝", "Updated stepData entry:", operation);

        // Emit event for this step's data update
        this.stepDataEmitter.emit(STEP_DATA_UPDATED_EVENT, operation.Id);
      }
    });

    log("✅", "StepData update completed:", {
      totalStepDataEntries: Object.keys(this.context._stepData).length,
    });
  }

  // Method to get current queue status (useful for testing and debugging)
  getQueueStatus(): {
    queueLength: number;
    isProcessing: boolean;
  } {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
    };
  }
}

// Singleton checkpoint handler
let singletonCheckpointHandler: CheckpointHandler | null = null;

export const createCheckpoint = (
  context: ExecutionContext,
  taskToken: string,
  stepDataEmitter: EventEmitter,
  logger?: Logger,
): {
  (stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  force(): Promise<void>;
  setTerminating(): void;
} => {
  // Return existing handler if it exists, otherwise create new one
  if (!singletonCheckpointHandler) {
    singletonCheckpointHandler = new CheckpointHandler(
      context,
      taskToken,
      stepDataEmitter,
      logger,
    );
  }

  const checkpoint = async (
    stepId: string,
    data: Partial<OperationUpdate>,
  ): Promise<void> => {
    return await singletonCheckpointHandler!.checkpoint(stepId, data);
  };

  checkpoint.force = async (): Promise<void> => {
    return await singletonCheckpointHandler!.forceCheckpoint();
  };

  checkpoint.setTerminating = (): void => {
    singletonCheckpointHandler!.setTerminating();
  };

  return checkpoint;
};

export const deleteCheckpoint = (): void => {
  singletonCheckpointHandler = null;
};

export const setCheckpointTerminating = (): void => {
  if (singletonCheckpointHandler) {
    singletonCheckpointHandler.setTerminating();
  }
};

// Export the CheckpointHandler class for testing purposes
export { CheckpointHandler };
