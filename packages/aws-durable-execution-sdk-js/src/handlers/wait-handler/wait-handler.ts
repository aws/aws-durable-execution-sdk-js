import {
  ExecutionContext,
  OperationSubType,
  Duration,
  OperationLifecycleState,
  DurableExecutionMode,
} from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { durationToSeconds } from "../../utils/duration/duration";
import { DurablePromise } from "../../types/durable-promise";
import {
  withWaitSpan,
  endAllActiveParentSpans,
} from "../../utils/otel/otel-instrumentation";
import { trace } from "@opentelemetry/api";

export const createWaitHandler = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
  createStepId: () => string,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
  getDurableExecutionMode?: () => DurableExecutionMode,
): {
  (name: string, duration: Duration): DurablePromise<void>;
  (duration: Duration): DurablePromise<void>;
} => {
  function waitHandler(name: string, duration: Duration): DurablePromise<void>;
  function waitHandler(duration: Duration): DurablePromise<void>;
  function waitHandler(
    nameOrDuration: string | Duration,
    duration?: Duration,
  ): DurablePromise<void> {
    const isNameFirst = typeof nameOrDuration === "string";
    const actualName = isNameFirst ? nameOrDuration : undefined;
    const actualDuration = isNameFirst ? duration! : nameOrDuration;
    const actualSeconds = durationToSeconds(actualDuration);
    const stepId = createStepId();

    // Phase 1: Start wait operation
    let isCompleted = false;
    // Track whether to skip span creation on replay
    // - If we're still in ReplayMode after checkAndUpdateReplayMode(), it means there are more
    //   operations to replay after this wait, so this wait's span was already emitted in a previous invocation
    // - If we transition to ExecutionMode, this is the first invocation where we complete this wait,
    //   so we should create the span
    let skipSpanCreation = false;

    const phase1Promise = (async (): Promise<void> => {
      log("⏲️", "Wait phase 1:", {
        stepId,
        name: actualName,
        seconds: actualSeconds,
      });

      let stepData = context.getStepData(stepId);

      // Validate replay consistency
      validateReplayConsistency(
        stepId,
        {
          type: OperationType.WAIT,
          name: actualName,
          subType: OperationSubType.WAIT,
        },
        stepData,
        context,
      );

      // Check if already completed
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Wait already completed:", { stepId });
        checkAndUpdateReplayMode?.();

        // After checkAndUpdateReplayMode(), check if we're still in ReplayMode
        // If still in ReplayMode, there are more operations to replay, meaning this wait
        // was completed in a previous invocation and its span was already emitted
        const currentMode = getDurableExecutionMode?.();
        if (currentMode === DurableExecutionMode.ReplayMode) {
          skipSpanCreation = true;
          log("⏭️", "Wait in full replay mode, will skip span creation:", {
            stepId,
          });
        }

        // Mark as completed
        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name: actualName,
              type: OperationType.WAIT,
              subType: OperationSubType.WAIT,
              parentId,
            },
          },
        );

        isCompleted = true;
        return;
      }

      // Start wait if not already started
      if (!stepData) {
        await checkpoint.checkpoint(stepId, {
          Id: stepId,
          ParentId: parentId,
          Action: OperationAction.START,
          SubType: OperationSubType.WAIT,
          Type: OperationType.WAIT,
          Name: actualName,
          WaitOptions: {
            WaitSeconds: actualSeconds,
          },
        });
      }

      // Refresh stepData after checkpoint
      stepData = context.getStepData(stepId);

      // Mark as IDLE_NOT_AWAITED (phase 1 complete, not awaited yet)
      checkpoint.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId,
            name: actualName,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
            parentId,
          },
          endTimestamp: stepData?.WaitDetails?.ScheduledEndTimestamp,
        },
      );

      log("✅", "Wait phase 1 complete:", { stepId });
    })();

    // Prevent unhandled rejection
    phase1Promise.catch(() => {});

    // Phase 2: Wait for completion
    return new DurablePromise(async () => {
      // Wait for phase 1
      await phase1Promise;

      // If already completed AND we should skip span creation (full replay mode)
      // This prevents new spans from being generated on subsequent replays
      // But allows span creation on the first replay (when transitioning from replay to execution mode)
      if (isCompleted && skipSpanCreation) {
        log(
          "⏭️",
          "Wait already completed (full replay), skipping span creation:",
          { stepId },
        );
        return;
      }

      // If already completed but NOT in full replay mode, we still create a span
      // This happens on the first invocation after the wait completes
      if (isCompleted) {
        log("⏭️", "Wait already completed (first replay), creating span:", {
          stepId,
        });
      }

      // Get stepData for OTEL instrumentation (needed for StartTimestamp)
      const stepData = context.getStepData(stepId);

      // Wrap execution with OTEL span
      return await withWaitSpan(
        stepId,
        actualName,
        stepData,
        actualSeconds,
        async () => {
          // If already completed (first replay), just return - the span will still be created and ended
          // This creates the span to record the wait duration without re-executing the wait logic
          if (isCompleted) {
            log("⏲️", "Wait already completed, span-only mode:", { stepId });
            return;
          }

          log("⏲️", "Wait phase 2:", { stepId });

          // Mark as awaited
          checkpoint.markOperationAwaited(stepId);

          // CRITICAL: Recursively end all active parent spans BEFORE calling waitForStatusChange,
          // which will freeze the Lambda runtime. This ensures all nested spans (e.g.,
          // child context -> parallel -> wait) are ended and exported before freezing.
          // The wait span itself will be ended after waitForStatusChange returns (in the next invocation).
          //
          // The issue: If a wait is called inside nested contexts (e.g., child context -> parallel -> wait),
          // all parent spans are still active. When waitForStatusChange freezes the runtime, these
          // parent spans' span.end() never get called because the functions haven't returned yet.
          // Solution: Recursively end all active parent spans (except the wait span) before freezing.
          const endedSpanIds = endAllActiveParentSpans("wait step");

          if (endedSpanIds.length > 0) {
            log(
              "✅",
              `Ended ${endedSpanIds.length} parent span(s) before wait freeze:`,
              {
                stepId,
                endedSpanIds,
              },
            );
          }

          // Wait for status change - THIS WILL FREEZE THE RUNTIME
          // All parent spans have been ended and should be exported before this freeze
          await checkpoint.waitForStatusChange(stepId);

          // Check final status (refresh stepData after status change)
          const finalStepData = context.getStepData(stepId);

          if (finalStepData?.Status === OperationStatus.SUCCEEDED) {
            log("✅", "Wait completed:", { stepId });
            checkAndUpdateReplayMode?.();

            // Mark as completed
            checkpoint.markOperationState(
              stepId,
              OperationLifecycleState.COMPLETED,
            );
            return;
          }

          // Should not reach here, but handle gracefully
          log("⚠️", "Wait ended with unexpected status:", {
            stepId,
            status: finalStepData?.Status,
          });
        },
        {
          executionArn: context.durableExecutionArn,
          parentId,
        },
      );
    });
  }

  return waitHandler;
};
