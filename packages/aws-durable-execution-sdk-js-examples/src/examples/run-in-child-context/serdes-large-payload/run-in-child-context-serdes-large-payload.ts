import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { uppercaseSerdes } from "../../shared/uppercase-serdes";

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
    const childResult = await context.runInChildContext(
      "large-serdes-child",
      async (_childContext: DurableContext) => {
        // Return a >256KB payload directly from the child context body. This
        // exceeds CHECKPOINT_SIZE_LIMIT_BYTES, so runInChildContext switches to
        // ReplayChildren mode (persists a summary, re-executes on replay).
        //
        // NOTE: the large value must NOT come from an inner `step` — a step's
        // output is checkpointed directly and cannot exceed 256KB. Only
        // runInChildContext has the adaptive large-payload handling.
        return "x".repeat(300 * 1024);
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
