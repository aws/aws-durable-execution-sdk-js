import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Force Checkpointing - Callback",
  description:
    "Demonstrates force checkpoint polling when a long-running operation blocks termination while another branch performs multiple sequential callbacks",
};

export const handler = withDurableExecution(
  async (_event, ctx: DurableContext): Promise<string> => {
    const results = await ctx.parallel([
      // Branch 1: Long-running operation that blocks termination
      async (branchCtx: DurableContext) => {
        return await branchCtx.step("long-running-step", async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000));
          return "long-complete";
        });
      },
      // Branch 2: Multiple sequential callbacks that need force checkpoint
      async (branchCtx: DurableContext) => {
        const [callback1Promise] = await branchCtx.createCallback("callback-1");
        await callback1Promise;

        const [callback2Promise] = await branchCtx.createCallback("callback-2");
        await callback2Promise;

        const [callback3Promise] = await branchCtx.createCallback("callback-3");
        await callback3Promise;

        return "callbacks-complete";
      },
    ]);

    return JSON.stringify(results);
  },
);
