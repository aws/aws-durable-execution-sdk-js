import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { uppercaseSerdes } from "../../shared/uppercase-serdes";

export const config: ExampleConfig = {
  name: "Run in Child Context with Serdes",
  description:
    "Verifies runInChildContext with a custom serdes returns " +
    "deserialize(serialize(result)) on first run to match replay behavior " +
    "(small payload case).",
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
