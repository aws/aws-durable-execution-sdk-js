// 10-8: Plugin operation-change hook reports updated operations and the full map
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

const makePlugin: DurableInstrumentationPluginFactory = (invocation) => {
  // Every record is scoped to the execution the factory was called for.
  const emit = (rec: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({
        ...rec,
        durableExecutionArn: invocation.executionArn,
      }) + "\n",
    );
  };

  return {
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
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    return await context.step(async () => `Hello, ${event}!`);
  },
  { plugins: [makePlugin] },
);
