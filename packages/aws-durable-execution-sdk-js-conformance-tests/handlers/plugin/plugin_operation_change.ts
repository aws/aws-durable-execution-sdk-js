// 10-8: Plugin operation-change hook reports updated operations and the full map
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n",
    );
  };

  return {
    async onInvocationStart(info): Promise<void> {
      // Capture the execution ARN so every subsequent record is scoped to it.
      executionArn = info.executionArn;
    },
    async onOperationChange(info): Promise<void> {
      const fullMap = info.operations;
      for (const [id, op] of Object.entries(info.updatedOperations)) {
        // Filter to step-type operations only.
        if ((op.type || "").toUpperCase() !== "STEP") continue;
        emit({
          plugin: PLUGIN,
          hook: "operation-change",
          op: id,
          status: op.status,
          in_full_map: id in fullMap,
        });
      }
    },
  };
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    return await context.step(async () => `Hello, ${event}!`);
  },
  { plugins: [makePlugin()] },
);
