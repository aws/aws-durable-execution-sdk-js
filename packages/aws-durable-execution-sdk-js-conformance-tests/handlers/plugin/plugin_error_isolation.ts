// 10-4: Plugin exceptions are swallowed and never affect the execution outcome
import {
  DurableContext,
  DurableInstrumentationPluginFactory,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Faulty instrumentation plugin: every hook first logs its line and then throws.
// The SDK must catch and ignore every plugin exception, so the execution result
// and history are identical to running without the plugin. Operation/attempt
// hooks filter to step-type operations only.
//
// One instance serves one invocation, so the execution ARN is taken from the
// InvocationInfo handed to the factory and stamped on every emitted record as a
// top-level field (the runner's CloudWatch JSON filter is $.durableExecutionArn).
const faultyPlugin: DurableInstrumentationPluginFactory = {
  createPlugin: (invocation) => {
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
      async onInvocationStart() {
        emit({ plugin: "CONFPLUGIN-FAULTY", hook: "invocation-start" });
        throw new Error("faulty invocation-start");
      },
      async onInvocationEnd() {
        emit({ plugin: "CONFPLUGIN-FAULTY", hook: "invocation-end" });
        throw new Error("faulty invocation-end");
      },
      async onOperationStart(info) {
        if (info.subType !== "Step") return;
        emit({ plugin: "CONFPLUGIN-FAULTY", hook: "operation-start" });
        throw new Error("faulty operation-start");
      },
      async onOperationEnd(info) {
        if (info.subType !== "Step") return;
        emit({ plugin: "CONFPLUGIN-FAULTY", hook: "operation-end" });
        throw new Error("faulty operation-end");
      },
      async onOperationAttemptStart(info) {
        if (info.subType !== "Step") return;
        emit({ plugin: "CONFPLUGIN-FAULTY", hook: "attempt-start" });
        throw new Error("faulty attempt-start");
      },
      async onOperationAttemptEnd(info) {
        if (info.subType !== "Step") return;
        emit({ plugin: "CONFPLUGIN-FAULTY", hook: "attempt-end" });
        throw new Error("faulty attempt-end");
      },
    };
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
