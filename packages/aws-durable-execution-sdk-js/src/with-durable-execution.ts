import { OperationType } from "@aws-sdk/client-lambda";
import { Context } from "aws-lambda";
import { EventEmitter } from "events";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";

import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { SerdesFailedError } from "./errors/serdes-errors/serdes-errors";
import { isUnrecoverableInvocationError } from "./errors/unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "./termination-manager/types";

import {
  DurableLogger,
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
  DurableExecutionMode,
  ExecutionContext,
  InvocationStatus,
} from "./types";
import { log } from "./utils/logger/logger";
import { createErrorObjectFromError } from "./utils/error-object/error-object";
import { runWithContext } from "./utils/context-tracker/context-tracker";
import { createDefaultLogger } from "./utils/logger/default-logger";
import {
  DurableExecutionConfig,
  DurableExecutionHandler,
  DurableLambdaHandler,
} from "./types/durable-execution";

// Lambda response size limit is 6MB
const LAMBDA_RESPONSE_SIZE_LIMIT = 6 * 1024 * 1024 - 50; // 6MB in bytes, minus 50 bytes for envelope
async function runHandler<
  Input,
  Output,
  Logger extends DurableLogger = DurableLogger,
>(
  event: DurableExecutionInvocationInput,
  context: Context,
  executionContext: ExecutionContext,
  durableExecutionMode: DurableExecutionMode,
  checkpointToken: string,
  handler: DurableExecutionHandler<Input, Output, Logger>,
): Promise<DurableExecutionInvocationOutput> {
  // Create checkpoint manager and step data emitter
  const stepDataEmitter = new EventEmitter();
  const checkpointManager = new CheckpointManager(
    executionContext.durableExecutionArn,
    executionContext._stepData,
    executionContext.durableExecutionClient,
    executionContext.terminationManager,
    executionContext.activeOperationsTracker,
    checkpointToken,
    stepDataEmitter,
    createDefaultLogger(executionContext),
    executionContext.pendingCompletions,
  );

  // Set the checkpoint terminating callback on the termination manager
  executionContext.terminationManager.setCheckpointTerminatingCallback(() => {
    checkpointManager.setTerminating();
  });

  const durableExecution = {
    checkpointManager,
    stepDataEmitter,
    setTerminating: (): void => checkpointManager.setTerminating(),
  };

  const durableContext = createDurableContext<Logger>(
    executionContext,
    context,
    durableExecutionMode,
    // Default logger may not have the same type as Logger, but we should always provide a default logger even if the user overrides it
    createDefaultLogger() as Logger,
    undefined,
    durableExecution,
  );

  // Extract customerHandlerEvent from the original event
  const initialExecutionEvent = event.InitialExecutionState.Operations?.[0];
  const customerHandlerEvent = JSON.parse(
    initialExecutionEvent?.ExecutionDetails?.InputPayload ?? "{}",
  );

  try {
    log(
      "🎯",
      `Starting handler execution, handler event: ${customerHandlerEvent}`,
    );
    let handlerPromiseResolved = false;
    let terminationPromiseResolved = false;

    const handlerPromise = runWithContext("root", undefined, () =>
      handler(customerHandlerEvent, durableContext),
    ).then((result) => {
      handlerPromiseResolved = true;
      log("🏆", "Handler promise resolved first!");
      return ["handler", result] as const;
    });

    const terminationPromise = executionContext.terminationManager
      .getTerminationPromise()
      .then((result) => {
        terminationPromiseResolved = true;
        log("💥", "Termination promise resolved first!");
        // Set checkpoint manager as terminating when termination starts
        durableExecution.setTerminating();
        return ["termination", result] as const;
      });

    // Set up a timeout to log the state of promises after a short delay
    setTimeout(() => {
      log("⏱️", "Promise race status check:", {
        handlerResolved: handlerPromiseResolved,
        terminationResolved: terminationPromiseResolved,
      });
    }, 500);

    const [resultType, result] = await Promise.race([
      handlerPromise,
      terminationPromise,
    ]);

    log("🏁", "Promise race completed with:", {
      resultType,
    });

    // Wait for all pending checkpoints to complete
    try {
      await durableExecution.checkpointManager.waitForQueueCompletion();
      log("✅", "All pending checkpoints completed");
    } catch (error) {
      log("⚠️", "Error waiting for checkpoint completion:", error);
    }

    // If termination was due to checkpoint failure, throw the appropriate error
    if (
      resultType === "termination" &&
      result.reason === TerminationReason.CHECKPOINT_FAILED
    ) {
      log("🛑", "Checkpoint failed - handling termination");
      // checkpoint.ts always provides classified error
      throw result.error;
    }

    // If termination was due to serdes failure, throw an error to terminate the Lambda
    if (
      resultType === "termination" &&
      result.reason === TerminationReason.SERDES_FAILED
    ) {
      log("🛑", "Serdes failed - terminating Lambda execution");
      throw new SerdesFailedError(result.message);
    }

    // If termination was due to context validation error, return FAILED
    if (
      resultType === "termination" &&
      result.reason === TerminationReason.CONTEXT_VALIDATION_ERROR
    ) {
      log("🛑", "Context validation error - returning FAILED status");
      return {
        Status: InvocationStatus.FAILED,
        Error: createErrorObjectFromError(
          result.error || new Error(result.message),
        ),
      };
    }

    if (resultType === "termination") {
      log("🛑", "Returning termination response");

      return {
        Status: InvocationStatus.PENDING,
      };
    }

    log("✅", "Returning normal completion response");

    // Stringify the result once to avoid multiple JSON.stringify calls
    const serializedResult = JSON.stringify(result);
    const serializedSize = new TextEncoder().encode(serializedResult).length;

    // Check if the response size exceeds the Lambda limit
    // Note: JSON.stringify(undefined) returns undefined, so we need to handle that case
    if (serializedResult && serializedSize > LAMBDA_RESPONSE_SIZE_LIMIT) {
      log(
        "📦",
        `Response size (${serializedSize} bytes) exceeds Lambda limit (${LAMBDA_RESPONSE_SIZE_LIMIT} bytes). Checkpointing result.`,
      );

      // Create a checkpoint to save the large result
      const stepId = `execution-result-${Date.now()}`;

      try {
        await durableExecution.checkpointManager.checkpoint(stepId, {
          Id: stepId,
          Action: "SUCCEED",
          Type: OperationType.EXECUTION,
          Payload: serializedResult, // Reuse the already serialized result
        });

        log("✅", "Large result successfully checkpointed");

        // Return a response indicating the result was checkpointed
        return {
          Status: InvocationStatus.SUCCEEDED,
          Result: "",
        };
      } catch (checkpointError) {
        log("❌", "Failed to checkpoint large result:", checkpointError);
        // Re-throw - checkpoint.ts always classifies errors before terminating
        throw checkpointError;
      }
    }

    // If response size is acceptable, return the response
    return {
      Status: InvocationStatus.SUCCEEDED,
      Result: serializedResult,
    };
  } catch (error) {
    log("❌", "Handler threw an error:", error);

    // Check if this is an unrecoverable invocation error (includes checkpoint invocation failures)
    if (isUnrecoverableInvocationError(error)) {
      log(
        "🛑",
        "Unrecoverable invocation error - terminating Lambda execution",
      );
      throw error; // Re-throw the error to terminate Lambda execution
    }

    return {
      Status: InvocationStatus.FAILED,
      Error: createErrorObjectFromError(error),
    };
  }
}

/**
 * Validates that the event is a proper durable execution input
 */
function validateDurableExecutionEvent(event: unknown): void {
  try {
    const eventObj = event as Record<string, unknown>;
    if (!eventObj?.DurableExecutionArn || !eventObj?.CheckpointToken) {
      throw new Error("Missing required durable execution fields");
    }
  } catch {
    const msg = `Unexpected payload provided to start the durable execution. 
Check your resource configurations to confirm the durability is set.`;
    throw new Error(msg);
  }
}

/**
 * Wraps a durable handler function to create a handler with automatic state persistence,
 * retry logic, and workflow orchestration capabilities.
 *
 * This function transforms your durable handler into a function that integrates
 * with the AWS Durable Execution service. The wrapped handler automatically manages execution state
 * and checkpointing.
 *
 * @typeParam TEvent - The type of the input event your handler expects (defaults to any)
 * @typeParam TResult - The type of the result your handler returns (defaults to any)
 * @typeParam TLogger - The type of custom logger implementation (defaults to DurableLogger)
 *
 * @param handler - Your durable handler function that uses the DurableContext for operations
 * @param config - Optional configuration for custom advanced settings
 *
 * @returns A handler function that automatically manages durability
 *
 * @example
 * **Basic Usage:**
 * ```typescript
 * import { withDurableExecution, DurableExecutionHandler } from '@aws/durable-execution-sdk-js';
 *
 * const durableHandler: DurableExecutionHandler<MyEvent, MyResult> = async (event, context) => {
 *   // Execute durable operations with automatic retry and checkpointing
 *   const userData = await context.step("fetch-user", async () =>
 *     fetchUserFromDB(event.userId)
 *   );
 *
 *   // Wait for external approval
 *   const approval = await context.waitForCallback("user-approval", async (callbackId) => {
 *     await sendApprovalEmail(callbackId, userData);
 *   });
 *
 *   // Process in parallel
 *   const results = await context.parallel("process-data", [
 *     async (ctx) => ctx.step("validate", () => validateData(userData)),
 *     async (ctx) => ctx.step("transform", () => transformData(userData))
 *   ]);
 *
 *   return { success: true, results };
 * };
 *
 * export const handler = withDurableExecution(durableHandler);
 * ```
 *
 * @example
 * **With Custom Configuration:**
 * ```typescript
 * import { LambdaClient } from '@aws-sdk/client-lambda';
 *
 * const customClient = new LambdaClient({
 *   region: 'us-west-2',
 *   maxAttempts: 5
 * });
 *
 * export const handler = withDurableExecution(durableHandler, {
 *   client: customClient
 * });
 * ```
 *
 * @example
 * **Passed Directly to the Handler:**
 * ```typescript
 * export const handler = withDurableExecution(async (event, context) => {
 *   const result = await context.step(async () => processEvent(event));
 *   return result;
 * });
 * ```
 *
 * @public
 */
export const withDurableExecution = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEvent = any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult = any,
  TLogger extends DurableLogger = DurableLogger,
>(
  handler: DurableExecutionHandler<TEvent, TResult, TLogger>,
  config?: DurableExecutionConfig,
): DurableLambdaHandler => {
  return async (
    event: DurableExecutionInvocationInput,
    context: Context,
  ): Promise<DurableExecutionInvocationOutput> => {
    validateDurableExecutionEvent(event);
    const { executionContext, durableExecutionMode, checkpointToken } =
      await initializeExecutionContext(event, context, config?.client);
    let response: DurableExecutionInvocationOutput | null = null;
    try {
      response = await runHandler(
        event,
        context,
        executionContext,
        durableExecutionMode,
        checkpointToken,
        handler,
      );
      return response;
    } catch (err) {
      throw err;
    }
  };
};
