import {
  CheckpointDurableExecutionRequest,
  OperationUpdate,
  Operation,
  OperationStatus,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { ExecutionState } from "../../storage/storage";
import { log } from "../logger/logger";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { hashId } from "../step-id-utils/step-id-utils";
import { EventEmitter } from "events";
import {
  CheckpointUnrecoverableInvocationError,
  CheckpointUnrecoverableExecutionError,
} from "../../errors/checkpoint-errors/checkpoint-errors";
import { DurableLogger } from "../../types/durable-logger";
import { Checkpoint } from "./checkpoint-helper";

export const STEP_DATA_UPDATED_EVENT = "stepDataUpdated";

interface QueuedCheckpoint {
  stepId: string;
  data: Partial<OperationUpdate>;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ActiveOperationsTracker {
  increment(): void;
  decrement(): void;
}

export class CheckpointManager implements Checkpoint {
  private queue: QueuedCheckpoint[] = [];
  private isProcessing = false;
  private currentTaskToken: string;
  private forceCheckpointPromises: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private queueCompletionResolver: (() => void) | null = null;
  private queueCompletionTimeout: NodeJS.Timeout | null = null;
  private readonly MAX_PAYLOAD_SIZE = 750 * 1024; // 750KB in bytes
  private isTerminating = false;
  private static textEncoder = new TextEncoder();

  constructor(
    private durableExecutionArn: string,
    private stepData: Record<string, Operation>,
    private storage: ExecutionState,
    private terminationManager: TerminationManager,
    private activeOperationsTracker: ActiveOperationsTracker | undefined,
    initialTaskToken: string,
    private stepDataEmitter: EventEmitter,
    private logger: DurableLogger,
    private pendingCompletions: Set<string>,
  ) {
    this.currentTaskToken = initialTaskToken;
  }

  setTerminating(): void {
    this.isTerminating = true;
    log("🛑", "Checkpoint manager marked as terminating");
  }

  /**
   * Checks if a step ID or any of its ancestors has a pending completion
   */
  hasPendingAncestorCompletion(stepId: string): boolean {
    let currentHashedId: string | undefined = hashId(stepId);

    while (currentHashedId) {
      if (this.pendingCompletions.has(currentHashedId)) {
        return true;
      }

      const operation: Operation | undefined = this.stepData[currentHashedId];
      currentHashedId = operation?.ParentId;
    }

    return false;
  }

  async forceCheckpoint(): Promise<void> {
    if (this.isTerminating) {
      log("⚠️", "Force checkpoint skipped - termination in progress");
      return new Promise(() => {}); // Never resolves during termination
    }

    return new Promise<void>((resolve, reject) => {
      this.forceCheckpointPromises.push({ resolve, reject });

      if (!this.isProcessing) {
        setImmediate(() => {
          this.processQueue();
        });
      }
    });
  }

  async waitForQueueCompletion(): Promise<void> {
    if (this.queue.length === 0 && !this.isProcessing) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.queueCompletionResolver = resolve;

      // Set a timeout to prevent infinite waiting
      this.queueCompletionTimeout = setTimeout(() => {
        this.queueCompletionResolver = null;
        this.queueCompletionTimeout = null;
        // Clear the queue since it's taking too long
        this.clearQueue();
        reject(new Error("Timeout waiting for checkpoint queue completion"));
      }, 3000); // 3 second timeout
    });
  }

  public clearQueue(): void {
    // Silently clear queue - we're terminating so no need to reject promises
    this.queue = [];
    this.forceCheckpointPromises = [];
    // Resolve any waiting queue completion promises since we're clearing
    this.notifyQueueCompletion();
  }

  // Alias for backward compatibility with Checkpoint interface
  async force(): Promise<void> {
    return this.forceCheckpoint();
  }

  async checkpoint(
    stepId: string,
    data: Partial<OperationUpdate>,
  ): Promise<void> {
    if (this.isTerminating) {
      log("⚠️", "Checkpoint skipped - termination in progress:", { stepId });
      return new Promise(() => {}); // Never resolves during termination
    }

    if (this.activeOperationsTracker) {
      this.activeOperationsTracker.increment();
    }

    return new Promise<void>((resolve, reject) => {
      if (
        data.Action === OperationAction.SUCCEED ||
        data.Action === OperationAction.FAIL
      ) {
        this.pendingCompletions.add(stepId);
      }

      const queuedItem: QueuedCheckpoint = {
        stepId,
        data,
        resolve: () => {
          if (this.activeOperationsTracker) {
            this.activeOperationsTracker.decrement();
          }
          resolve();
        },
        reject: (error: Error) => {
          if (this.activeOperationsTracker) {
            this.activeOperationsTracker.decrement();
          }
          reject(error);
        },
      };

      this.queue.push(queuedItem);

      log("📥", "Checkpoint queued:", {
        stepId,
        queueLength: this.queue.length,
        isProcessing: this.isProcessing,
      });

      if (!this.isProcessing) {
        setImmediate(() => {
          this.processQueue();
        });
      }
    });
  }

  private hasFinishedAncestor(parentId?: string): boolean {
    if (!parentId) {
      return false;
    }

    let currentHashedId: string | undefined = hashId(parentId);

    while (currentHashedId) {
      const parentOperation: Operation | undefined =
        this.stepData[currentHashedId];

      if (
        parentOperation?.Status === OperationStatus.SUCCEEDED ||
        parentOperation?.Status === OperationStatus.FAILED
      ) {
        return true;
      }

      currentHashedId = parentOperation?.ParentId;
    }

    return false;
  }

  private classifyCheckpointError(
    error: unknown,
  ):
    | CheckpointUnrecoverableInvocationError
    | CheckpointUnrecoverableExecutionError {
    const originalError =
      error instanceof Error ? error : new Error(String(error));

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

    if (
      statusCode &&
      statusCode >= 400 &&
      statusCode < 500 &&
      statusCode !== 429
    ) {
      return new CheckpointUnrecoverableExecutionError(
        `Checkpoint failed: ${errorMessage}`,
        originalError,
      );
    }

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

    if (!hasQueuedItems && !hasForceRequests) {
      return;
    }

    this.isProcessing = true;

    const batch: QueuedCheckpoint[] = [];
    let skippedCount = 0;
    const baseSize = this.currentTaskToken.length + 100;
    let currentSize = baseSize;

    while (this.queue.length > 0) {
      const nextItem = this.queue[0];
      const itemSize = CheckpointManager.textEncoder.encode(
        JSON.stringify(nextItem),
      ).length;

      if (currentSize + itemSize > this.MAX_PAYLOAD_SIZE && batch.length > 0) {
        break;
      }

      this.queue.shift();

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
      if (batch.length > 0 || this.forceCheckpointPromises.length > 0) {
        await this.processBatch(batch);
      }

      batch.forEach((item) => {
        if (
          item.data.Action === OperationAction.SUCCEED ||
          item.data.Action === OperationAction.FAIL
        ) {
          this.pendingCompletions.delete(item.stepId);
        }
        item.resolve();
      });

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

      const checkpointError = this.classifyCheckpointError(error);

      // Clear remaining queue silently - we're terminating
      this.clearQueue();

      this.terminationManager.terminate({
        reason: TerminationReason.CHECKPOINT_FAILED,
        message: checkpointError.message,
        error: checkpointError,
      });
    } finally {
      this.isProcessing = false;

      if (this.queue.length > 0) {
        setImmediate(() => {
          this.processQueue();
        });
      } else {
        // Queue is empty and processing is done - notify all waiting promises
        this.notifyQueueCompletion();
      }
    }
  }

  private notifyQueueCompletion(): void {
    if (this.queueCompletionResolver) {
      if (this.queueCompletionTimeout) {
        clearTimeout(this.queueCompletionTimeout);
        this.queueCompletionTimeout = null;
      }
      this.queueCompletionResolver();
      this.queueCompletionResolver = null;
    }
  }

  private async processBatch(batch: QueuedCheckpoint[]): Promise<void> {
    const updates: OperationUpdate[] = batch.map((item) => {
      const hashedStepId = hashId(item.stepId);

      const update = {
        Type: item.data.Type || "STEP",
        Action: item.data.Action || "START",
        ...item.data,
        Id: hashedStepId,
        ...(item.data.ParentId && { ParentId: hashId(item.data.ParentId) }),
      };

      return update;
    });

    const checkpointData: CheckpointDurableExecutionRequest = {
      DurableExecutionArn: this.durableExecutionArn,
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

    const response = await this.storage.checkpoint(checkpointData, this.logger);

    if (response.CheckpointToken) {
      this.currentTaskToken = response.CheckpointToken;
    }

    if (response.NewExecutionState?.Operations) {
      this.updateStepDataFromCheckpointResponse(
        response.NewExecutionState.Operations,
      );
    }
  }

  private updateStepDataFromCheckpointResponse(operations: Operation[]): void {
    log("🔄", "Updating stepData from checkpoint response:", {
      operationCount: operations.length,
      operationIds: operations.map((op) => op.Id).filter(Boolean),
    });

    operations.forEach((operation) => {
      if (operation.Id) {
        this.stepData[operation.Id] = operation;

        log("📝", "Updated stepData entry:", operation);

        this.stepDataEmitter.emit(STEP_DATA_UPDATED_EVENT, operation.Id);
      }
    });

    log("✅", "StepData update completed:", {
      totalStepDataEntries: Object.keys(this.stepData).length,
    });
  }

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
