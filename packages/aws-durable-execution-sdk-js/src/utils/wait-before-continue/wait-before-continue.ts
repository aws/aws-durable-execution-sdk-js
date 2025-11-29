import { ExecutionContext } from "../../types";
import { STEP_DATA_UPDATED_EVENT } from "../checkpoint/checkpoint-manager";
import { Checkpoint } from "../checkpoint/checkpoint-helper";
import { EventEmitter } from "events";
import { OPERATIONS_COMPLETE_EVENT } from "../constants/constants";
import { hashId } from "../step-id-utils/step-id-utils";
import { getActiveContext } from "../context-tracker/context-tracker";
import { OperationStatus } from "@aws-sdk/client-lambda";

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
  /** Checkpoint manager for queue status and force refresh */
  checkpoint: Checkpoint;
  /** Function to set callback that will be invoked when promise is awaited */
  onAwaitedChange?: (callback: () => void) => void;
}

export interface WaitBeforeContinueResult {
  timerExpired?: boolean;
  canTerminate: boolean;
}

/**
 * High-level helper that waits for conditions before continuing execution.
 * Uses event-driven approach for both operations completion and status changes.
 */
export async function waitBeforeContinue(
  options: WaitBeforeContinueOptions,
): Promise<WaitBeforeContinueResult> {
  // Add 50ms delay to allow checkpoint coordination without blocking events
  await new Promise((resolve) => setTimeout(resolve, 50));

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

  // Store original status for comparison
  const originalStatus = checkStepStatus
    ? context.getStepData(stepId)?.Status
    : undefined;

  // Track if awaited change has been triggered
  let awaitedChangeTriggered = false;

  // Track if timer expired (for internal checkpoint logic)
  let timerExpired = false;

  // Helper function to calculate canTerminate based on all conditions at resolution time
  const calculateCanTerminate = (): boolean => {
    // Condition 1: Status didn't change (if we're monitoring status)
    if (checkStepStatus && stepId) {
      const currentStatus = context.getStepData(stepId)?.Status;
      if (originalStatus !== currentStatus) {
        return false; // Status changed, continue handler
      }
    }

    // Condition 2: No running operations (if we're monitoring operations)
    if (checkHasRunningOperations && hasRunningOperations()) {
      return false; // Operations running, can't terminate
    }

    // Condition 3: Timer not reached (if we're monitoring timer)
    if (checkTimer && scheduledEndTimestamp) {
      const timerReached = Number(scheduledEndTimestamp) <= Date.now();
      if (timerReached) {
        return false; // Timer reached, should checkpoint.force and continue
      }
    }

    // Condition 4: Awaited change triggered (if we're monitoring awaited changes)
    if (onAwaitedChange && awaitedChangeTriggered) {
      return false; // Promise was awaited, continue handler
    }

    // Condition 5: Check if ancestor has finished (similar to terminate() logic)
    const activeContext = getActiveContext();
    if (activeContext?.parentId) {
      let currentHashedId: string | undefined = hashId(activeContext.parentId);

      while (currentHashedId) {
        const operation = context.getStepData(currentHashedId);
        if (
          operation?.Status === OperationStatus.SUCCEEDED ||
          operation?.Status === OperationStatus.FAILED
        ) {
          return false; // Ancestor finished, continue handler to let ancestor checking handle it
        }
        currentHashedId = operation?.ParentId;
      }
    }

    return true; // All conditions met, can terminate
  };

  // Early return if no running operations and we're checking for them
  if (checkHasRunningOperations && !hasRunningOperations()) {
    return { canTerminate: calculateCanTerminate() };
  }

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
        const timer = setTimeout(() => {
          timerExpired = true;
          resolve({
            timerExpired: true,
            canTerminate: calculateCanTerminate(),
          });
        }, timeLeft);
        timers.push(timer);
      } else {
        timerExpired = true;
        resolve({
          timerExpired: true,
          canTerminate: calculateCanTerminate(),
        });
      }
    });
    promises.push(timerPromise);
  }

  // Operations promise - event-driven approach
  if (checkHasRunningOperations) {
    const operationsPromise = new Promise<WaitBeforeContinueResult>(
      (resolve) => {
        if (!hasRunningOperations()) {
          resolve({
            canTerminate: calculateCanTerminate(),
          });
        } else {
          // Event-driven: listen for completion event
          const handler = (): void => {
            resolve({
              canTerminate: calculateCanTerminate(),
            });
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
    const hashedStepId = hashId(stepId);
    const stepStatusPromise = new Promise<WaitBeforeContinueResult>(
      (resolve) => {
        // Check if status already changed
        const currentStatus = context.getStepData(stepId)?.Status;
        if (originalStatus !== currentStatus) {
          resolve({ canTerminate: calculateCanTerminate() });
        } else {
          // Event-driven: listen for step data updates
          const handler = (updatedStepId: string): void => {
            if (updatedStepId === hashedStepId) {
              const newStatus = context.getStepData(stepId)?.Status;
              if (originalStatus !== newStatus) {
                resolve({
                  canTerminate: calculateCanTerminate(),
                });
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
          awaitedChangeTriggered = true;
          resolve({ canTerminate: calculateCanTerminate() });
        });
      },
    );
    promises.push(awaitedChangePromise);
  }

  // If no conditions provided, return immediately
  if (promises.length === 0) {
    return { canTerminate: true };
  }

  // Wait for any condition to be met, then cleanup timers and listeners
  const result = await Promise.race(promises);
  cleanup();

  // If timer expired, force checkpoint to get fresh data from API
  if (timerExpired && result.timerExpired && checkpoint) {
    if (checkpoint.force) {
      await checkpoint.force();
    } else if (checkpoint.forceCheckpoint) {
      await checkpoint.forceCheckpoint();
    }
  }

  return result;
}
