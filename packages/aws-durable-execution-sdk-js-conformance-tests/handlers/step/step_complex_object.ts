// 1-4: Returning complex object
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: { name: string; tags: string[] }, context: DurableContext) => {
    const result = await context.step(async () => {
      return {
        user: {
          name: event.name,
          tags: event.tags,
        },
        count: event.tags.length,
      };
    });
    return result;
  },
);
