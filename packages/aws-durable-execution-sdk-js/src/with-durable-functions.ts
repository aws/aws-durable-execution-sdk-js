import { OperationType } from "@aws-sdk/client-lambda";
import { Context } from "aws-lambda";
import { createDurableContext } from "./context/durable-context/durable-context";

import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { CheckpointFailedError } from "./errors/checkpoint-errors/checkpoint-errors";
import {
  createCheckpoint,
  deleteCheckpoint,
} from "./utils/checkpoint/checkpoint";
import { TerminationReason } from "./termination-manager/types";

import {
  DurableContext,
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
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
  checkpointToken: string,
  handler: DurableHandler<Input, Output>,
): Promise<DurableExecutionInvocationOutput> {
  // Clear any existing checkpoint handler from previous invocations (warm Lambda)
  deleteCheckpoint();

  const durableContext = createDurableContext(
    executionContext,
    context,
    undefined,
    checkpointToken,
  );

  try {
    log(
      executionContext.isVerbose,
      "🎯",
      `Starting handler execution, handler event: ${executionContext.customerHandlerEvent}`,
    );
    let handlerPromiseResolved = false;
    let terminationPromiseResolved = false;

    const handlerPromise = handler(
      executionContext.customerHandlerEvent,
      durableContext,
    ).then((result) => {
      handlerPromiseResolved = true;
      log(executionContext.isVerbose, "🏆", "Handler promise resolved first!");
      return ["handler", result] as const;
    });

    const terminationPromise = executionContext.terminationManager
      .getTerminationPromise()
      .then((result) => {
        terminationPromiseResolved = true;
        log(
          executionContext.isVerbose,
          "💥",
          "Termination promise resolved first!",
        );
        return ["termination", result] as const;
      });

    if (executionContext.isVerbose) {
      // Set up a timeout to log the state of promises after a short delay
      setTimeout(() => {
        log(executionContext.isVerbose, "⏱️", "Promise race status check:", {
          handlerResolved: handlerPromiseResolved,
          terminationResolved: terminationPromiseResolved,
        });
      }, 500);
    }

    const [resultType, result] = await Promise.race([
      handlerPromise,
      terminationPromise,
    ]);

    log(executionContext.isVerbose, "🏁", "Promise race completed with:", {
      resultType,
    });

    // If termination was due to checkpoint failure, throw an error to terminate the Lambda
    if (
      resultType === "termination" &&
      result.reason === TerminationReason.CHECKPOINT_FAILED
    ) {
      log(
        executionContext.isVerbose,
        "🛑",
        "Checkpoint failed - terminating Lambda execution",
      );
      throw new CheckpointFailedError(result.message);
    }

    if (resultType === "termination") {
      log(executionContext.isVerbose, "🛑", "Returning termination response");

      return {
        Status: InvocationStatus.PENDING,
      };
    }

    log(
      executionContext.isVerbose,
      "✅",
      "Returning normal completion response",
    );

    // Stringify the result once to avoid multiple JSON.stringify calls
    const serializedResult = JSON.stringify(result);

    // Check if the response size exceeds the Lambda limit
    // Note: JSON.stringify(undefined) returns undefined, so we need to handle that case
    if (
      serializedResult &&
      serializedResult.length > LAMBDA_RESPONSE_SIZE_LIMIT
    ) {
      log(
        executionContext.isVerbose,
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

        log(
          executionContext.isVerbose,
          "✅",
          "Large result successfully checkpointed",
        );

        // Return a response indicating the result was checkpointed
        return {
          Status: InvocationStatus.SUCCEEDED,
          Result: "",
        };
      } catch (checkpointError) {
        log(
          executionContext.isVerbose,
          "❌",
          "Failed to checkpoint large result:",
          checkpointError,
        );

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
      Result: serializedResult || "",
    };
  } catch (error) {
    log(executionContext.isVerbose, "❌", "Handler threw an error:", error);

    // Check if this is a checkpoint failure
    if (error instanceof CheckpointFailedError) {
      log(
        executionContext.isVerbose,
        "🛑",
        "Checkpoint failed - terminating Lambda execution",
      );
      throw error; // Re-throw the error to terminate Lambda execution
    }

    return {
      Status: InvocationStatus.FAILED,
      Error: createErrorObjectFromError(error),
    };
  }
}

export const withDurableFunctions = <Input = any, Output = any>(
  handler: DurableHandler<Input, Output>,
): LambdaHandler<DurableExecutionInvocationInput> => {
  return async (
    event: DurableExecutionInvocationInput,
    context: Context,
  ): Promise<DurableExecutionInvocationOutput> => {
    const { executionContext, checkpointToken } =
      await initializeExecutionContext(event);
    let response: DurableExecutionInvocationOutput | null = null;
    try {
      response = await runHandler(
        event,
        context,
        executionContext,
        checkpointToken,
        handler,
      );
      return response;
    } catch (err) {
      throw err;
    } finally {
      executionContext.state.complete?.(event, response);
    }
  };
};
