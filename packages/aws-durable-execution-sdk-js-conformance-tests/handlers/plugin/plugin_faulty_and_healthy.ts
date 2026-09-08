// 10-17: A faulty plugin that throws in every hook never blocks a healthy plugin or the execution
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const FAULTY = "CONFPLUGIN-FAULTY";
const HEALTHY = "CONFPLUGIN-HEALTHY";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

// Registered first: logs then throws from every exercised hook
// (invocation-start, operation-start, attempt-start, attempt-end,
// operation-end, invocation-end). The SDK must swallow each exception and
// still dispatch to the healthy plugin.
function makeFaultyPlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n",
    );
  };

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
      emit({ plugin: FAULTY, hook: "invocation-start" });
      throw new Error("faulty onInvocationStart");
    },
    async onOperationStart(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({ plugin: FAULTY, hook: "operation-start" });
      throw new Error("faulty onOperationStart");
    },
    async onOperationAttemptStart(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({ plugin: FAULTY, hook: "attempt-start" });
      throw new Error("faulty onOperationAttemptStart");
    },
    async onOperationAttemptEnd(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({ plugin: FAULTY, hook: "attempt-end" });
      throw new Error("faulty onOperationAttemptEnd");
    },
    async onOperationEnd(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({ plugin: FAULTY, hook: "operation-end" });
      throw new Error("faulty onOperationEnd");
    },
    async onInvocationEnd(): Promise<void> {
      emit({ plugin: FAULTY, hook: "invocation-end" });
      throw new Error("faulty onInvocationEnd");
    },
  };
}

// Registered second: logs normally and must still receive every corresponding
// hook despite the faulty plugin throwing at each boundary.
function makeHealthyPlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n",
    );
  };

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
      emit({
        plugin: HEALTHY,
        hook: "invocation-start",
        first: info.isFirstInvocation,
      });
    },
    async onOperationStart(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({ plugin: HEALTHY, hook: "operation-start", op: info.id });
    },
    async onOperationAttemptStart(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({ plugin: HEALTHY, hook: "attempt-start", op: info.id });
    },
    async onOperationAttemptEnd(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: HEALTHY,
        hook: "attempt-end",
        op: info.id,
        outcome: info.outcome,
      });
    },
    async onOperationEnd(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: HEALTHY,
        hook: "operation-end",
        op: info.id,
        status: info.status,
      });
    },
    async onInvocationEnd(info): Promise<void> {
      emit({ plugin: HEALTHY, hook: "invocation-end", status: info.status });
    },
  };
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    return await context.step(async () => `Hello, ${event}!`);
  },
  { plugins: [makeFaultyPlugin(), makeHealthyPlugin()] },
);
