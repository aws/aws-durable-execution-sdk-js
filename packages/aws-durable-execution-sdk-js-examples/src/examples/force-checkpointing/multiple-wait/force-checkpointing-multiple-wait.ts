import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Force Checkpointing - Multiple Wait",
  description:
    "Demonstrates force checkpoint polling when a long-running operation blocks termination while another branch performs multiple sequential waits",
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
      // Branch 2: Multiple sequential waits that need force checkpoint
      async (branchCtx: DurableContext) => {
        await branchCtx.wait("wait-1", { seconds: 1 });
        await branchCtx.wait("wait-2", { seconds: 1 });
        await branchCtx.wait("wait-3", { seconds: 1 });
        await branchCtx.wait("wait-4", { seconds: 1 });
        await branchCtx.wait("wait-5", { seconds: 1 });
        return "waits-complete";
      },
    ]);

    return JSON.stringify(results);
  },
);
