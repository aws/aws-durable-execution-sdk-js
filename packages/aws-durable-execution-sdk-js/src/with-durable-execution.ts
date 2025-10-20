import { OperationType } from "@aws-sdk/client-lambda";
import { Context } from "aws-lambda";
import { createDurableContext } from "./context/durable-context/durable-context";

import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { CheckpointFailedError } from "./errors/checkpoint-errors/checkpoint-errors";
import { isUnrecoverableInvocationError } from "./errors/unrecoverable-error/unrecoverable-error";
import {
  createCheckpoint,
  deleteCheckpoint,
} from "./utils/checkpoint/checkpoint";
import { TerminationReason } from "./termination-manager/types";

import {
  DurableContext,
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
  DurableExecutionMode,
  ExecutionContext,
  InvocationStatus,
  LambdaHandler,
} from "./types";
import { log } from "./utils/logger/logger";
import { createErrorObjectFromError } from "./utils/error-object/error-object";

type DurableHandler<Input, Output> = (
  event: Input,
  context: DurableContext,
) => Promise<Output>;
// Lambda response size limit is 6MB
const LAMBDA_RESPONSE_SIZE_LIMIT = 6 * 1024 * 1024 - 50; // 6MB in bytes, minus 50 bytes for envelope
async function runHandler<Input, Output>(
  event: DurableExecutionInvocationInput,
  context: Context,
  executionContext: ExecutionContext,
  durableExecutionMode: DurableExecutionMode,
  checkpointToken: string,
  handler: DurableHandler<Input, Output>,
): Promise<DurableExecutionInvocationOutput> {
  // Clear any existing checkpoint handler from previous invocations (warm Lambda)
  deleteCheckpoint();

  const durableContext = createDurableContext(
    executionContext,
    context,
    durableExecutionMode,
    undefined,
    checkpointToken,
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

    const handlerPromise = handler(customerHandlerEvent, durableContext).then(
      (result) => {
        handlerPromiseResolved = true;
        log("🏆", "Handler promise resolved first!");
        return ["handler", result] as const;
      },
    );

    const terminationPromise = executionContext.terminationManager
      .getTerminationPromise()
      .then((result) => {
        terminationPromiseResolved = true;
        log("💥", "Termination promise resolved first!");
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

    // If termination was due to checkpoint failure, throw an error to terminate the Lambda
    if (
      resultType === "termination" &&
      result.reason === TerminationReason.CHECKPOINT_FAILED
    ) {
      log("🛑", "Checkpoint failed - terminating Lambda execution");
      throw new CheckpointFailedError(result.message);
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

    // Check if the response size exceeds the Lambda limit
    // Note: JSON.stringify(undefined) returns undefined, so we need to handle that case
    if (
      serializedResult &&
      serializedResult.length > LAMBDA_RESPONSE_SIZE_LIMIT
    ) {
      log(
        "📦",
        `Response size (${serializedResult.length} bytes) exceeds Lambda limit (${LAMBDA_RESPONSE_SIZE_LIMIT} bytes). Checkpointing result.`,
      );

      // Create a checkpoint handler to save the large result
      const checkpoint = createCheckpoint(executionContext, checkpointToken);
      const stepId = `execution-result-${Date.now()}`;

      try {
        await checkpoint(stepId, {
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

        // Throw CheckpointFailedError to terminate Lambda execution
        throw new CheckpointFailedError(
          checkpointError instanceof Error
            ? `Failed to checkpoint large result: ${checkpointError.message}`
            : "Failed to checkpoint large result: Unknown error",
        );
      }
    }

    // If response size is acceptable, return the response
    return {
      Status: InvocationStatus.SUCCEEDED,
      Result: serializedResult,
    };
  } catch (error) {
    log("❌", "Handler threw an error:", error);

    // Check if this is an unrecoverable invocation error (includes checkpoint failures and serdes errors)
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

export const withDurableExecution = <Input, Output>(
  handler: DurableHandler<Input, Output>,
): LambdaHandler<DurableExecutionInvocationInput> => {
  return async (
    event: DurableExecutionInvocationInput,
    context: Context,
  ): Promise<DurableExecutionInvocationOutput> => {
    const { executionContext, durableExecutionMode, checkpointToken } =
      await initializeExecutionContext(event);
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

/**
 * @deprecated Use `withDurableExecution` instead. This alias will be removed in a future version.
 */
export const withDurableFunctions = withDurableExecution;
