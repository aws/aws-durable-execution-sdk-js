import { OperationUpdate } from "@aws-sdk/client-lambda";
import { OperationLifecycleState } from "../../types/operation-lifecycle-state";
import {
  OperationMetadata,
  OperationInfo,
} from "../../types/operation-lifecycle";

export interface Checkpoint {
  // ===== Existing Methods (Persistence) =====
  checkpoint(stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  forceCheckpoint?(): Promise<void>;
  force?(): Promise<void>;
  setTerminating?(): void;
  hasPendingAncestorCompletion?(stepId: string): boolean;
  waitForQueueCompletion(): Promise<void>;
  markAncestorFinished(stepId: string): void;

  // ===== New Methods (Lifecycle & Termination) =====

  /**
   * Update operation lifecycle state
   * @param stepId - The operation ID
   * @param state - The new lifecycle state
   * @param options - Optional metadata (required on first call) and endTimestamp
   */
  markOperationState(
    stepId: string,
    state: OperationLifecycleState,
    options?: {
      metadata?: OperationMetadata;
      endTimestamp?: Date;
    },
  ): void;

  /**
   * Wait for retry timer to expire, then poll for status change
   * @param stepId - The operation ID
   */
  waitForRetryTimer(stepId: string): Promise<void>;

  /**
   * Wait for status change (external event like callback, invoke, wait)
   * @param stepId - The operation ID
   */
  waitForStatusChange(stepId: string): Promise<void>;

  /**
   * Mark operation as awaited (IDLE_NOT_AWAITED → IDLE_AWAITED transition)
   * @param stepId - The operation ID
   */
  markOperationAwaited(stepId: string): void;

  /**
   * Get current lifecycle state of an operation
   * @param stepId - The operation ID
   */
  getOperationState(stepId: string): OperationLifecycleState | undefined;

  /**
   * Get all operations (for debugging/testing)
   */
  getAllOperations(): Map<string, OperationInfo>;
}
