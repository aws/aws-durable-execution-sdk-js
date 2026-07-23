// 10-4: Plugin exceptions are swallowed and never affect the execution outcome
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Faulty instrumentation plugin: every hook first logs its line and then throws.
// The SDK must catch and ignore every plugin exception, so the execution result
// and history are identical to running without the plugin. Operation/attempt
// hooks filter to step-type operations only.
const faultyPlugin: DurableInstrumentationPlugin = {
  async onInvocationStart() {
    console.log(`CONFPLUGIN faulty invocation-start`);
    throw new Error("faulty invocation-start");
  },
  async onInvocationEnd() {
    console.log(`CONFPLUGIN faulty invocation-end`);
    throw new Error("faulty invocation-end");
  },
  async onOperationStart(info) {
    if (info.subType !== "Step") return;
    console.log(`CONFPLUGIN faulty operation-start`);
    throw new Error("faulty operation-start");
  },
  async onOperationEnd(info) {
    if (info.subType !== "Step") return;
    console.log(`CONFPLUGIN faulty operation-end`);
    throw new Error("faulty operation-end");
  },
  async onOperationAttemptStart(info) {
    if (info.subType !== "Step") return;
    console.log(`CONFPLUGIN faulty attempt-start`);
    throw new Error("faulty attempt-start");
  },
  async onOperationAttemptEnd(info) {
    if (info.subType !== "Step") return;
    console.log(`CONFPLUGIN faulty attempt-end`);
    throw new Error("faulty attempt-end");
  },
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
  { plugins: [faultyPlugin] },
);
