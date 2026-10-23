// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// The same public-API workflows run against the local transport and real LMI.
// Gates and BODY records are test instrumentation, never persisted business state.
export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const noRetry = { retryStrategy: () => ({ shouldRetry: false }) };

export async function workflow(event, ctx, io) {
  if (event.scenario === "quiescence")
    return ctx.step("snapshot", () => io.snapshot());
  const body = async (name, value = event.marker) => {
    await io.record("BODY", { operation: name });
    return value;
  };
  const success = await ctx.step("success", () => body("success"));
  if (event.scenario === "success") return success;
  if (event.scenario === "failure") throw new Error(`expected:${success}`);
  if (event.scenario === "barrier") {
    await ctx.step("barrier", () => io.hold("peer"));
    // A real checkpoint after the other invocation closes tests shared-client use.
    return ctx.step("peer-after", () => body("peer-after"));
  }
  if (event.scenario === "replay") {
    try {
      await ctx.step(
        "stored-failure",
        async () => {
          await body("stored-failure");
          throw new Error(`stored:${success}`);
        },
        noRetry,
      );
    } catch (error) {
      await io.record("STORED_FAILURE", { message: error.message });
    }
    try {
      await ctx.wait("pause", { seconds: 5 });
    } catch (error) {
      await io.record("COMPENSATION");
      throw error;
    } finally {
      await io.record("WAIT_FINALLY");
    }
    return ctx.step("after-wait", () => body("after-wait"));
  }
  if (event.scenario === "nested-progress") {
    await ctx.step("progress-barrier", () => io.hold("peer"));
    return ctx.runInChildContext("outer", async (child) => {
      const result = await child.map(
        "map",
        [1, 2],
        async (itemCtx, item) => {
          const branches = await itemCtx.parallel(
            "parallel",
            [
              async (branch) => branch.step("left", () => body("left", item)),
              async (branch) =>
                branch.step("right", () => body("right", item * 10)),
            ],
            { maxConcurrency: 1 },
          );
          branches.throwIfError();
          return branches.getResults();
        },
        { maxConcurrency: 1 },
      );
      result.throwIfError();
      return result.getResults();
    });
  }
  if (event.scenario.startsWith("deadline")) {
    await ctx.step("blocked", async () => {
      await io.hold("loser");
      return body("blocked-effect");
    });
    return ctx.step("after-deadline", () => body("after-deadline"));
  }

  const entered = deferred();
  const slow = async (child) => {
    try {
      return await child.step("loser", async () => {
        // hold signals only after verifying that its external gate is closed.
        await io.hold("loser", entered.resolve);
        return body("loser-effect");
      });
    } finally {
      await io.record("CHILD_FINALLY");
      // A residual branch must not start this new durable operation after closure.
      await child.step("late-operation", () => body("late-operation"));
    }
  };
  const fast = async (child) =>
    child.step("winner", async () => {
      await entered.promise;
      await io.hold("winner");
      return body("winner", "winner");
    });
  let result;
  if (
    ["race", "any", "return-inflight", "failure-inflight"].includes(
      event.scenario,
    )
  ) {
    const loser = ctx.runInChildContext("slow", slow);
    // Observe rejections from deliberately abandoned work, without changing it.
    Promise.resolve(loser).catch((error) =>
      io.record("CHILD_REJECTED", { error: error.name }),
    );
    if (event.scenario.endsWith("inflight")) {
      await entered.promise;
      await io.hold("winner");
      if (event.scenario === "failure-inflight")
        throw new Error(`expected:${success}`);
      result = "winner";
    } else {
      const winner = ctx.runInChildContext("fast", fast);
      result = await ctx.promise[event.scenario]("first", [winner, loser]);
    }
  } else {
    const batch = async (parent) =>
      event.scenario === "map"
        ? parent.map(
            "batch",
            ["fast", "slow"],
            (child, item) => (item === "fast" ? fast(child) : slow(child)),
            {
              maxConcurrency: 2,
              completionConfig: { minSuccessful: 1 },
            },
          )
        : parent.parallel("batch", [fast, slow], {
            maxConcurrency: 2,
            completionConfig: { minSuccessful: 1 },
          });
    const finishBatch = async (parent) => {
      const batchResult = await batch(parent);
      batchResult.throwIfError();
      return batchResult.getResults();
    };
    result =
      event.scenario === "nested"
        ? await ctx.runInChildContext("outer", finishBatch)
        : await finishBatch(ctx);
  }
  await io.record("WINNER_SELECTED");
  return result;
}
