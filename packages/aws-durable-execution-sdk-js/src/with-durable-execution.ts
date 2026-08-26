import { OperationType } from "./types/wire";
import { Context } from "aws-lambda";
import { EventEmitter } from "events";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";

import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { SerdesFailedError } from "./errors/serdes-errors/serdes-errors";
import { isUnrecoverableInvocationError } from "./errors/unrecoverable-error/unrecoverable-error";
import { isNonRetryableCustomerError } from "./errors/non-retryable-errors";
import {
  TerminationReason,
  classifyTermination,
} from "./termination-manager/types";
import { resolveRootPreserveChildDepth } from "./utils/child-operations-depth/child-operations-depth";
import {
  validateDurableExecutionConfig,
  validateTransportConfig,
} from "./config-validation/config-validation";
import {
  DurableExecutionClientErrorScope,
  isDurableExecutionClientError,
} from "./errors/durable-execution-client-error/durable-execution-client-error";

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
import { createPluginRunner } from "./utils/plugin/plugin-runner";
import { loadConfiguredPlugins } from "./utils/plugin/plugin-loader";
import { toOperationInfoMap } from "./utils/operation/operation";
import {
  DurableInstrumentationPlugin,
  InvocationBaseInfo,
  InvocationInfo,
  OperationInfo,
  PluginInvocationStatus,
} from "./types/plugin";

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
  plugin: DurableInstrumentationPlugin,
  config: DurableExecutionConfig | undefined,
): Promise<DurableExecutionInvocationOutput> {
  // Create checkpoint manager and step data emitter
  const stepDataEmitter = new EventEmitter();
  const checkpointManager = new CheckpointManager(
    executionContext.durableExecutionArn,
    executionContext._stepData,
    executionContext.durableExecutionClient,
    executionContext.terminationManager,
    checkpointToken,
    stepDataEmitter,
    createDefaultLogger(
      executionContext,
      plugin.enrichLogContext?.bind(plugin),
    ),
    new Set<string>(),
    plugin,
    executionContext.requestId,
    executionContext.getRemainingTimeMs,
  );

  // Extract customerHandlerEvent early so it's available for plugins in onInvocationStart
  const initialExecutionEvent =
    executionContext._stepData[Object.keys(executionContext._stepData)[0]];
  const customerHandlerEvent = JSON.parse(
    initialExecutionEvent?.ExecutionDetails?.InputPayload ?? "{}",
  );

  const allOperations = toOperationInfoMap(executionContext._stepData);
  const updatedOperationIds = event.UpdatedOperationIds ?? [];
  const updatedOperations: Record<string, OperationInfo> = {};
  for (const id of updatedOperationIds) {
    if (allOperations[id]) {
      updatedOperations[id] = allOperations[id];
    }
  }

  const invocationBaseInfo: InvocationBaseInfo = {
    requestId: executionContext.requestId,
    executionArn: executionContext.durableExecutionArn,
    executionInput: customerHandlerEvent,
    operations: allOperations,
    executionStartTimestamp: initialExecutionEvent?.StartTimestamp ?? undefined,
  };

  const invocationInfo: InvocationInfo = {
    ...invocationBaseInfo,
    isFirstInvocation:
      durableExecutionMode === DurableExecutionMode.ExecutionMode,
    updatedOperations,
  };
  await plugin.onInvocationStart?.(invocationInfo);

  // Reject invalid configuration before running the handler. It's a non-retryable
  // error and no durable operations have started yet, so fail fast: return FAILED
  // without invoking the user handler. We return FAILED (rather than throw) so
  // Lambda does not retry a permanently-broken configuration.
  //
  // The execution context already exists by this point, so a check that must precede
  // transport construction cannot live here -- see validateTransportConfig, which runs
  // earlier for that reason.
  const configError = validateDurableExecutionConfig(config);
  if (configError) {
    const error = new Error(configError);
    await plugin.onInvocationEnd?.({
      ...invocationBaseInfo,
      status: PluginInvocationStatus.FAILED,
      executionInput: customerHandlerEvent,
      executionError: error,
      executionResult: undefined,
      operations: allOperations,
    });
    return {
      Status: InvocationStatus.FAILED,
      Error: createErrorObjectFromError(error),
    };
  }

  // Set the checkpoint terminating callback on the termination manager
  executionContext.terminationManager.setCheckpointTerminatingCallback(() => {
    checkpointManager.setTerminating();
  });

  const durableExecution = {
    checkpointManager,
    stepDataEmitter,
    plugin,
    setTerminating: (): void => checkpointManager.setTerminating(),
  };

  // Config was validated above; map childOperationsDepth to the root budget.
  const rootPreserveChildDepth = resolveRootPreserveChildDepth(
    config?.pluginsConfig?.childOperationsDepth,
  );

  const durableContext = createDurableContext<Logger>(
    executionContext,
    context,
    durableExecutionMode,
    // Default logger may not have the same type as Logger, but we should always provide a default logger even if the user overrides it
    createDefaultLogger(
      undefined,
      plugin.enrichLogContext?.bind(plugin),
    ) as Logger,
    undefined,
    durableExecution,
    undefined,
    rootPreserveChildDepth,
  );

  const executeInvocation =
    async (): Promise<DurableExecutionInvocationOutput> => {
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

        // Every remaining termination reason is decided by its class: a suspend means the
        // execution continues later and answers PENDING, a fault answers FAILED carrying
        // the error. See TERMINATION_CLASS for what each reason is and why.
        if (resultType === "termination") {
          if (classifyTermination(result.reason) === "suspend") {
            log("🛑", "Returning termination response", {
              reason: result.reason,
            });

            await plugin.onInvocationEnd?.({
              ...invocationBaseInfo,
              status: PluginInvocationStatus.PENDING,
              executionInput: customerHandlerEvent,
              executionResult: undefined,
              executionError: undefined,
              operations: toOperationInfoMap(executionContext._stepData),
            });

            return {
              Status: InvocationStatus.PENDING,
            };
          }

          const error = result.error ?? new Error(result.message);
          log(
            "🛑",
            `Terminated with ${result.reason} - returning FAILED status`,
            {
              message: result.message,
            },
          );

          const response = {
            Status: InvocationStatus.FAILED,
            Error: createErrorObjectFromError(error),
          };
          await plugin.onInvocationEnd?.({
            ...invocationBaseInfo,
            status: PluginInvocationStatus.FAILED,
            executionInput: customerHandlerEvent,
            executionError: error,
            executionResult: undefined,
            operations: toOperationInfoMap(executionContext._stepData),
          });
          return response;
        }

        log("✅", "Returning normal completion response");

        // Stringify the result once to avoid multiple JSON.stringify calls
        const serializedResult = JSON.stringify(result);
        const serializedSize = new TextEncoder().encode(
          serializedResult,
        ).length;

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

            // Wait for any pending checkpoints to complete before returning
            try {
              await durableExecution.checkpointManager.waitForQueueCompletion();
            } catch (waitError) {
              log(
                "⚠️",
                "Error waiting for checkpoint queue completion:",
                waitError,
              );
              // Continue anyway - the checkpoint will be retried on next invocation
            }

            await plugin.onInvocationEnd?.({
              ...invocationBaseInfo,
              status: PluginInvocationStatus.SUCCEEDED,
              executionInput: customerHandlerEvent,
              executionResult: result,
              executionError: undefined,
              operations: toOperationInfoMap(executionContext._stepData),
            });

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
        // Wait for any pending checkpoints to complete before returning
        try {
          await durableExecution.checkpointManager.waitForQueueCompletion();
        } catch (waitError) {
          log(
            "⚠️",
            "Error waiting for checkpoint queue completion:",
            waitError,
          );
          // Continue anyway - the checkpoint will be retried on next invocation
        }

        await plugin.onInvocationEnd?.({
          ...invocationBaseInfo,
          status: PluginInvocationStatus.SUCCEEDED,
          executionInput: customerHandlerEvent,
          executionResult: result,
          executionError: undefined,
          operations: toOperationInfoMap(executionContext._stepData),
        });

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
          await plugin.onInvocationEnd?.({
            ...invocationBaseInfo,
            status: PluginInvocationStatus.RETRYING,
            executionInput: customerHandlerEvent,
            executionError: error,
            executionResult: undefined,
            operations: toOperationInfoMap(executionContext._stepData),
          });
          throw error; // Re-throw the error to terminate Lambda execution
        }

        // Wait for any pending checkpoints to complete before returning error
        try {
          await durableExecution.checkpointManager.waitForQueueCompletion();
        } catch (waitError) {
          log(
            "⚠️",
            "Error waiting for checkpoint queue completion:",
            waitError,
          );
          // Continue anyway - the checkpoint will be retried on next invocation
        }

        await plugin.onInvocationEnd?.({
          ...invocationBaseInfo,
          status: PluginInvocationStatus.FAILED,
          executionInput: customerHandlerEvent,
          executionError:
            error instanceof Error ? error : new Error(String(error)),
          executionResult: undefined,
          operations: toOperationInfoMap(executionContext._stepData),
        });

        return {
          Status: InvocationStatus.FAILED,
          Error: createErrorObjectFromError(error),
        };
      }
    };

  try {
    return await (plugin.wrapInvocation?.(invocationInfo, executeInvocation) ??
      executeInvocation());
  } finally {
    // Every exit from the invocation funnels through here, including the normal-completion
    // path that never terminates. Without this, poll timers stay armed after the handler
    // returns and can fire during a later invocation in a reused execution environment.
    checkpointManager.dispose();
  }
}

/**
 * Validates that the event is a proper durable execution input
 */
function validateDurableExecutionEvent(event: unknown): void {
  const eventObj = event as Record<string, unknown>;
  if (!eventObj?.DurableExecutionArn || !eventObj?.CheckpointToken) {
    throw new Error(
      "Unexpected payload provided to start the durable execution.\n" +
        "Check your resource configurations to confirm the durability is set.",
    );
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
  const pluginPromise = loadConfiguredPlugins(config?.plugins).then(
    createPluginRunner,
  );
  // Plugin loading starts during handler initialization. Attach a rejection handler
  // immediately so a cold-start configuration error cannot become an unhandled
  // rejection before Lambda invokes the exported handler; awaiting the original
  // promise below still reports the same error to the invocation.
  void pluginPromise.catch(() => undefined);

  return async (
    event: DurableExecutionInvocationInput,
    context: Context,
  ): Promise<DurableExecutionInvocationOutput> => {
    validateDurableExecutionEvent(event);

    // Checked before the transport is constructed, because from here on a transport is
    // chosen and used: initializeExecutionContext reads execution state through it. The
    // remaining config checks stay where they are, after the plugin lifecycle has started,
    // since none of them affect which transport is built. No plugin hooks fire for this
    // error: nothing was transported and no operation exists to report on. FAILED rather
    // than a throw, so the platform does not retry a permanently-broken configuration.
    const transportConfigError = validateTransportConfig(config);
    if (transportConfigError) {
      return {
        Status: InvocationStatus.FAILED,
        Error: createErrorObjectFromError(new Error(transportConfigError)),
      };
    }

    let plugin: DurableInstrumentationPlugin;
    try {
      plugin = await pluginPromise;
    } catch (error) {
      return {
        Status: InvocationStatus.FAILED,
        Error: createErrorObjectFromError(error),
      };
    }

    try {
      const { executionContext, durableExecutionMode, checkpointToken } =
        await initializeExecutionContext(event, context, config);
      return await runHandler(
        event,
        context,
        executionContext,
        durableExecutionMode,
        checkpointToken,
        handler,
        plugin,
        config,
      );
    } catch (error) {
      // A transport that states the failure is fatal for the execution is believed,
      // wherever that error surfaces. In practice it comes from reading execution state
      // during initialization, which is the one client call with no checkpoint classifier
      // to consult; checkpoint failures are classified in CheckpointManager and reach this
      // point already wrapped. The try also covers the handler, so an EXECUTION-scoped
      // error thrown by handler code is honoured too -- see DurableExecutionClientError,
      // which documents that.
      if (
        isDurableExecutionClientError(error) &&
        error.scope === DurableExecutionClientErrorScope.EXECUTION
      ) {
        return {
          Status: InvocationStatus.FAILED,
          Error: createErrorObjectFromError(error),
        };
      }

      // Non-retryable customer errors (e.g., KMS key misconfiguration) should
      // fail the execution immediately rather than retrying the invocation.
      if (isNonRetryableCustomerError(error)) {
        return {
          Status: InvocationStatus.FAILED,
          Error: createErrorObjectFromError(error),
        };
      }
      throw error;
    }
  };
};
