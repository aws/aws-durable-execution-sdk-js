// 10-2: Plugin operation lifecycle hooks (step start and terminal end)
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports step-operation lifecycle via CloudWatch.
// Filters to step-type operations only (subType === "Step"). operation-start
// fires when the step's STARTED checkpoint is observed; operation-end fires when
// the step reaches its terminal status, carrying the operation-status enum token.
const operationLifecyclePlugin: DurableInstrumentationPlugin = {
  async onOperationStart(info) {
    if (info.subType !== "Step") return;
    console.log(`CONFPLUGIN operation-start op=${info.id}`);
  },
  async onOperationEnd(info) {
    if (info.subType !== "Step") return;
    console.log(`CONFPLUGIN operation-end op=${info.id} status=${info.status}`);
  },
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
