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
    "Verifies runInChildContext with custom serdes returns " +
    "deserialize(serialize(result)) on first run to match replay behavior.",
};

/**
 * Custom serdes that uppercases on serialize and returns as-is on deserialize.
 * This makes it easy to detect whether the result went through ser/des:
 * - If the result is uppercase, it went through serialize → deserialize
 * - If the result is lowercase, it was returned raw without the round-trip
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
 * Standard case: small payload with custom serdes.
 * First run should return deserialize(serialize(result)) = "HELLO".
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

/**
 * Large payload case: exceeds 256KB checkpoint limit, triggers ReplayChildren.
 * First run should return the raw result (replay re-executes the child function).
 */
export const largePayloadHandler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // 300KB string exceeds the 256KB CHECKPOINT_SIZE_LIMIT_BYTES
    const largeValue = "x".repeat(300 * 1024);

    const childResult = await context.runInChildContext(
      "large-child",
      async (childContext: DurableContext) => {
        return await childContext.step("large-step", async () => {
          return largeValue;
        });
      },
      { serdes: uppercaseSerdes },
    );

    // Capture to checkpoint what was returned on first run.
    const captured = await context.step("capture-large-result", async () => {
      // Only capture the first 10 chars + length to avoid huge checkpoint
      return {
        prefix: childResult.substring(0, 10),
        length: childResult.length,
      };
    });

    await context.wait("force-replay-large", { seconds: 1 });

    return captured;
  },
);

/**
 * Virtual context case: virtualContext=true means no checkpointing.
 * First run should return the raw result (no replay path to match).
 */
export const virtualContextHandler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const childResult = await context.runInChildContext(
      "virtual-child",
      async (childContext: DurableContext) => {
        return await childContext.step("virtual-step", async () => {
          return (event as string) || "hello";
        });
      },
      { serdes: uppercaseSerdes, virtualContext: true },
    );

    // Capture what was returned from the virtual child context.
    const captured = await context.step("capture-virtual-result", async () => {
      return childResult;
    });

    await context.wait("force-replay-virtual", { seconds: 1 });

    return { capturedOnFirstRun: captured };
  },
);
