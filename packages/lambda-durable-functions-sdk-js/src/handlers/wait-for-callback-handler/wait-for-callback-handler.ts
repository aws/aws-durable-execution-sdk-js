import {
  ExecutionContext,
  WaitForCallbackSubmitterFunc,
  WaitForCallbackConfig,
  CreateCallbackConfig,
  DurableContext,
  OperationSubType,
  Telemetry,
} from "../../types";
import { log } from "../../utils/logger/logger";

export const createWaitForCallbackHandler = (
  context: ExecutionContext,
  runInChildContext: DurableContext["runInChildContext"],
) => {
  return async <T>(
    nameOrSubmitter: string | undefined | WaitForCallbackSubmitterFunc,
    submitterOrConfig?: WaitForCallbackSubmitterFunc | WaitForCallbackConfig,
    maybeConfig?: WaitForCallbackConfig,
  ): Promise<T> => {
    let name: string | undefined;
    let submitter: WaitForCallbackSubmitterFunc;
    let config: WaitForCallbackConfig | undefined;

    // Parse the overloaded parameters
    if (typeof nameOrSubmitter === "string" || nameOrSubmitter === undefined) {
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
      config = submitterOrConfig as WaitForCallbackConfig;
    } else {
      throw new Error("waitForCallback requires a submitter function");
    }

    log(context.isVerbose, "📞", "WaitForCallback requested:", {
      name,
      hasSubmitter: !!submitter,
      config,
    });

    // Use runInChildContext to ensure proper ID generation and isolation
    const childFunction = async (childCtx: DurableContext) => {
      // Convert WaitForCallbackConfig to CreateCallbackConfig
      const createCallbackConfig: CreateCallbackConfig | undefined = config
        ? {
            timeout: config.timeout,
            heartbeatTimeout: config.heartbeatTimeout,
            serdes: config.serdes,
          }
        : undefined;

      // Create callback and get the promise + callbackId
      const [callbackPromise, callbackId] =
        await childCtx.createCallback<T>(createCallbackConfig);

      log(context.isVerbose, "🆔", "Callback created:", {
        callbackId,
        name,
      });

      // Execute the submitter step (submitter is now mandatory)
      await childCtx.step(async (telemetry: Telemetry) => {
        log(context.isVerbose, "📤", "Executing submitter:", {
          callbackId,
          name,
        });
        await submitter(callbackId, telemetry);
        log(context.isVerbose, "✅", "Submitter completed:", {
          callbackId,
          name,
        });
      });

      log(context.isVerbose, "⏳", "Waiting for callback completion:", {
        callbackId,
        name,
      });

      // Return just the callback promise result
      // This will terminate the invocation as right now we are not handdling cuncurrency
      // Ideally all termination will wait for in-progress steps to finish before terminatiing the process
      return await callbackPromise;
    };

    // Call runInChildContext with unified signature
    return runInChildContext(name, childFunction, {
      subType: OperationSubType.WAIT_FOR_CALLBACK,
    });
  };
};
