// 10-9: Plugin observes an externally-updated wait on re-invocation
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

const makePlugin: DurableInstrumentationPluginFactory = {
  createPlugin: (invocation) => {
    const emit = (rec: Record<string, unknown>): void => {
      process.stdout.write(
        JSON.stringify({
          ...rec,
          durableExecutionArn: invocation.executionArn,
        }) + "\n",
      );
    };

    return {
      async onInvocationStart(info): Promise<void> {
        // JS surfaces externally-completed operations as `updatedOperations` on
        // the invocation-start info. Filter to wait-type operations and emit one
        // record each.
        for (const [id, op] of Object.entries(info.updatedOperations)) {
          if ((op.type || "").toUpperCase() !== "WAIT") continue;
          emit({
            plugin: PLUGIN,
            hook: "updated-on-invoke",
            op: id,
            status: op.status,
            first: info.isFirstInvocation,
          });
        }
      },
    };
  },
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    await context.wait({ seconds: 2 });
    return "Wait completed";
  },
  { plugins: [makePlugin] },
);
