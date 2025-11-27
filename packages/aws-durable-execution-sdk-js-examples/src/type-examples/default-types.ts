import {
  DurableExecutionHandler,
  DurableLambdaHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

const durableHandler: DurableExecutionHandler = async (event, context) => {
  const result = await context.step(async () => {
    return { message: "Using default types", eventData: event };
  });

  const [promise, callbackId] = await context.createCallback();

  await context.step(async () => {
    console.log(`Callback created: ${callbackId}`);
    return callbackId;
  });

  const callbackResult = await promise;

  return {
    stepResult: result,
    callbackResult,
    processed: true,
  };
};

export const typedHandler: DurableLambdaHandler =
  withDurableExecution(durableHandler);
