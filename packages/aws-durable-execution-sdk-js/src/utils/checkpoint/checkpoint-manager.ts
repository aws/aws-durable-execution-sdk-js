import {
  CheckpointDurableExecutionRequest,
  OperationUpdate,
  Operation,
  OperationStatus,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { DurableExecutionClient } from "../../types/durable-execution";
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
import {
  OperationLifecycleState,
  OperationInfo,
  OperationMetadata,
} from "../../types";

export const STEP_DATA_UPDATED_EVENT = "stepDataUpdated";

interface QueuedCheckpoint {
  stepId: string;
  data: Partial<OperationUpdate>;
  resolve: () => void;
  reject: (error: Error) => void;
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

  // Operation lifecycle tracking
  private operations = new Map<string, OperationInfo>();

  // Termination cooldown
  private terminationTimer: NodeJS.Timeout | null = null;
  private terminationReason: TerminationReason | null = null;
  private readonly TERMINATION_COOLDOWN_MS = 50;

  constructor(
    private durableExecutionArn: string,
    private stepData: Record<string, Operation>,
    private storage: DurableExecutionClient,
    private terminationManager: TerminationManager,
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

  /**
   * Checks if a step ID or any of its ancestors is already finished
   * (either in stepData as SUCCEEDED/FAILED or in pendingCompletions)
   */
  private hasFinishedAncestor(
    stepId: string,
    data: Partial<OperationUpdate>,
  ): boolean {
    // Start with the parent from the operation data, or fall back to stepData
    let currentHashedId: string | undefined = data.ParentId
      ? hashId(data.ParentId)
      : undefined;

    // If no ParentId in operation data, check if step exists in stepData
    if (!currentHashedId) {
      const currentOperation = this.stepData[hashId(stepId)];
      currentHashedId = currentOperation?.ParentId;
    }

    while (currentHashedId) {
      // Check if ancestor has pending completion
      if (this.pendingCompletions.has(currentHashedId)) {
        return true;
      }

      // Check if ancestor is already finished in stepData
      const operation: Operation | undefined = this.stepData[currentHashedId];
      if (
        operation?.Status === OperationStatus.SUCCEEDED ||
        operation?.Status === OperationStatus.FAILED
      ) {
        return true;
      }

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

    // Check if any ancestor is finished - if so, don't checkpoint and don't resolve
    if (this.hasFinishedAncestor(stepId, data)) {
      log("⚠️", "Checkpoint skipped - ancestor already finished:", { stepId });
      return new Promise(() => {}); // Never resolves when ancestor is finished
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
          resolve();
        },
        reject: (error: Error) => {
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

      if (this.hasFinishedAncestor(nextItem.stepId, nextItem.data)) {
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
        // Check if status changed
        const oldStatus = this.stepData[operation.Id]?.Status;
        const newStatus = operation.Status;

        this.stepData[operation.Id] = operation;

        log("📝", "Updated stepData entry:", operation);

        this.stepDataEmitter.emit(STEP_DATA_UPDATED_EVENT, operation.Id);

        // If status changed and we have a waiting promise, resolve it
        if (oldStatus !== newStatus) {
          this.resolveWaitingOperation(operation.Id);
        }
      }
    });

    log("✅", "StepData update completed:", {
      totalStepDataEntries: Object.keys(this.stepData).length,
    });
  }

  private resolveWaitingOperation(hashedStepId: string): void {
    // Find operation by hashed ID in our operations map
    for (const [stepId, op] of this.operations.entries()) {
      if (hashId(stepId) === hashedStepId && op.resolver) {
        log("✅", `Resolving waiting operation ${stepId} due to status change`);
        op.resolver();
        op.resolver = undefined;
        if (op.timer) {
          clearTimeout(op.timer);
          op.timer = undefined;
        }
        break;
      }
    }
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

  // ===== New Lifecycle & Termination Methods =====

  markOperationState(
    stepId: string,
    state: OperationLifecycleState,
    options?: {
      metadata?: OperationMetadata;
      endTimestamp?: Date;
    },
  ): void {
    let op = this.operations.get(stepId);

    if (!op) {
      // First call - create operation
      if (!options?.metadata) {
        throw new Error(`metadata required on first call for ${stepId}`);
      }
      op = {
        stepId,
        state,
        metadata: options.metadata,
        endTimestamp: options.endTimestamp,
      };
      this.operations.set(stepId, op);
    } else {
      // Update existing operation
      op.state = state;
      if (options?.endTimestamp !== undefined) {
        op.endTimestamp = options.endTimestamp;
      }
    }

    // Cleanup if transitioning to COMPLETED
    if (state === OperationLifecycleState.COMPLETED) {
      this.cleanupOperation(stepId);
    }

    // Check if we should terminate
    // Don't check for IDLE_NOT_AWAITED - operation might be awaited later or intentionally not awaited
    if (state !== OperationLifecycleState.IDLE_NOT_AWAITED) {
      this.checkAndTerminate();
    }
  }

  waitForRetryTimer(stepId: string): Promise<void> {
    const op = this.operations.get(stepId);
    if (!op) {
      throw new Error(`Operation ${stepId} not found`);
    }

    if (op.state !== OperationLifecycleState.RETRY_WAITING) {
      throw new Error(
        `Operation ${stepId} must be in RETRY_WAITING state, got ${op.state}`,
      );
    }

    // Start timer with polling
    this.startTimerWithPolling(stepId, op.endTimestamp);

    // Return promise that resolves when status changes
    return new Promise((resolve) => {
      op.resolver = resolve;
    });
  }

  waitForStatusChange(stepId: string): Promise<void> {
    const op = this.operations.get(stepId);
    if (!op) {
      throw new Error(`Operation ${stepId} not found`);
    }

    if (op.state !== OperationLifecycleState.IDLE_AWAITED) {
      throw new Error(
        `Operation ${stepId} must be in IDLE_AWAITED state, got ${op.state}`,
      );
    }

    // Start timer with polling
    this.startTimerWithPolling(stepId, op.endTimestamp);

    // Return promise that resolves when status changes
    return new Promise((resolve) => {
      op.resolver = resolve;
    });
  }

  markOperationAwaited(stepId: string): void {
    const op = this.operations.get(stepId);
    if (!op) {
      log("⚠️", `Cannot mark operation as awaited: ${stepId} not found`);
      return;
    }

    // Transition IDLE_NOT_AWAITED → IDLE_AWAITED
    if (op.state === OperationLifecycleState.IDLE_NOT_AWAITED) {
      op.state = OperationLifecycleState.IDLE_AWAITED;
      log("📍", `Operation marked as awaited: ${stepId}`);
      // Check if we should terminate now that operation is awaited
      this.checkAndTerminate();
    }
  }

  getOperationState(stepId: string): OperationLifecycleState | undefined {
    return this.operations.get(stepId)?.state;
  }

  getAllOperations(): Map<string, OperationInfo> {
    return new Map(this.operations);
  }

  // ===== Private Helper Methods =====

  private cleanupOperation(stepId: string): void {
    const op = this.operations.get(stepId);
    if (!op) return;

    // Clear timer
    if (op.timer) {
      clearTimeout(op.timer);
      op.timer = undefined;
    }

    // Clear resolver
    op.resolver = undefined;
  }

  private cleanupAllOperations(): void {
    for (const op of this.operations.values()) {
      if (op.timer) {
        clearTimeout(op.timer);
        op.timer = undefined;
      }
      op.resolver = undefined;
    }
  }

  private checkAndTerminate(): void {
    // Rule 1: Can't terminate if checkpoint queue is not empty
    if (this.queue.length > 0) {
      this.abortTermination();
      return;
    }

    // Rule 2: Can't terminate if checkpoint is currently processing
    if (this.isProcessing) {
      this.abortTermination();
      return;
    }

    // Rule 3: Can't terminate if there are pending force checkpoint promises
    if (this.forceCheckpointPromises.length > 0) {
      this.abortTermination();
      return;
    }

    const allOps = Array.from(this.operations.values());

    // Rule 4: Can't terminate if any operation is EXECUTING
    const hasExecuting = allOps.some(
      (op) => op.state === OperationLifecycleState.EXECUTING,
    );

    if (hasExecuting) {
      this.abortTermination();
      return;
    }

    // Rule 5: Clean up operations whose ancestors are complete or pending completion
    for (const op of allOps) {
      if (
        op.state === OperationLifecycleState.RETRY_WAITING ||
        op.state === OperationLifecycleState.IDLE_NOT_AWAITED ||
        op.state === OperationLifecycleState.IDLE_AWAITED
      ) {
        if (this.hasPendingAncestorCompletion(op.stepId)) {
          log(
            "🧹",
            `Cleaning up operation with completed ancestor: ${op.stepId}`,
          );
          this.cleanupOperation(op.stepId);
          this.operations.delete(op.stepId);
        }
      }
    }

    // Re-check operations after cleanup
    const remainingOps = Array.from(this.operations.values());

    // Determine if we should terminate
    const hasWaiting = remainingOps.some(
      (op) =>
        op.state === OperationLifecycleState.RETRY_WAITING ||
        op.state === OperationLifecycleState.IDLE_NOT_AWAITED ||
        op.state === OperationLifecycleState.IDLE_AWAITED,
    );

    if (hasWaiting) {
      const reason = this.determineTerminationReason(remainingOps);
      this.scheduleTermination(reason);
    } else {
      this.abortTermination();
    }
  }

  private abortTermination(): void {
    if (this.terminationTimer) {
      clearTimeout(this.terminationTimer);
      this.terminationTimer = null;
      this.terminationReason = null;
      log("🔄", "Termination aborted - conditions changed");
    }
  }

  private scheduleTermination(reason: TerminationReason): void {
    // If already scheduled with same reason, don't reschedule
    if (this.terminationTimer && this.terminationReason === reason) {
      return;
    }

    // Clear any existing timer
    this.abortTermination();

    // Schedule new termination
    this.terminationReason = reason;
    log("⏱️", "Scheduling termination", {
      reason,
      cooldownMs: this.TERMINATION_COOLDOWN_MS,
    });

    this.terminationTimer = setTimeout(() => {
      this.executeTermination(reason);
    }, this.TERMINATION_COOLDOWN_MS);
  }

  private executeTermination(reason: TerminationReason): void {
    log("🛑", "Executing termination after cooldown", { reason });

    // Clear timer
    this.terminationTimer = null;
    this.terminationReason = null;

    // Cleanup all operations before terminating
    this.cleanupAllOperations();

    // Call termination manager directly
    this.terminationManager.terminate({ reason });
  }

  private determineTerminationReason(ops: OperationInfo[]): TerminationReason {
    // Priority: RETRY_SCHEDULED > WAIT_SCHEDULED > CALLBACK_PENDING

    if (
      ops.some(
        (op) =>
          op.state === OperationLifecycleState.RETRY_WAITING &&
          op.metadata.subType === "Step",
      )
    ) {
      return TerminationReason.RETRY_SCHEDULED;
    }

    if (
      ops.some(
        (op) =>
          (op.state === OperationLifecycleState.IDLE_NOT_AWAITED ||
            op.state === OperationLifecycleState.IDLE_AWAITED) &&
          op.metadata.subType === "Wait",
      )
    ) {
      return TerminationReason.WAIT_SCHEDULED;
    }

    return TerminationReason.CALLBACK_PENDING;
  }

  private startTimerWithPolling(stepId: string, endTimestamp?: Date): void {
    const op = this.operations.get(stepId);
    if (!op) return;

    let delay: number;

    if (endTimestamp) {
      // Ensure endTimestamp is a Date object
      const timestamp =
        endTimestamp instanceof Date ? endTimestamp : new Date(endTimestamp);
      // Wait until endTimestamp
      delay = Math.max(0, timestamp.getTime() - Date.now());
    } else {
      // No timestamp, start polling immediately (1 second delay)
      delay = 1000;
    }

    // Initialize poll count and start time for this operation
    if (!op.pollCount) {
      op.pollCount = 0;
      op.pollStartTime = Date.now();
    }

    op.timer = setTimeout(() => {
      this.forceRefreshAndCheckStatus(stepId);
    }, delay);
  }

  private async forceRefreshAndCheckStatus(stepId: string): Promise<void> {
    const op = this.operations.get(stepId);
    if (!op) return;

    // Check if we've exceeded max polling duration (15 minutes)
    const MAX_POLL_DURATION_MS = 15 * 60 * 1000; // 15 minutes
    if (
      op.pollStartTime &&
      Date.now() - op.pollStartTime > MAX_POLL_DURATION_MS
    ) {
      // Stop polling after 15 minutes to prevent indefinite resource consumption.
      // We don't resolve or reject the promise because the handler cannot continue
      // without a status change. The execution will remain suspended until the
      // operation completes or the Lambda times out.
      log(
        "⏱️",
        `Max polling duration (15 min) exceeded for ${stepId}, stopping poll`,
      );
      if (op.timer) {
        clearTimeout(op.timer);
        op.timer = undefined;
      }
      return;
    }

    // Get old status before refresh
    const oldStatus = this.stepData[hashId(stepId)]?.Status;

    // Force checkpoint to refresh state from backend
    await this.forceCheckpoint();

    // Get new status after refresh
    const newStatus = this.stepData[hashId(stepId)]?.Status;

    // Check if status changed
    if (newStatus !== oldStatus) {
      // Status changed, resolve the waiting promise
      log("✅", `Status changed for ${stepId}: ${oldStatus} → ${newStatus}`);
      op.resolver?.();
      op.resolver = undefined;

      // Clear timer
      if (op.timer) {
        clearTimeout(op.timer);
        op.timer = undefined;
      }
    } else {
      // Status not changed yet, poll again with incremental backoff
      // Start at 1s, increase by 1s each poll, max 10s
      op.pollCount = (op.pollCount || 0) + 1;
      const nextDelay = Math.min(op.pollCount * 1000, 10000);

      op.timer = setTimeout(() => {
        this.forceRefreshAndCheckStatus(stepId);
      }, nextDelay);
    }
  }
}
