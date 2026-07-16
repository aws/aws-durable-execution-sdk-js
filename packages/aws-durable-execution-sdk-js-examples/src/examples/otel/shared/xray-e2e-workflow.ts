import {
  DurableContext,
  createRetryStrategy,
} from "@aws/durable-execution-sdk-js";

/**
 * Common workflow body shared by all XRay E2E handler variants
 * (community-collector-execution, community-collector-invocation,
 * adot-execution, adot-invocation).
 *
 * Exercises multiple operation types for X-Ray verification:
 * steps, waits, child contexts, and retry logic.
 */
export async function xrayE2eWorkflow(context: DurableContext) {
  // Derive trace ID from X-Ray header for test assertions
  const xRayHeader = process.env._X_AMZN_TRACE_ID;

  // Exercise multiple operation types for X-Ray verification
  const step1 = await context.step("fetch-data", async () => "data-value");

  // Wait to force a multi-invocation workflow, ensuring the Workflow span
  // spans across invocations and is only exported on terminal status.
  await context.wait("short-pause", { seconds: 1 });

  const step2 = await context.step(
    "process-data",
    async () => `processed-${step1}`,
  );

  const childResult = await context.runInChildContext(
    "child-operations",
    async (childCtx: DurableContext) => {
      const inner = await childCtx.step(
        "inner-step",
        async () => "inner-value",
      );

      await childCtx.step(
        "fails-then-succeeds",
        async (stepCtx) => {
          if (stepCtx.attempt < 3) {
            throw new Error(
              `intentional failure on attempt ${stepCtx.attempt}`,
            );
          }
          return "succeeded-on-third-attempt";
        },
        {
          retryStrategy: createRetryStrategy({
            maxAttempts: 3,
            initialDelay: { seconds: 1 },
            backoffRate: 1,
          }),
        },
      );

      return inner;
    },
  );

  return { xRayHeader, step1, step2, childResult };
}
