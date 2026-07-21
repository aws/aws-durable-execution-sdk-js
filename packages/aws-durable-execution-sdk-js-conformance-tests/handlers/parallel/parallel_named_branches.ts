// 8-3: Parallel with named branch objects
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "named",
      [
        { name: "first", func: async () => "one" },
        { name: "second", func: async () => "two" },
      ],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
