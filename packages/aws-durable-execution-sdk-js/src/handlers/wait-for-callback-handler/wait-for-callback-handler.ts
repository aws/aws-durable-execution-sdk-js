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
  DurablePromise,
  DurableLogger,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { createPassThroughSerdes } from "../callback-handler/callback";

export const createWaitForCallbackHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  getNextStepId: () => string,
  runInChildContext: DurableContext<Logger>["runInChildContext"],
  childPromises: Set<any>,
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
        // Convert WaitForCallbackConfig to CreateCallbackConfig
        const createCallbackConfig: CreateCallbackConfig | undefined = config
          ? {
              timeout: config.timeout,
              heartbeatTimeout: config.heartbeatTimeout,
            }
          : undefined;

        // Create callback and get the promise + callbackId
        const [callbackPromise, callbackId] =
          await childCtx.createCallback(createCallbackConfig);

        log("🆔", "Callback created:", {
          callbackId,
          name,
        });

        // Execute the submitter step (submitter is now mandatory)
        await childCtx.step(
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
          config?.retryStrategy
            ? { retryStrategy: config.retryStrategy }
            : undefined,
        );

        log("⏳", "Waiting for callback completion:", {
          callbackId,
          name,
        });

        // Return just the callback promise result
        return await callbackPromise;
      };

      const stepId = getNextStepId();
      return {
        result: await runInChildContext(name, childFunction, {
          subType: OperationSubType.WAIT_FOR_CALLBACK,
        }),
        stepId,
      };
    })();

    // Attach catch handler to prevent unhandled promise rejections
    // The error will still be thrown when the DurablePromise is awaited
    phase1Promise.catch(() => {});

    // Phase 2: Return DurablePromise that returns Phase 1 result when awaited
    const durablePromise = new DurablePromise(async () => {
      const { result, stepId } = await phase1Promise;

      // Always deserialize the result since it's a string
      return (await safeDeserialize(
        config?.serdes ?? createPassThroughSerdes(),
        result,
        stepId,
        name,
        context.terminationManager,
        context.durableExecutionArn,
      ))!;
    });

    // Register and cleanup
    childPromises.add(durablePromise);
    durablePromise.finally(() => {
      childPromises.delete(durablePromise);
    });

    return durablePromise;
  };
};
