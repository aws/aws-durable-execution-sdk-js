// 10-21: Attempt hook info field shape (interface-shape probe)
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
  DurableInstrumentationPlugin,
  InvocationInfo,
  AttemptInfo,
  AttemptEndInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
}

// INTERFACE-SHAPE probe: every logged field is read from the CURRENT hook's own
// info parameter. When the SDK's info type does not expose a field, the
// corresponding has_* flag is emitted false; that omission is the honest signal
// of a missing API surface.
function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n");

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      // ARN captured only for durableExecutionArn stamping (unasserted).
      executionArn = info.executionArn;
    },
    async onOperationAttemptStart(info: AttemptInfo): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "attempt-start",
        op: info.id,
        name: info.name,
        type: (info.type || "").toUpperCase(),
        attempt: info.attempt,
        has_start_time: info.startTimestamp != null,
      });
    },
    async onOperationAttemptEnd(info: AttemptEndInfo): Promise<void> {
      if (!isStep(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "attempt-end",
        op: info.id,
        name: info.name,
        type: (info.type || "").toUpperCase(),
        attempt: info.attempt,
        // The attempt outcome as reported by the info parameter (SUCCEEDED / FAILED).
        outcome: info.outcome,
        has_error: info.error != null,
      });
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    return await context.step(
      "flaky",
      async (stepContext) => {
        // Real per-step attempt counter: fails attempt 1, succeeds attempt 2.
        if (stepContext.attempt < 2) {
          throw new Error(`Attempt ${stepContext.attempt} failed`);
        }
        return "ok";
      },
      {
        // Real built-in retry strategy: up to 2 attempts, deterministic ~1s delay.
        retryStrategy: createRetryStrategy({
          maxAttempts: 2,
          initialDelay: { seconds: 1 },
          jitter: JitterStrategy.NONE,
        }),
      },
    );
  },
  { plugins: [makePlugin()] },
);
