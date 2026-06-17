import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { uppercaseSerdes } from "../serdes/run-in-child-context-serdes";

export const config: ExampleConfig = {
  name: "Run in Child Context with Serdes - Virtual",
  description:
    "Verifies runInChildContext applies the serdes round-trip for virtual " +
    "contexts (virtualContext=true, never checkpointed) so the result is " +
    "consistent with the small-payload and large-payload modes.",
};

/**
 * Virtual context case: virtualContext=true means the child context is never
 * checkpointed and is always re-executed in memory. The returned value still
 * passes through deserialize(serialize(result)), so the caller observes the
 * same serdes round-trip as the small- and large-payload modes.
 *
 * With uppercaseSerdes, "hello" comes back as "HELLO" — proving the round-trip
 * was applied even though nothing was persisted.
 */
export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const childResult = await context.runInChildContext(
      "virtual-serdes-child",
      async (childContext: DurableContext) => {
        return await childContext.step("virtual-step", async () => {
          return (event as string) || "hello";
        });
      },
      { serdes: uppercaseSerdes, virtualContext: true },
    );

    // Capture what the virtual child context returned on first run.
    const captured = await context.step("capture-virtual-result", async () => {
      return childResult;
    });

    // Wait forces a second invocation (replay) to confirm first-run == replay.
    await context.wait("force-replay-virtual", { seconds: 1 });

    return { capturedOnFirstRun: captured };
  },
);
