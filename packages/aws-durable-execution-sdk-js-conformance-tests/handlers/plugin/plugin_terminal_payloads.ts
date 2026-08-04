// 10-14: Operation-end info carries the checkpointed result on success and the error on failure
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

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
      emit({
        plugin: PLUGIN,
        hook: "operation-end",
        op: info.id,
        status: info.status,
        // Raw serialized result exactly as checkpointed (e.g. '"task-a"'), or
        // the literal NONE when absent.
        result: info.result != null ? info.result : "NONE",
        error: info.error?.message != null ? info.error.message : "NONE",
      });
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Step A: succeeds returning the constant "task-a".
    await context.step(async () => "task-a");
    // Step B: always throws "boom" with no retries (max attempts 1), so the
    // execution fails.
    await context.step(
      async () => {
        throw new Error("boom");
      },
      { retryStrategy: createRetryStrategy({ maxAttempts: 1 }) },
    );
    return "unreachable";
  },
  { plugins: [makePlugin()] },
);
