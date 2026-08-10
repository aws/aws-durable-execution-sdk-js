/**
 * Fixture workflow for the LLRT compatibility check.
 *
 * Covers the durable primitives that touch the runtime surfaces a lightweight runtime is most
 * likely to differ on: steps (id hashing via node:crypto, JSON serdes), a retrying step
 * (error serialization), a wait (suspend and replay across invocations), a child context and a
 * parallel block (operation-context tracking), and logging at root and step scope.
 */

import {
  withDurableExecution,
  createRetryStrategy,
} from "@aws/durable-execution-sdk-js";

let attempts = 0;

export const workflow = async (event, ctx) => {
  ctx.logger.info("workflow starting", { userId: event.userId });

  const validated = await ctx.step("validate", async (stepCtx) => {
    stepCtx.logger.debug("validating", event);
    return { ...event, validated: true };
  });

  // Fails once, then succeeds: drives the RETRY checkpoint path and error serialization.
  const flaky = await ctx.step(
    "flaky",
    async () => {
      attempts++;
      if (attempts < 2) throw new Error("transient failure");
      return { attempts };
    },
    {
      retryStrategy: createRetryStrategy({
        maxAttempts: 3,
        initialIntervalSeconds: 1,
      }),
    },
  );

  await ctx.wait({ seconds: 30 });

  const child = await ctx.runInChildContext("enrich", async (childCtx) =>
    childCtx.step("lookup", async () => ({ tier: "gold" })),
  );

  const parallel = await ctx.parallel("fanout", [
    async (c) => c.step("p1", async () => 1),
    async (c) => c.step("p2", async () => 2),
  ]);
  const parallelResults = parallel.succeeded().map((item) => item.result);

  ctx.logger.info("workflow done", {
    validated,
    flaky,
    child,
    parallelResults,
  });

  return {
    validated,
    flaky,
    child,
    parallelResults,
    sum: parallelResults.reduce((a, b) => a + b, 0),
  };
};

export const handler = withDurableExecution(workflow);
