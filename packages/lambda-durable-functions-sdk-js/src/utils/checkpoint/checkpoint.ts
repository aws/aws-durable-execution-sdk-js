import {
  CheckpointDurableExecutionRequest,
  OperationUpdate,
  Operation,
} from "@aws-sdk/client-lambda";
import { ExecutionContext } from "../../types";
import { log } from "../logger/logger";
import { CheckpointFailedError } from "../../errors/checkpoint-errors/checkpoint-errors";
import { TerminationReason } from "../../termination-manager/types";
import { hashId } from "../step-id-utils/step-id-utils";

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

  constructor(
    private context: ExecutionContext,
    initialTaskToken: string,
  ) {
    this.currentTaskToken = initialTaskToken;
  }

  async forceCheckpoint(): Promise<void> {
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
    return new Promise<void>((resolve, reject) => {
      const queuedItem: QueuedCheckpoint = {
        stepId,
        data,
        resolve,
        reject,
      };

      this.queue.push(queuedItem);

      log(this.context.isVerbose, "📥", "Checkpoint queued:", {
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
    const baseSize = this.currentTaskToken.length + 100; // Base payload overhead
    let currentSize = baseSize;

    while (this.queue.length > 0) {
      const nextItem = this.queue[0];
      const itemSize = JSON.stringify(nextItem).length;

      if (currentSize + itemSize > this.MAX_PAYLOAD_SIZE && batch.length > 0) {
        break;
      }

      batch.push(this.queue.shift()!);
      currentSize += itemSize;
    }

    log(this.context.isVerbose, "🔄", "Processing checkpoint batch:", {
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

      // Resolve all promises in the batch
      batch.forEach((item) => {
        item.resolve();
      });

      // Collect and resolve ALL force promises after checkpoint completes
      // This ensures force requests that came in during processing are included
      const forcePromises = this.forceCheckpointPromises.splice(0);
      forcePromises.forEach((promise) => {
        promise.resolve();
      });

      log(
        this.context.isVerbose,
        "✅",
        "Checkpoint batch processed successfully:",
        {
          batchSize: batch.length,
          forceRequests: forcePromises.length,
          newTaskToken: this.currentTaskToken,
        },
      );
    } catch (error) {
      log(this.context.isVerbose, "❌", "Checkpoint batch failed:", {
        batchSize: batch.length,
        error,
      });

      // Preserve the original error details
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      const checkpointError = new CheckpointFailedError(
        `Checkpoint batch failed: ${originalError.message}`,
        originalError,
      );

      batch.forEach((item) => {
        item.reject(checkpointError);
      });

      // Reject ALL force promises (including ones added during processing)
      const forcePromises = this.forceCheckpointPromises.splice(0);
      forcePromises.forEach((promise) => {
        promise.reject(checkpointError);
      });

      // Terminate execution on checkpoint failure with detailed message
      this.context.terminationManager.terminate({
        reason: TerminationReason.CHECKPOINT_FAILED,
        message: `Checkpoint batch failed: ${originalError.message}`,
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

    log(this.context.isVerbose, "⏺️", "Creating checkpoint batch:", {
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
   * @param operations Array of operations from checkpoint response
   */
  private updateStepDataFromCheckpointResponse(operations: Operation[]): void {
    log(
      this.context.isVerbose,
      "🔄",
      "Updating stepData from checkpoint response:",
      {
        operationCount: operations.length,
        operationIds: operations.map((op) => op.Id).filter(Boolean),
      },
    );

    // Merge new operations into existing stepData
    // IDs from backend are already hashed, store directly
    operations.forEach((operation) => {
      if (operation.Id) {
        // Store operation with the already-hashed ID from backend
        this.context._stepData[operation.Id] = operation;

        log(this.context.isVerbose, "📝", "Updated stepData entry:", operation);
      }
    });

    log(this.context.isVerbose, "✅", "StepData update completed:", {
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
) => {
  // Return existing handler if it exists, otherwise create new one
  if (!singletonCheckpointHandler) {
    singletonCheckpointHandler = new CheckpointHandler(context, taskToken);
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

  return checkpoint;
};

export const deleteCheckpoint = (): void => {
  singletonCheckpointHandler = null;
};

// Export the CheckpointHandler class for testing purposes
export { CheckpointHandler };
