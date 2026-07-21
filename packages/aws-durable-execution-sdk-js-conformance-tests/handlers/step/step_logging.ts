// 1-7: Step with context logger
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async (stepContext) => {
      stepContext.logger.info(`Greeting step started for: ${event}`);
      const greeting = `Hello, ${event}!`;
      stepContext.logger.info(`Greeting step completed with: ${greeting}`);
      return greeting;
    });
    return result;
  },
);
