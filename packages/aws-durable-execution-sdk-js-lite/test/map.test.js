import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableOperationError } from "../src/errors.js";
import { hashId } from "../src/ids.js";
import { runDurable } from "../src/testing/index.js";
import { invoke } from "./helpers/invoke.js";

const noRetry = () => ({ shouldRetry: false });
const byId = (run, rawId) =>
  run.operations.find((op) => op.Id === hashId(rawId));

test("map sends the batch and item contexts with ids, SubTypes and Names", async () => {
  const { output, updates } = await invoke(async ({ ctx }) => {
    const r = await ctx.map({
      name: "m",
      items: ["a", "b"],
      itemName: ({ item, index }) => `${item}${index}`,
      fn: ({ ctx: c, item }) => c.step({ fn: () => item.toUpperCase() }),
    });
    return r.getResults();
  });
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '["A","B"]' });
  const starts = updates
    .filter((u) => u.Action === "START")
    .map(({ Id, ParentId, Name, Type, SubType }) => ({
      Id,
      ParentId,
      Name,
      Type,
      SubType,
    }))
    .sort((a, b) => a.Id.localeCompare(b.Id));
  // Item 0 starts its step before item 1 starts, so compare without order.
  const expected = [
    {
      Id: hashId("1"),
      ParentId: undefined,
      Name: "m",
      Type: "CONTEXT",
      SubType: "Map",
    },
    {
      Id: hashId("1-1"),
      ParentId: hashId("1"),
      Name: "a0",
      Type: "CONTEXT",
      SubType: "MapIteration",
    },
    {
      Id: hashId("1-2"),
      ParentId: hashId("1"),
      Name: "b1",
      Type: "CONTEXT",
      SubType: "MapIteration",
    },
    {
      Id: hashId("1-1-1"),
      ParentId: hashId("1-1"),
      Name: undefined,
      Type: "STEP",
      SubType: "Step",
    },
    {
      Id: hashId("1-2-1"),
      ParentId: hashId("1-2"),
      Name: undefined,
      Type: "STEP",
      SubType: "Step",
    },
  ];
  assert.deepEqual(
    starts,
    expected.sort((a, b) => a.Id.localeCompare(b.Id)),
  );
  const batch = updates.find(
    (u) => u.Id === hashId("1") && u.Action === "SUCCEED",
  );
  assert.deepEqual(JSON.parse(batch.Payload), {
    all: [
      { index: 0, status: "SUCCEEDED", result: "A" },
      { index: 1, status: "SUCCEEDED", result: "B" },
    ],
    completionReason: "ALL_COMPLETED",
  });
});

test("results are in index order when items finish out of order", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [3, 1, 2],
        fn: async ({ ctx: c, item }) => {
          await c.wait({ seconds: item });
          return item * 10;
        },
      });
      return { all: r.all, results: r.getResults() };
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result.results, [30, 10, 20]);
  assert.deepEqual(
    run.result.all.map((i) => i.index),
    [0, 1, 2],
  );
});

test("maxConcurrency limits running items and starts them in index order", async () => {
  let running = 0;
  let peak = 0;
  const starts = [];
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      (
        await ctx.map({
          items: [5, 1, 4, 2, 3],
          maxConcurrency: 2,
          fn: ({ ctx: c, item, index }) =>
            c.step({
              fn: async () => {
                starts.push(index);
                peak = Math.max(peak, ++running);
                // Different delays make items finish out of order.
                await new Promise((r) => setTimeout(r, item * 3));
                running--;
                return index;
              },
            }),
        })
      ).getResults(),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.deepEqual(starts, [0, 1, 2, 3, 4]);
  for (let i = 1; i <= 5; i++) {
    assert.equal(byId(run, `1-${i}`).SubType, "MapIteration");
  }
});

test("a failing item does not stop the others and keeps its errorType", async () => {
  const seen = [];
  let calls = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [1, 2, 3],
        fn: ({ ctx: c, item }) =>
          c.step({
            retryStrategy: noRetry,
            fn: () => {
              calls++;
              if (item === 2) throw new TypeError("bad");
              return item;
            },
          }),
      });
      seen.push(r);
      await ctx.wait({ seconds: 1 });
      return r.all.map((i) => i.status);
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["SUCCEEDED", "FAILED", "SUCCEEDED"]);
  assert.equal(calls, 3);
  // seen[0] is the first run, seen[1] is the replay of the stored result.
  assert.equal(seen.length, 2);
  for (const r of seen) {
    assert.equal(r.completionReason, "ALL_COMPLETED");
    assert.deepEqual(r.getResults(), [1, 3]);
    const [err] = r.getErrors();
    assert.ok(err instanceof DurableOperationError);
    assert.equal(err.errorType, "TypeError");
    assert.equal(err.message, "bad");
    assert.equal(r.all[1].error, err);
    assert.throws(
      () => r.throwIfError(),
      (e) => e === err,
    );
  }
  const stored = JSON.parse(byId(run, "1").ContextDetails.Result);
  assert.deepEqual(stored.all[1], {
    index: 1,
    status: "FAILED",
    error: { ErrorType: "TypeError", ErrorMessage: "bad" },
  });
  assert.equal(byId(run, "1-2").Status, "FAILED");
});

test("throwIfError does nothing when every item succeeded", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({ items: [1], fn: ({ item }) => item });
      r.throwIfError();
      return r.getErrors();
    },
  });
  assert.deepEqual(run.result, []);
});

test("items with waits resume across invocations, each step runs once", async () => {
  const calls = [0, 0, 0];
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      (
        await ctx.map({
          items: [0, 1, 2],
          maxConcurrency: 2,
          fn: async ({ ctx: c, index }) => {
            await c.wait({ seconds: 10 });
            return c.step({ fn: () => ++calls[index] });
          },
        })
      ).getResults(),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [1, 1, 1]);
  assert.deepEqual(calls, [1, 1, 1]);
  // Items 0 and 1 wait together. Item 2 starts only after one of them finished.
  assert.equal(run.invocations, 3);
  assert.equal(byId(run, "1-3").Type, "CONTEXT");
  assert.equal(byId(run, "1-3-1").Type, "WAIT");
});

test("a completed map does not run again on later invocations", async () => {
  let fnCalls = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [1, 2],
        fn: () => {
          fnCalls++;
          return "x";
        },
      });
      await ctx.wait({ seconds: 1 });
      await ctx.wait({ seconds: 1 });
      return r.getResults();
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["x", "x"]);
  assert.equal(run.invocations, 3);
  assert.equal(fnCalls, 2);
});

test("a large map result uses ReplayChildren and steps do not run again", async () => {
  let stepCalls = 0;
  const lengths = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [1, 2, 3],
        fn: ({ ctx: c }) =>
          c.step({
            fn: () => {
              stepCalls++;
              return "z".repeat(100 * 1024);
            },
          }),
      });
      lengths.push(r.getResults().join("").length);
      await ctx.wait({ seconds: 1 });
      return r.getResults().length;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 3);
  assert.equal(stepCalls, 3);
  assert.deepEqual(lengths, [300 * 1024, 300 * 1024]);
  const batch = byId(run, "1");
  assert.equal(batch.ContextDetails.Result, "");
  assert.equal(batch.ContextDetails.ReplayChildren, true);
});

test("an empty map returns an empty result", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({ name: "e", items: [], fn: () => 1 });
      r.throwIfError();
      return { all: r.all, results: r.getResults() };
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, { all: [], results: [] });
  assert.deepEqual(JSON.parse(run.getOperation("e").ContextDetails.Result), {
    all: [],
    completionReason: "ALL_COMPLETED",
  });
});
