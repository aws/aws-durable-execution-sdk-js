// 3-11: Child context large payload (ReplayChildren mode)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const largeDataResult = await context.runInChildContext(
      "large-data-processor",
      async (childContext: DurableContext) => {
        console.log(event);

        // Step returns a small seed value (under 256KB limit)
        const seed = await childContext.step(async () => {
          return "A";
        });

        // Build large result outside of step — this is just regular code
        // The child context RETURN value exceeds 256KB, triggering ReplayChildren mode
        const largeResult = seed.repeat(300 * 1024);
        return largeResult;
      },
    );

    // Wait after child context to force a second invocation and test replay
    await context.wait({ seconds: 1 });

    // Return the length — proves the large data was reconstructed via replay
    return largeDataResult.length;
  },
);
