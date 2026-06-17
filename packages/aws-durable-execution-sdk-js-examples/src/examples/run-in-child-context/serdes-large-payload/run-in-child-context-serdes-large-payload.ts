import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { uppercaseSerdes } from "../serdes/run-in-child-context-serdes";

export const config: ExampleConfig = {
  name: "Run in Child Context with Serdes - Large Payload",
  description:
    "Verifies runInChildContext applies the serdes round-trip for large " +
    "payloads (>256KB, ReplayChildren mode) so the first-run result is " +
    "consistent with the small-payload and virtual modes.",
};

/**
 * Large payload case: the serialized result exceeds the 256KB checkpoint size
 * limit, so the context is persisted as a summary and re-executed on replay
 * (ReplayChildren mode). The returned value still passes through
 * deserialize(serialize(result)) on both first run and replay, so the caller
 * always observes the serdes round-trip regardless of payload size.
 *
 * With uppercaseSerdes, a lowercase input of "x" repeated comes back as "X"
 * repeated — proving the round-trip was applied.
 */
export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // 300KB string exceeds the 256KB CHECKPOINT_SIZE_LIMIT_BYTES.
    const largeValue = "x".repeat(300 * 1024);

    const childResult = await context.runInChildContext(
      "large-serdes-child",
      async (childContext: DurableContext) => {
        return await childContext.step("large-step", async () => {
          return largeValue;
        });
      },
      { serdes: uppercaseSerdes },
    );

    // Capture a small fingerprint of the first-run result so we can assert the
    // round-trip without checkpointing the whole 300KB payload.
    const captured = await context.step("capture-large-result", async () => {
      return {
        prefix: childResult.substring(0, 10),
        length: childResult.length,
        isUppercase: childResult === childResult.toUpperCase(),
      };
    });

    // Wait forces a second invocation (replay) to confirm first-run == replay.
    await context.wait("force-replay-large", { seconds: 1 });

    return { capturedOnFirstRun: captured };
  },
);
