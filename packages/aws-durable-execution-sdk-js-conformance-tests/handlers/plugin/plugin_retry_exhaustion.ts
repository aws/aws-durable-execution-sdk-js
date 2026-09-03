// 10-15: Attempt hooks fire for every attempt until exhaustion, then operation-end reports FAILED
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
    async onOperationAttemptStart(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "attempt-start",
        n: info.attempt,
        op: info.id,
      });
    },
    async onOperationAttemptEnd(info): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "attempt-end",
        n: info.attempt,
        outcome: info.outcome,
        op: info.id,
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
    // Single step that always throws, with a retry strategy allowing 2 total
    // attempts (1 initial + 1 retry, ~1s delay). Retries are exhausted and the
    // execution fails.
    await context.step(
      async () => {
        throw new Error("always fails");
      },
      {
        retryStrategy: createRetryStrategy({
          maxAttempts: 2,
          initialDelay: { seconds: 1 },
          jitter: JitterStrategy.NONE,
        }),
      },
    );
    return "unreachable";
  },
  { plugins: [makePlugin()] },
);
