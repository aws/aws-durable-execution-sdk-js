// 10-10: Plugin operation-start / operation-end hooks fire for a wait operation
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isWait(type?: string): boolean {
  return (type || "").toUpperCase() === "WAIT";
}

const makePlugin: DurableInstrumentationPluginFactory = (invocation) => {
  const emit = (rec: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({
        ...rec,
        durableExecutionArn: invocation.executionArn,
      }) + "\n",
    );
  };

  return {
    async onOperationStart(info): Promise<void> {
      if (!isWait(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-start",
        op: info.id,
        type: (info.type || "").toUpperCase(),
      });
    },
    async onOperationEnd(info): Promise<void> {
      if (!isWait(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-end",
        op: info.id,
        type: (info.type || "").toUpperCase(),
        status: info.status,
      });
    },
  };
};

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    await context.wait({ seconds: 2 });
    return "Wait completed";
  },
  { plugins: [makePlugin] },
);
