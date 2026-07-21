// 8-19: Parallel with invalid max-concurrency raises a validation error
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // maxConcurrency=0 is invalid; the SDK raises before any branch runs.
    const results = await context.parallel<string>(
      "bad-concurrency",
      [async () => "a", async () => "b"],
      { maxConcurrency: 0 },
    );
    return results.getResults();
  },
);
