import assert from "node:assert/strict";
import { test } from "node:test";
import { hashId } from "../src/ids.js";
import { runDurable } from "../src/testing/index.js";
import { createFakeClient, executionOp } from "./helpers/fake-client.js";
import { invoke } from "./helpers/invoke.js";

const noRetry = () => ({ shouldRetry: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byId = (run, rawId) =>
  run.operations.find((op) => op.Id === hashId(rawId));
const brief = (r) => ({
  all: r.all.map(({ index, status, result, error }) => ({
    index,
    status,
    ...(result !== undefined && { result }),
    ...(error && { errorType: error.errorType, message: error.message }),
  })),
  completionReason: r.completionReason,
});

// Items run one at a time, so the order in which they settle is the index order.
// "F" fails, anything else succeeds.
async function runMap(items, completionConfig) {
  const calls = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items,
        maxConcurrency: 1,
        completionConfig,
        fn: ({ item, index }) => {
          calls.push(index);
          if (item === "F") throw new Error("f");
          return item;
        },
      });
      return {
        statuses: r.all.map((i) => i.status[0]),
        reason: r.completionReason,
      };
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  return { ...run.result, calls };
}

test("thresholds, percentage formula and completionReason precedence match the full SDK", async () => {
  const cases = [
    // No config and an empty config both fail fast.
    [["F", "S"], undefined, "F", "FAILURE_TOLERANCE_EXCEEDED"],
    [["F", "S"], {}, "F", "FAILURE_TOLERANCE_EXCEEDED"],
    // A failure tolerance stops when failures > toleratedFailureCount.
    [
      ["F", "F", "S", "F", "S"],
      { toleratedFailureCount: 2 },
      "FFSF",
      "FAILURE_TOLERANCE_EXCEEDED",
    ],
    [
      ["F", "F", "S", "F", "S"],
      { toleratedFailureCount: 3 },
      "FFSFS",
      "ALL_COMPLETED",
    ],
    // The percentage is failures / all items. 1 of 5 is 20 %, which is not > 20.
    [
      ["F", "S", "S", "S", "S"],
      { toleratedFailurePercentage: 20 },
      "FSSSS",
      "ALL_COMPLETED",
    ],
    // 2 of 5 is 40 %. A divisor of settled items would have stopped after "SF".
    [
      ["S", "F", "S", "F", "S"],
      { toleratedFailurePercentage: 20 },
      "SFSF",
      "FAILURE_TOLERANCE_EXCEEDED",
    ],
    // minSuccessful alone sets no failure limit.
    [
      ["F", "F", "S", "S", "S"],
      { minSuccessful: 2 },
      "FFSS",
      "MIN_SUCCESSFUL_REACHED",
    ],
    [
      ["S", "S", "F"],
      { minSuccessful: 2, toleratedFailureCount: 0 },
      "SS",
      "MIN_SUCCESSFUL_REACHED",
    ],
    [
      ["F", "S"],
      { minSuccessful: 1, toleratedFailureCount: 0 },
      "F",
      "FAILURE_TOLERANCE_EXCEEDED",
    ],
    // All items finished: ALL_COMPLETED wins over MIN_SUCCESSFUL_REACHED.
    [["S", "S", "S"], { minSuccessful: 3 }, "SSS", "ALL_COMPLETED"],
    // An exceeded tolerance wins over ALL_COMPLETED.
    [["S", "S", "F"], undefined, "SSF", "FAILURE_TOLERANCE_EXCEEDED"],
    [["S", "S"], undefined, "SS", "ALL_COMPLETED"],
  ];
  for (const [items, config, statuses, reason] of cases) {
    const r = await runMap(items, config);
    const label = JSON.stringify({ items, config });
    assert.equal(r.statuses.join(""), statuses, label);
    assert.equal(r.reason, reason, label);
    // Items after the decision never start.
    assert.deepEqual(
      r.calls,
      [...statuses].map((_, i) => i),
      label,
    );
  }
});

test("default fail fast: running items are abandoned and send no more updates", async () => {
  const calls = { slow: 0, last: 0, after: 0, others: 0 };
  const slowStep = (key) => ({
    fn: async () => {
      calls[key]++;
      await sleep(30);
      return key;
    },
  });
  const { output, updates } = await invoke(async ({ ctx }) => {
    const r = await ctx.map({
      name: "m",
      items: ["fail", "slow", "last", "x", "y"],
      maxConcurrency: 3,
      fn: async ({ ctx: c, item }) => {
        if (item === "fail") {
          return c.step({
            retryStrategy: noRetry,
            fn: async () => {
              await sleep(5);
              throw new TypeError("bad");
            },
          });
        }
        if (item === "slow") {
          await c.step(slowStep("slow"));
          // A child context runs fn without a step, so only _mayRun stops it.
          return c.runInChildContext({ fn: () => calls.after++ });
        }
        // An at-least-once step returns without waiting for its SUCCEED. So this item's
        // fn returns after the batch decided. Its context's SUCCEED must not be sent.
        if (item === "last") return c.step(slowStep("last"));
        calls.others++;
      },
    });
    // The workflow keeps running until the abandoned steps' fns have finished.
    await ctx.step({ fn: () => sleep(60) });
    return brief(r);
  });
  assert.deepEqual(JSON.parse(output.Result), {
    all: [
      { index: 0, status: "FAILED", errorType: "TypeError", message: "bad" },
      { index: 1, status: "STARTED" },
      { index: 2, status: "STARTED" },
    ],
    completionReason: "FAILURE_TOLERANCE_EXCEEDED",
  });
  // Each abandoned step's fn ran once. The later operation and items 3 and 4 never ran.
  assert.deepEqual(calls, { slow: 1, last: 1, after: 0, others: 0 });

  const abandoned = ["1-2", "1-2-1", "1-2-2", "1-3", "1-3-1"].map(hashId);
  assert.deepEqual(
    updates
      .filter((u) => abandoned.includes(u.Id))
      .map((u) => [u.Id, u.Action])
      .sort(),
    [
      [hashId("1-2"), "START"],
      [hashId("1-2-1"), "START"],
      [hashId("1-3"), "START"],
      [hashId("1-3-1"), "START"],
    ].sort(),
  );
  assert.equal(
    updates.some((u) => [hashId("1-4"), hashId("1-5")].includes(u.Id)),
    false,
  );
  // No update for an operation inside the batch follows the batch's SUCCEED.
  const close = updates.findIndex(
    (u) => u.Id === hashId("1") && u.Action === "SUCCEED",
  );
  const inside = new Set([hashId("1-1"), hashId("1-1-1"), ...abandoned]);
  assert.equal(
    updates.slice(close + 1).some((u) => inside.has(u.Id)),
    false,
  );
  const stored = JSON.parse(updates[close].Payload);
  assert.deepEqual(stored.all.slice(1), [
    { index: 1, status: "STARTED" },
    { index: 2, status: "STARTED" },
  ]);
  assert.equal(stored.completionReason, "FAILURE_TOLERANCE_EXCEEDED");
});

test("minSuccessful abandons a running branch; the replay returns the same result", async () => {
  const calls = { a: 0, b: 0, slow: 0, after: 0 };
  const seen = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.parallel({
        completionConfig: { minSuccessful: 2 },
        branches: [
          { fn: ({ ctx: c }) => c.step({ fn: () => ++calls.a }) },
          { fn: ({ ctx: c }) => c.step({ fn: () => ++calls.b }) },
          {
            name: "slow",
            fn: async ({ ctx: c }) => {
              await c.step({
                fn: async () => {
                  calls.slow++;
                  await sleep(20);
                },
              });
              return c.step({ fn: () => calls.after++ });
            },
          },
        ],
      });
      seen.push(brief(r));
      await ctx.wait({ seconds: 1 });
      return seen.at(-1);
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.invocations, 2);
  assert.deepEqual(seen[0], {
    all: [
      { index: 0, status: "SUCCEEDED", result: 1 },
      { index: 1, status: "SUCCEEDED", result: 1 },
      { index: 2, status: "STARTED" },
    ],
    completionReason: "MIN_SUCCESSFUL_REACHED",
  });
  // The second invocation rebuilt the result from the stored JSON. No branch ran again.
  assert.deepEqual(seen[1], seen[0]);
  assert.deepEqual(calls, { a: 1, b: 1, slow: 1, after: 0 });
  // The slow step's fn finished, but its SUCCEED was never sent.
  assert.equal(byId(run, "1-3").Status, "STARTED");
  assert.equal(byId(run, "1-3-1").Status, "STARTED");
  assert.equal(byId(run, "1-3-2"), undefined);
});

test("with maxConcurrency, items that did not start never start in later invocations", async () => {
  const fnCalls = [0, 0, 0, 0, 0];
  const stepCalls = [0, 0];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [10, 20, 1, 1, 1],
        maxConcurrency: 2,
        fn: async ({ ctx: c, item, index }) => {
          fnCalls[index]++;
          await c.wait({ seconds: item });
          return c.step({
            retryStrategy: noRetry,
            fn: () => {
              stepCalls[index]++;
              if (index === 0) throw new Error("first");
              return index;
            },
          });
        },
      });
      // Item 1's wait ends at 20 s, during this wait. Its step still must not run.
      await ctx.wait({ seconds: 100 });
      return brief(r);
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, {
    all: [
      { index: 0, status: "FAILED", errorType: "Error", message: "first" },
      { index: 1, status: "STARTED" },
    ],
    completionReason: "FAILURE_TOLERANCE_EXCEEDED",
  });
  // Invocations: both items wait; item 0 fails; item 1's wait ends; the main wait ends.
  assert.equal(run.invocations, 4);
  assert.deepEqual(fnCalls.slice(2), [0, 0, 0]);
  assert.deepEqual(stepCalls, [1, 0]);
  for (const id of ["1-2-2", "1-3", "1-4", "1-5"]) {
    assert.equal(byId(run, id), undefined, id);
  }
});

test("a large early-completed map: the ReplayChildren re-run returns the live result", async () => {
  // Items settle in the order 1, 2, 0. So the live run decides with items 0, 1 and 2
  // finished. Cached items settle in index order: a second scheduler run would reach
  // minSuccessful at items 0 and 1, and would report item 2 as STARTED.
  const delays = [40, 5, 20, 150];
  const stepCalls = [0, 0, 0, 0];
  const seen = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: delays,
        completionConfig: { minSuccessful: 2, toleratedFailureCount: 1 },
        fn: ({ ctx: c, item, index }) =>
          c.step({
            retryStrategy: noRetry,
            fn: async () => {
              stepCalls[index]++;
              await sleep(item);
              if (index === 2) throw new RangeError("two");
              return String(index).repeat(150 * 1024);
            },
          }),
      });
      seen.push(brief(r));
      await ctx.wait({ seconds: 1 });
      return seen.at(-1).all.map((i) => i.status);
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["SUCCEEDED", "SUCCEEDED", "FAILED", "STARTED"]);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].completionReason, "MIN_SUCCESSFUL_REACHED");
  assert.deepEqual(seen[1], seen[0]);
  // Every step fn ran once, in the first invocation. Item 3's step was abandoned.
  assert.deepEqual(stepCalls, [1, 1, 1, 1]);
  const batch = byId(run, "1");
  assert.equal(batch.ContextDetails.ReplayChildren, true);
  assert.deepEqual(JSON.parse(batch.ContextDetails.Result), {
    completionReason: "MIN_SUCCESSFUL_REACHED",
    itemStatuses: "SSF-",
  });
  assert.equal(byId(run, "1-4-1").Status, "STARTED");
});

test("a ReplayChildren re-run follows the saved statuses, not the item records", async () => {
  // Item 0's SUCCEED was saved, but item 0 settled after the batch decided. So the live
  // result had item 0 as STARTED. Item 3 never started.
  const context = (rawId, SubType, Status, ContextDetails) => ({
    Id: hashId(rawId),
    ...(rawId !== "1" && { ParentId: hashId("1") }),
    Type: "CONTEXT",
    SubType,
    Status,
    StartTimestamp: 1,
    ContextDetails,
  });
  const summary = JSON.stringify({
    completionReason: "MIN_SUCCESSFUL_REACHED",
    itemStatuses: "-SS",
  });
  const { output, updates } = await invoke(
    async ({ ctx }) =>
      brief(
        await ctx.map({
          items: ["a", "b", "c", "d"],
          completionConfig: { minSuccessful: 2 },
          fn: () => assert.fail("an item must not run"),
        }),
      ),
    {
      operations: [
        context("1", "Map", "SUCCEEDED", {
          Result: summary,
          ReplayChildren: true,
        }),
        context("1-1", "MapIteration", "SUCCEEDED", { Result: '"a"' }),
        context("1-2", "MapIteration", "SUCCEEDED", { Result: '"b"' }),
        context("1-3", "MapIteration", "SUCCEEDED", { Result: '"c"' }),
      ],
    },
  );
  assert.deepEqual(JSON.parse(output.Result), {
    all: [
      { index: 0, status: "STARTED" },
      { index: 1, status: "SUCCEEDED", result: "b" },
      { index: 2, status: "SUCCEEDED", result: "c" },
    ],
    completionReason: "MIN_SUCCESSFUL_REACHED",
  });
  assert.deepEqual(updates, []);
});

test("an at-most-once step abandoned while it waits for START does not run fn", async () => {
  const client = createFakeClient({ operations: [executionOp()] });
  // The first request carries item 0's FAIL. It is held until item 1's step has queued
  // its START. So the batch decides while that START waits to be saved.
  const release = client.hold();
  let runs = 0;
  const { output, updates } = await invoke(
    async ({ ctx }) => {
      const r = await ctx.map({
        items: [0, 1],
        fn: async ({ ctx: c, index }) => {
          if (index === 0) throw new Error("no");
          await sleep(5);
          const p = c.step({
            semantics: "AT_MOST_ONCE_PER_RETRY",
            fn: () => ++runs,
          });
          release();
          return p;
        },
      });
      return r.all.map((i) => i.status);
    },
    { client },
  );
  assert.deepEqual(JSON.parse(output.Result), ["FAILED", "STARTED"]);
  assert.equal(runs, 0);
  const step = updates.filter((u) => u.Id === hashId("1-2-1"));
  assert.deepEqual(
    step.map((u) => u.Action),
    ["START"],
  );
});

test("an abandoned item blocked on a wait or a callback does not suspend the workflow", async () => {
  // The workflow awaits a plain timer between two steps. Nothing is running or saving
  // then. If the abandoned wait and callback still counted as blocked, the invocation
  // would suspend there. Nothing that the workflow awaits would wake it.
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: ["fail", "wait", "callback"],
        fn: async ({ ctx: c, item }) => {
          if (item === "wait") return c.wait({ seconds: 1000 });
          if (item === "callback") {
            return c.waitForCallback({ submitter: () => {} });
          }
          return c.step({
            retryStrategy: noRetry,
            fn: async () => {
              await sleep(5);
              throw new Error("no");
            },
          });
        },
      });
      const a = await ctx.step({ fn: () => 1 });
      await sleep(10);
      const b = await ctx.step({ fn: () => 2 });
      await ctx.wait({ seconds: 5 });
      return [a + b, r.all.map((i) => i.status)];
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [3, ["FAILED", "STARTED", "STARTED"]]);
  // One suspension, for the workflow's own wait.
  assert.equal(run.invocations, 2);
});
