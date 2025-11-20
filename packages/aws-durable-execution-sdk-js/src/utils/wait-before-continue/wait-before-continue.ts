import { ExecutionContext } from "../../types";
import {
  createCheckpoint,
  STEP_DATA_UPDATED_EVENT,
} from "../checkpoint/checkpoint";
import { EventEmitter } from "events";
import { OPERATIONS_COMPLETE_EVENT } from "../constants/constants";
import { hashId } from "../step-id-utils/step-id-utils";

export interface WaitBeforeContinueOptions {
  /** Check if operations are still running */
  checkHasRunningOperations: boolean;
  /** Check if step status has changed */
  checkStepStatus: boolean;
  /** Check if timer has expired */
  checkTimer: boolean;
  /** Scheduled end timestamp for timer check */
  scheduledEndTimestamp?: Date | null;
  /** Step ID to get current status */
  stepId: string;
  /** Execution context to get step data */
  context: ExecutionContext;
  /** Function to check if operations are running */
  hasRunningOperations: () => boolean;
  /** EventEmitter for operations completion events */
  operationsEmitter: EventEmitter;
  /** Checkpoint object to force refresh when timer expires */
  checkpoint?: ReturnType<typeof createCheckpoint>;
  /** Function to set callback that will be invoked when promise is awaited */
  onAwaitedChange?: (callback: () => void) => void;
}

export interface WaitBeforeContinueResult {
  reason: "timer" | "operations" | "status" | "timeout";
  timerExpired?: boolean;
}

/**
 * High-level helper that waits for conditions before continuing execution.
 * Uses event-driven approach for both operations completion and status changes.
 */
export async function waitBeforeContinue(
  options: WaitBeforeContinueOptions,
): Promise<WaitBeforeContinueResult> {
  const {
    checkHasRunningOperations,
    checkStepStatus,
    checkTimer,
    scheduledEndTimestamp,
    stepId,
    context,
    hasRunningOperations,
    operationsEmitter,
    checkpoint,
    onAwaitedChange,
  } = options;

  const promises: Promise<WaitBeforeContinueResult>[] = [];
  const timers: NodeJS.Timeout[] = [];
  const cleanupFns: (() => void)[] = [];

  // Cleanup function to clear all timers and listeners
  const cleanup = (): void => {
    timers.forEach((timer) => clearTimeout(timer));
    cleanupFns.forEach((fn) => fn());
  };

  // Timer promise - resolves when scheduled time is reached
  if (checkTimer && scheduledEndTimestamp) {
    const timerPromise = new Promise<WaitBeforeContinueResult>((resolve) => {
      const timeLeft = Number(scheduledEndTimestamp) - Date.now();
      if (timeLeft > 0) {
        const timer = setTimeout(
          () => resolve({ reason: "timer", timerExpired: true }),
          timeLeft,
        );
        timers.push(timer);
      } else {
        resolve({ reason: "timer", timerExpired: true });
      }
    });
    promises.push(timerPromise);
  }

  // Operations promise - event-driven approach
  if (checkHasRunningOperations) {
    const operationsPromise = new Promise<WaitBeforeContinueResult>(
      (resolve) => {
        if (!hasRunningOperations()) {
          resolve({ reason: "operations" });
        } else {
          // Event-driven: listen for completion event
          const handler = (): void => {
            resolve({ reason: "operations" });
          };
          operationsEmitter.once(OPERATIONS_COMPLETE_EVENT, handler);
          cleanupFns.push(() =>
            operationsEmitter.off(OPERATIONS_COMPLETE_EVENT, handler),
          );
        }
      },
    );
    promises.push(operationsPromise);
  }

  // Step status promise - event-driven approach
  if (checkStepStatus) {
    const originalStatus = context.getStepData(stepId)?.Status;
    const hashedStepId = hashId(stepId);
    const stepStatusPromise = new Promise<WaitBeforeContinueResult>(
      (resolve) => {
        // Check if status already changed
        const currentStatus = context.getStepData(stepId)?.Status;
        if (originalStatus !== currentStatus) {
          resolve({ reason: "status" });
        } else {
          // Event-driven: listen for step data updates
          const handler = (updatedStepId: string): void => {
            if (updatedStepId === hashedStepId) {
              const newStatus = context.getStepData(stepId)?.Status;
              if (originalStatus !== newStatus) {
                resolve({ reason: "status" });
              }
            }
          };
          operationsEmitter.on(STEP_DATA_UPDATED_EVENT, handler);
          cleanupFns.push(() =>
            operationsEmitter.off(STEP_DATA_UPDATED_EVENT, handler),
          );
        }
      },
    );
    promises.push(stepStatusPromise);
  }

  // Awaited change promise - resolves when the callback we set is invoked
  // Note: This is safe from race conditions because waitBeforeContinue is called
  // during Phase 1 execution (inside stepHandler), which happens BEFORE the user
  // can await the DurablePromise. The callback is registered before it can be invoked.
  if (onAwaitedChange) {
    const awaitedChangePromise = new Promise<WaitBeforeContinueResult>(
      (resolve) => {
        // Register a callback that will be invoked when the promise is awaited
        onAwaitedChange(() => {
          resolve({ reason: "status" });
        });
      },
    );
    promises.push(awaitedChangePromise);
  }

  // If no conditions provided, return immediately
  if (promises.length === 0) {
    return { reason: "timeout" };
  }

  // Wait for any condition to be met, then cleanup timers and listeners
  const result = await Promise.race(promises);
  cleanup();

  // If timer expired, force checkpoint to get fresh data from API
  if (result.reason === "timer" && result.timerExpired && checkpoint) {
    await checkpoint.force();
  }

  return result;
}
