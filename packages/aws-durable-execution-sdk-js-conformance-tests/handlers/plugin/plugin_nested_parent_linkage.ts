// 10-11: Plugin operation-end reports parent id for a step nested in a child context
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(
      JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n",
    );

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
    },
    async onOperationEnd(info): Promise<void> {
      // Report parent linkage for every operation that reaches a terminal state.
      emit({
        plugin: PLUGIN,
        hook: "operation-end",
        op: info.id,
        parent: info.parentId ? info.parentId : "NONE",
        status: info.status,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    return await context.runInChildContext(
      async (childContext: DurableContext) => {
        return await childContext.step(async () => `Hello, ${event}!`);
      },
    );
  },
  { plugins: [makePlugin()] },
);
