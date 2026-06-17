import {
  DurableContext,
  withDurableExecution,
  Serdes,
  SerdesContext,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Run in Child Context with Serdes",
  description:
    "Verifies runInChildContext with a custom serdes returns " +
    "deserialize(serialize(result)) on first run to match replay behavior " +
    "(small payload case).",
};

/**
 * Custom serdes that uppercases on serialize and returns as-is on deserialize.
 * This makes it trivial to detect whether the result went through ser/des:
 * - If the result is UPPERCASE, serialize ran and its output flowed back through
 *   deserialize (the full round-trip was applied).
 * - If the result is lowercase, the raw in-memory value was returned without
 *   the round-trip.
 *
 * Shared by the small-payload (this file), large-payload, and virtual-context
 * serdes examples so all three modes assert identical round-trip behavior.
 */
export const uppercaseSerdes: Serdes<string> = {
  serialize: async (value: string | undefined, _context: SerdesContext) => {
    if (value === undefined) return undefined;
    return value.toUpperCase();
  },
  deserialize: async (data: string | undefined, _context: SerdesContext) => {
    return data;
  },
};

/**
 * Small payload case: result fits under the checkpoint size limit and is
 * checkpointed directly. First run returns deserialize(serialize(result)) =
 * "HELLO", matching what replay returns (deserialized from the checkpoint).
 */
export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const childResult = await context.runInChildContext(
      "serdes-child",
      async (childContext: DurableContext) => {
        return await childContext.step("inner-step", async () => {
          return (event as string) || "hello";
        });
      },
      { serdes: uppercaseSerdes },
    );

    // Capture result in a step to checkpoint what was returned on first invocation.
    const captured = await context.step("capture-result", async () => {
      return childResult;
    });

    // Wait forces a second invocation (replay).
    await context.wait("force-replay", { seconds: 1 });

    return { capturedOnFirstRun: captured };
  },
);
