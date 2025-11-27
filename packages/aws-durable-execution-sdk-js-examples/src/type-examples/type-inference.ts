import {
  DurableLambdaHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(async (event, context) => {
  const userData = await context.step(async () => {
    return { id: event.userId, processed: true, timestamp: Date.now() };
  });

  await context.wait({ seconds: 1 });

  return await context.step(async () => ({
    success: userData.processed,
    completedAt: new Date().toISOString(),
  }));
}) satisfies DurableLambdaHandler;
