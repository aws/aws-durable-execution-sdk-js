// 10-3: Plugin attempt hooks fire per step attempt with attempt number and outcome
import {
  DurableContext,
  DurableInstrumentationPluginFactory,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports per-attempt step lifecycle via CloudWatch.
// Filters to step-type operations only. attempt-start fires when a step attempt's
// user function starts; attempt-end fires when it finishes, carrying the 1-based
// attempt number and the outcome enum token (SUCCEEDED / FAILED). These hooks run
// on the same thread as the user function, so their relative order is deterministic.
//
// One instance serves one invocation, so the execution ARN is taken from the
// InvocationInfo handed to the factory and stamped on every emitted record as a
// top-level field (the runner's CloudWatch JSON filter is $.durableExecutionArn).
// No hook is needed just to learn the ARN.
const attemptHooksPlugin: DurableInstrumentationPluginFactory = (
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
    async onOperationAttemptStart(info) {
      if (info.subType !== "Step") return;
      emit({
        plugin: "CONFPLUGIN",
        hook: "attempt-start",
        n: info.attempt,
        op: info.id,
      });
    },
    async onOperationAttemptEnd(info) {
      if (info.subType !== "Step") return;
      emit({
        plugin: "CONFPLUGIN",
        hook: "attempt-end",
        n: info.attempt,
        outcome: info.outcome,
        op: info.id,
      });
    },
  };
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async (stepContext) => {
        // Native per-step attempt counter (1 on first execution, incremented
        // by 1 on each retry). Fails once, then succeeds on the second attempt.
        if (stepContext.attempt < 2) {
          throw new Error(`Attempt ${stepContext.attempt} failed`);
        }
        return "Operation succeeded";
      },
      {
        retryStrategy: (_error: Error, attempts: number) => {
          if (attempts >= 3) {
            return { shouldRetry: false };
          }
          return { shouldRetry: true, delay: { seconds: 1 } };
        },
      },
    );
    return result;
  },
  { plugins: [attemptHooksPlugin] },
);
