import { ExecutionContext } from "../../types";
import { createCheckpoint } from "../checkpoint/checkpoint";

export interface WaitBeforeContinueOptions {
  /** Check if operations are still running */
  checkHasRunningOperations: boolean;
  /** Check if step status has changed */
  checkStepStatus: boolean;
  /** Check if timer has expired */
  checkTimer: boolean;
  /** Scheduled timestamp for timer check */
  scheduledTimestamp?: Date | null;
  /** Step ID to get current status */
  stepId: string;
  /** Execution context to get step data */
  context: ExecutionContext;
  /** Function to check if operations are running */
  hasRunningOperations: () => boolean;
  /** Checkpoint object to force refresh when timer expires */
  checkpoint?: ReturnType<typeof createCheckpoint>;
  /** Polling interval in ms (default: 100) */
  pollingInterval?: number;
}

export interface WaitBeforeContinueResult {
  reason: "timer" | "operations" | "status" | "timeout";
  timerExpired?: boolean;
}

/**
 * High-level helper that waits for conditions before continuing execution.
 * Hides all the complexity of checking timers, operations, and status changes.
 *
 * TODO: The next 3 promise use setTimeout to re-evaluate the latest status.
 * Better way is a event driven way that we will implement separately
 * Cons of our current implementation (polling)
 *   • ❌ CPU overhead from constant polling
 *   • ❌ 100ms delay in detecting changes
 *   • ❌ Not scalable with many concurrent operations
 */
export async function waitBeforeContinue(
  options: WaitBeforeContinueOptions,
): Promise<WaitBeforeContinueResult> {
  const {
    checkHasRunningOperations,
    checkStepStatus,
    checkTimer,
    scheduledTimestamp,
    stepId,
    context,
    hasRunningOperations,
    checkpoint,
    pollingInterval = 100,
  } = options;

  const promises: Promise<WaitBeforeContinueResult>[] = [];
  const timers: NodeJS.Timeout[] = [];

  // Cleanup function to clear all timers
  const cleanup = () => {
    timers.forEach((timer) => clearTimeout(timer));
  };

  // Timer promise - resolves when scheduled time is reached
  if (checkTimer && scheduledTimestamp) {
    const timerPromise = new Promise<WaitBeforeContinueResult>((resolve) => {
      const timeLeft = Number(scheduledTimestamp) - Date.now();
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

  // Operations promise - resolves when no operations are running
  if (checkHasRunningOperations) {
    const operationsPromise = new Promise<WaitBeforeContinueResult>(
      (resolve) => {
        const checkOperations = () => {
          if (!hasRunningOperations()) {
            resolve({ reason: "operations" });
          } else {
            const timer = setTimeout(checkOperations, pollingInterval);
            timers.push(timer);
          }
        };
        checkOperations();
      },
    );
    promises.push(operationsPromise);
  }

  // Step status promise - resolves when status changes
  if (checkStepStatus) {
    const originalStatus = context.getStepData(stepId)?.Status;
    const stepStatusPromise = new Promise<WaitBeforeContinueResult>(
      (resolve) => {
        const checkStepStatus = () => {
          const currentStatus = context.getStepData(stepId)?.Status;
          if (originalStatus !== currentStatus) {
            resolve({ reason: "status" });
          } else {
            const timer = setTimeout(checkStepStatus, pollingInterval);
            timers.push(timer);
          }
        };
        checkStepStatus();
      },
    );
    promises.push(stepStatusPromise);
  }

  // If no conditions provided, return immediately
  if (promises.length === 0) {
    return { reason: "timeout" };
  }

  // Wait for any condition to be met, then cleanup timers
  const result = await Promise.race(promises);
  cleanup();

  // If timer expired, force checkpoint to get fresh data from API
  if (result.reason === "timer" && result.timerExpired && checkpoint) {
    await checkpoint.force();
  }

  return result;
}
