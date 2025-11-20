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
} from "../../types";
import { log } from "../../utils/logger/logger";

export const createWaitForCallbackHandler = (
  context: ExecutionContext,
  runInChildContext: DurableContext["runInChildContext"],
) => {
  return <T>(
    nameOrSubmitter: string | undefined | WaitForCallbackSubmitterFunc,
    submitterOrConfig?: WaitForCallbackSubmitterFunc | WaitForCallbackConfig<T>,
    maybeConfig?: WaitForCallbackConfig<T>,
  ): DurablePromise<T> => {
    // Two-phase execution: Phase 1 starts immediately, Phase 2 returns result when awaited
    let phase1Result: T | undefined;
    let phase1Error: unknown;

    // Phase 1: Start execution immediately and capture result/error
    const phase1Promise = (async (): Promise<T> => {
      let name: string | undefined;
      let submitter: WaitForCallbackSubmitterFunc;
      let config: WaitForCallbackConfig<T> | undefined;

      // Parse the overloaded parameters - validation errors thrown here are async
      if (
        typeof nameOrSubmitter === "string" ||
        nameOrSubmitter === undefined
      ) {
        // Case: waitForCallback("name", submitterFunc, config?) or waitForCallback(undefined, submitterFunc, config?)
        name = nameOrSubmitter;
        if (typeof submitterOrConfig === "function") {
          submitter = submitterOrConfig;
          config = maybeConfig;
        } else {
          throw new Error(
            "waitForCallback requires a submitter function when name is provided",
          );
        }
      } else if (typeof nameOrSubmitter === "function") {
        // Case: waitForCallback(submitterFunc, config?)
        submitter = nameOrSubmitter;
        config = submitterOrConfig as WaitForCallbackConfig<T>;
      } else {
        throw new Error("waitForCallback requires a submitter function");
      }

      log("📞", "WaitForCallback requested:", {
        name,
        hasSubmitter: !!submitter,
        config,
      });

      // Use runInChildContext to ensure proper ID generation and isolation
      const childFunction = async (childCtx: DurableContext): Promise<T> => {
        // Convert WaitForCallbackConfig to CreateCallbackConfig
        const createCallbackConfig: CreateCallbackConfig<T> | undefined = config
          ? {
              timeout: config.timeout,
              heartbeatTimeout: config.heartbeatTimeout,
              serdes: config.serdes,
            }
          : undefined;

        // Create callback and get the promise + callbackId
        const [callbackPromise, callbackId] =
          await childCtx.createCallback<T>(createCallbackConfig);

        log("🆔", "Callback created:", {
          callbackId,
          name,
        });

        // Execute the submitter step (submitter is now mandatory)
        await childCtx.step(
          async (stepContext: StepContext) => {
            // Use the step's built-in logger instead of creating a new one
            const callbackContext: WaitForCallbackContext = {
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

      return await runInChildContext(name, childFunction, {
        subType: OperationSubType.WAIT_FOR_CALLBACK,
      });
    })()
      .then((result) => {
        phase1Result = result;
      })
      .catch((error) => {
        phase1Error = error;
      });

    // Phase 2: Return DurablePromise that returns Phase 1 result when awaited
    return new DurablePromise(async () => {
      await phase1Promise;
      if (phase1Error !== undefined) {
        throw phase1Error;
      }
      return phase1Result!;
    });
  };
};
