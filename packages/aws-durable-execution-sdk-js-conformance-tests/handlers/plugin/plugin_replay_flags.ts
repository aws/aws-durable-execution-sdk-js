// 10-13: Plugin replay flag on operation-start for a retried step
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void => {
    process.stdout.write(
      JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n",
    );
  };

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
    },
    async onOperationStart(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-start",
        op: info.id,
        replay: info.isReplay,
      });
    },
    async onOperationEnd(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-end",
        op: info.id,
        status: info.status,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Step A: succeeds on its first attempt (terminal before any replay).
    await context.step(async () => "step-a");
    // Step B: fails on its first attempt and succeeds on the second, using the
    // SDK's real retry strategy.
    await context.step(
      async (stepContext) => {
        if (stepContext.attempt < 2) {
          throw new Error("step B first attempt failed");
        }
        return "step-b";
      },
      {
        retryStrategy: createRetryStrategy({
          maxAttempts: 2,
          initialDelay: { seconds: 1 },
          jitter: JitterStrategy.NONE,
        }),
      },
    );
    return "Operation succeeded";
  },
  { plugins: [makePlugin()] },
);
