// 2-3: Multiple sequential waits
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait("wait-1", { seconds: 2 });
    await context.wait("wait-2", { seconds: 2 });
    return { completedWaits: 2 };
  },
);
