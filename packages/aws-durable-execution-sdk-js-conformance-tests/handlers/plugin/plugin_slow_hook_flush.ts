// 10-18: Slow work in a plugin hook completes and its record is emitted before the invocation ends
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n");

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
    },
    async onOperationEnd(info): Promise<void> {
      if (!isStep(info.type)) return;
      // The SDK awaits this hook before returning the Lambda response, so ~1s
      // of real awaited work must complete (and its record be emitted) before
      // the environment freezes. This is the real await contract, not a mock.
      await sleep(1000);
      emit({
        plugin: PLUGIN,
        hook: "slow-operation-end",
        op: info.id,
        status: info.status,
      });
    },
    async onInvocationEnd(info): Promise<void> {
      emit({ plugin: PLUGIN, hook: "invocation-end", status: info.status });
    },
  };
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    return await context.step(async () => `Hello, ${event}!`);
  },
  { plugins: [makePlugin()] },
);
