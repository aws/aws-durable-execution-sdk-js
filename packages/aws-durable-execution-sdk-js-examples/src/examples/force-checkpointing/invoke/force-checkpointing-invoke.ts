import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Force Checkpointing - Invoke",
  description:
    "Demonstrates force checkpoint polling when a long-running operation blocks termination while another branch performs multiple sequential invokes",
};

export const handler = withDurableExecution(
  async (
    event: { functionNames: string[] },
    ctx: DurableContext,
  ): Promise<string> => {
    const results = await ctx.parallel([
      // Branch 1: Long-running operation that blocks termination
      async (branchCtx: DurableContext) => {
        return await branchCtx.step("long-running-step", async () => {
          await new Promise((resolve) => setTimeout(resolve, 20000));
          return "long-complete";
        });
      },
      // Branch 2: Multiple sequential invokes that need force checkpoint
      async (branchCtx: DurableContext) => {
        await branchCtx.invoke(event.functionNames[0], { input: "data-1" });
        await branchCtx.invoke(event.functionNames[1], { input: "data-2" });
        await branchCtx.invoke(event.functionNames[2], { input: "data-3" });
        return "invokes-complete";
      },
    ]);

    return JSON.stringify(results);
  },
);
