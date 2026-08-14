import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import {
  ExecutionContext,
  WaitForCallbackSubmitterFunc,
  WaitForCallbackConfig,
  CreateCallbackConfig,
  DurableContext,
  OperationSubType,
  WaitForCallbackContext,
  StepContext,
  StepConfig,
  DurablePromise,
  DurableLogger,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { createPassThroughSerdes } from "../callback-handler/callback";
import { AnySerdesDeserializer } from "../../utils/serdes/serdes";
import {
  ChildContextError,
  CallbackSubmitterError,
} from "../../errors/durable-error/durable-error";
import type { InternalDurableContext } from "../../types/internal-context";

/**
 * The child context is always a `DurableContextImpl`, which implements
 * {@link InternalDurableContext}. Used to label the inner CALLBACK / submitter
 * STEP spans with a derived plugin-only name without a public API change.
 * @internal
 */
type WaitForCallbackChildContext<Logger extends DurableLogger> =
  DurableContext<Logger> & InternalDurableContext<Logger>;

export const createWaitForCallbackHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  peekStepId: () => string,
  runInChildContext: DurableContext<Logger>["runInChildContext"],
  getDefaultCallbackDeserializer?: () => AnySerdesDeserializer,
) => {
  return <T>(
    nameOrSubmitter: string | undefined | WaitForCallbackSubmitterFunc<Logger>,
    submitterOrConfig?:
      | WaitForCallbackSubmitterFunc<Logger>
      | WaitForCallbackConfig<T>,
    maybeConfig?: WaitForCallbackConfig<T>,
  ): DurablePromise<T> => {
    let name: string | undefined;
    let submitter: WaitForCallbackSubmitterFunc<Logger>;
    let config: WaitForCallbackConfig<T> | undefined;

    // Parse the overloaded parameters - validation errors thrown here are async
    if (typeof nameOrSubmitter === "string" || nameOrSubmitter === undefined) {
      // Case: waitForCallback("name", submitterFunc, config?) or waitForCallback(undefined, submitterFunc, config?)
      name = nameOrSubmitter;
      if (typeof submitterOrConfig === "function") {
        submitter = submitterOrConfig;
        config = maybeConfig;
      } else {
        return new DurablePromise(() =>
          Promise.reject(
            new Error(
              "waitForCallback requires a submitter function when name is provided",
            ),
          ),
        );
      }
    } else if (typeof nameOrSubmitter === "function") {
      // Case: waitForCallback(submitterFunc, config?)
      submitter = nameOrSubmitter;
      config = submitterOrConfig as WaitForCallbackConfig<T>;
    } else {
      return new DurablePromise(() =>
        Promise.reject(
          new Error("waitForCallback requires a submitter function"),
        ),
      );
    }

    // Two-phase execution: Phase 1 starts immediately, Phase 2 returns result when awaited
    // Phase 1: Start execution immediately and capture result/error
    const phase1Promise = (async (): Promise<{
      result: string;
      stepId: string;
    }> => {
      log("📞", "WaitForCallback requested:", {
        name,
        hasSubmitter: !!submitter,
        config,
      });

      // Use runInChildContext to ensure proper ID generation and isolation
      const childFunction = async (
        childCtx: DurableContext<Logger>,
      ): Promise<string> => {
        // Convert WaitForCallbackConfig to CreateCallbackConfig.
        // When a defaultCallbackDeserializer is configured, force passthrough serdes
        // on the inner createCallback so the raw string is preserved for phase 2.
        const createCallbackConfig: CreateCallbackConfig | undefined =
          config || getDefaultCallbackDeserializer
            ? {
                timeout: config?.timeout,
                heartbeatTimeout: config?.heartbeatTimeout,
                ...(getDefaultCallbackDeserializer && {
                  serdes: createPassThroughSerdes(),
                }),
              }
            : undefined;

        // Derived names ("<name>-callback" / "<name>-submitter") go straight to
        // the plugin hooks, not checkpointed, safe under concurrency.
        const internalCtx = childCtx as WaitForCallbackChildContext<Logger>;

        // Create callback and get the promise + callbackId
        const [callbackPromise, callbackId] =
          await internalCtx._createCallbackWithPluginOperationName(
            name ? `${name}-callback` : undefined,
            createCallbackConfig,
          );

        log("🆔", "Callback created:", {
          callbackId,
          name,
        });

        // Execute the submitter step (submitter is now mandatory)
        const submitterOptions: StepConfig<void> | undefined =
          config?.retryStrategy
            ? { retryStrategy: config.retryStrategy }
            : undefined;
        await internalCtx._stepWithPluginOperationName(
          name ? `${name}-submitter` : undefined,
          async (stepContext: StepContext<Logger>) => {
            // Use the step's built-in logger instead of creating a new one
            const callbackContext: WaitForCallbackContext<Logger> = {
              logger: stepContext.logger,
            };

            log("📤", "Executing submitter:", {
              callbackId,
              name,
            });
            await submitter(callbackId, callbackContext);
            log("✅", "Submitter completed:", {
              callbackId,
              name,
            });
          },
          submitterOptions,
        );

        log("⏳", "Waiting for callback completion:", {
          callbackId,
          name,
        });

        // Return just the callback promise result
        return await callbackPromise;
      };

      const stepId = peekStepId();
      return {
        result: await runInChildContext(name, childFunction, {
          subType: OperationSubType.WAIT_FOR_CALLBACK,
          // When a defaultCallbackDeserializer is configured, use passthrough serdes
          // so the raw callback string is preserved through the runInChildContext
          // round-trip and phase 2 can apply the deserializer exactly once.
          // Without this, defaultSerdes (JSON) would add an extra encode/decode layer.
          ...(getDefaultCallbackDeserializer && {
            serdes: createPassThroughSerdes(),
          }),
          errorMapper: (originalError) => {
            // Pass through callback errors directly (timeout, external failure, base)
            if (
              originalError.errorType === "CallbackTimeoutError" ||
              originalError.errorType === "CallbackExternalError" ||
              originalError.errorType === "CallbackError"
            ) {
              return originalError;
            }
            // Map step errors to CallbackSubmitterError
            if (originalError.errorType === "StepError") {
              return new CallbackSubmitterError(
                originalError.message,
                originalError,
              );
            }
            // Wrap other errors in ChildContextError
            return new ChildContextError(originalError.message, originalError);
          },
        }),
        stepId,
      };
    })();

    // Attach catch handler to prevent unhandled promise rejections
    // The error will still be thrown when the DurablePromise is awaited
    phase1Promise.catch(() => {});

    // Phase 2: Return DurablePromise that returns Phase 1 result when awaited
    return new DurablePromise(async () => {
      const { result, stepId } = await phase1Promise;

      // Always deserialize the result since it's a string
      return (await safeDeserialize(
        config?.serdes ??
          (getDefaultCallbackDeserializer
            ? getDefaultCallbackDeserializer()
            : createPassThroughSerdes()),
        result,
        stepId,
        name,
        context.terminationManager,
        context.durableExecutionArn,
      ))!;
    });
  };
};
