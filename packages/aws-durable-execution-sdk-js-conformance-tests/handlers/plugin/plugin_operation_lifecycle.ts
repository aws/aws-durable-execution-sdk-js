// 10-2: Plugin operation lifecycle hooks (step start and terminal end)
import {
  DurableContext,
  DurableInstrumentationPluginFactory,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports step-operation lifecycle via CloudWatch.
// Filters to step-type operations only (subType === "Step"). operation-start
// fires when the step's STARTED checkpoint is observed; operation-end fires when
// the step reaches its terminal status, carrying the operation-status enum token.
//
// One instance serves one invocation, so the execution ARN is taken from the
// InvocationInfo handed to the factory and stamped on every operation record as
// a top-level field. No hook is needed just to learn the ARN.
const operationLifecyclePlugin: DurableInstrumentationPluginFactory = (
  invocation,
) => {
  // Emit one record as a raw top-level JSON line (unwrapped by the Node runtime's
  // JSON log envelope).
  const emit = (record: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({
        ...record,
        durableExecutionArn: invocation.executionArn,
      }) + "\n",
    );
  };

  return {
    async onOperationStart(info) {
      if (info.subType !== "Step") return;
      emit({
        plugin: "CONFPLUGIN",
        hook: "operation-start",
        op: info.id,
      });
    },
    async onOperationEnd(info) {
      if (info.subType !== "Step") return;
      emit({
        plugin: "CONFPLUGIN",
        hook: "operation-end",
        op: info.id,
        status: info.status,
      });
    },
  };
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [operationLifecyclePlugin] },
);
