// 10-3: Plugin attempt hooks fire per step attempt with attempt number and outcome
import {
  DurableContext,
  DurableInstrumentationPlugin,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// Instrumentation plugin that reports per-attempt step lifecycle via CloudWatch.
// Filters to step-type operations only. attempt-start fires when a step attempt's
// user function starts; attempt-end fires when it finishes, carrying the 1-based
// attempt number and the outcome enum token (SUCCEEDED / FAILED). These hooks run
// on the same thread as the user function, so their relative order is deterministic.
const attemptHooksPlugin: DurableInstrumentationPlugin = {
  async onOperationAttemptStart(info) {
    if (info.subType !== "Step") return;
    console.log(
      JSON.stringify({
        plugin: "CONFPLUGIN",
        hook: "attempt-start",
        n: info.attempt,
        op: info.id,
      }),
    );
  },
  async onOperationAttemptEnd(info) {
    if (info.subType !== "Step") return;
    console.log(
      JSON.stringify({
        plugin: "CONFPLUGIN",
        hook: "attempt-end",
        n: info.attempt,
        outcome: info.outcome,
        op: info.id,
      }),
    );
  },
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
