// nesting: "FLAT" on map and parallel. A FLAT item has no CONTEXT operation. Its
// operations have the batch as their ParentId (AGENTS.md 2.9).

import assert from "node:assert/strict";
import { test } from "node:test";
import { hashId } from "../src/ids.js";
import { runDurable } from "../src/testing/index.js";
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
const shape = ({ Id, ParentId, Type, SubType, Action }) => ({
  Id,
  ParentId,
  Type,
  SubType,
  Action,
});
const sortById = (list) => list.sort((a, b) => a.Id.localeCompare(b.Id));

test("FLAT map: no item CONTEXT updates; item operations have the batch as ParentId", async () => {
  const workflow =
    (nesting) =>
    async ({ ctx }) => {
      const r = await ctx.map({
        name: "m",
        items: ["a", "b"],
        itemName: ({ item }) => item,
        nesting,
        fn: async ({ ctx: c, item }) => {
          const up = await c.step({ fn: () => item.toUpperCase() });
          // A child context inside a FLAT item is a normal child context.
          return c.runInChildContext({
            fn: ({ ctx: cc }) => cc.step({ fn: () => `${up}!` }),
          });
        },
      });
      return r.getResults();
    };
  const flat = await invoke(workflow("FLAT"));
  assert.deepEqual(flat.output, {
    Status: "SUCCEEDED",
    Result: '["A!","B!"]',
  });
  // The ids match the full SDK: an item still takes the batch's next id, "1-1" and
  // "1-2". Its operations take that id as prefix, and the batch id as ParentId.
  const starts = sortById(
    flat.updates.filter((u) => u.Action === "START").map(shape),
  );
  const op = (rawId, parent, Type, SubType) => ({
    Id: hashId(rawId),
    ParentId: parent && hashId(parent),
    Type,
    SubType,
    Action: "START",
  });
  assert.deepEqual(
    starts,
    sortById([
      op("1", undefined, "CONTEXT", "Map"),
      op("1-1-1", "1", "STEP", "Step"),
      op("1-2-1", "1", "STEP", "Step"),
      op("1-1-2", "1", "CONTEXT", "RunInChildContext"),
      op("1-2-2", "1", "CONTEXT", "RunInChildContext"),
      op("1-1-2-1", "1-1-2", "STEP", "Step"),
      op("1-2-2-1", "1-2-2", "STEP", "Step"),
    ]),
  );
  // No update of any kind for the items' own ids, and no MapIteration at all.
  const items = [hashId("1-1"), hashId("1-2")];
  assert.equal(
    flat.updates.some((u) => items.includes(u.Id)),
    false,
  );
  assert.equal(
    flat.updates.some((u) => u.SubType === "MapIteration"),
    false,
  );
  // The batch stores the same JSON as a NESTED batch.
  const close = flat.updates.find(
    (u) => u.Id === hashId("1") && u.Action === "SUCCEED",
  );
  assert.deepEqual(JSON.parse(close.Payload), {
    all: [
      { index: 0, status: "SUCCEEDED", result: "A!" },
      { index: 1, status: "SUCCEEDED", result: "B!" },
    ],
    completionReason: "ALL_COMPLETED",
  });

  // NESTED, the default, still sends each item's context.
  for (const nesting of [undefined, "NESTED"]) {
    const nested = await invoke(workflow(nesting));
    assert.equal(nested.output.Result, flat.output.Result);
    for (const rawId of ["1-1", "1-2"]) {
      assert.deepEqual(
        nested.updates.filter((u) => u.Id === hashId(rawId)).map(shape),
        ["START", "SUCCEED"].map((Action) => ({
          ...op(rawId, "1", "CONTEXT", "MapIteration"),
          Action,
        })),
      );
    }
    assert.equal(
      nested.updates.find((u) => u.Id === hashId("1-1-1")).ParentId,
      hashId("1-1"),
    );
  }
});

test("FLAT map: an open batch re-runs item fns on replay; each step runs once", async () => {
  const stepCalls = [0, 0, 0];
  const fnCalls = [0, 0, 0];
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      (
        await ctx.map({
          items: [0, 1, 2],
          maxConcurrency: 2,
          nesting: "FLAT",
          fn: async ({ ctx: c, index }) => {
            fnCalls[index]++;
            const before = await c.step({ fn: () => ++stepCalls[index] });
            await c.wait({ seconds: 10 });
            return before + (await c.step({ fn: () => 10 }));
          },
        })
      ).getResults(),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [11, 11, 11]);
  // Each first step ran once. Its record replayed in the later invocations.
  assert.deepEqual(stepCalls, [1, 1, 1]);
  // Items 0 and 1 wait together. Item 2 starts in the second invocation.
  assert.equal(run.invocations, 3);
  // The item code outside steps ran once per invocation that reached the item.
  assert.deepEqual(fnCalls, [3, 3, 2]);
  for (const rawId of ["1-1", "1-2", "1-3"]) {
    assert.equal(byId(run, rawId), undefined);
    assert.equal(byId(run, `${rawId}-2`).Type, "WAIT");
    assert.equal(byId(run, `${rawId}-2`).ParentId, hashId("1"));
  }
});

test("FLAT map: a failed item throws the same error on every replay", async () => {
  const seen = [];
  let stepCalls = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: ["wait", "fail"],
        nesting: "FLAT",
        completionConfig: { toleratedFailurePercentage: 100 },
        fn: async ({ ctx: c, item }) => {
          // The waiting item keeps the batch open into the second invocation.
          if (item === "wait") return c.wait({ seconds: 5 });
          return c.step({
            retryStrategy: noRetry,
            fn: () => {
              stepCalls++;
              throw new TypeError("bad");
            },
          });
        },
      });
      seen.push(brief(r));
      await ctx.wait({ seconds: 1 });
      return seen.at(-1);
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  // The first: both items start. The second: the batch completes. The third: the
  // workflow's wait ends and the batch replays from its stored JSON.
  assert.equal(run.invocations, 3);
  assert.equal(stepCalls, 1);
  const expected = {
    all: [
      { index: 0, status: "SUCCEEDED" },
      { index: 1, status: "FAILED", errorType: "TypeError", message: "bad" },
    ],
    completionReason: "ALL_COMPLETED",
  };
  assert.deepEqual(seen, [expected, expected]);
  assert.equal(byId(run, "1-2-1").Status, "FAILED");
});

test("FLAT map: abandoned items send nothing after the batch decides", async () => {
  const calls = { slow: 0, after: 0, others: 0 };
  const { output, updates } = await invoke(async ({ ctx }) => {
    const r = await ctx.map({
      name: "m",
      items: ["fail", "slow", "x"],
      maxConcurrency: 2,
      nesting: "FLAT",
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
          await c.step({
            fn: async () => {
              calls.slow++;
              await sleep(30);
            },
          });
          return c.step({ fn: () => calls.after++ });
        }
        calls.others++;
      },
    });
    // The workflow keeps running until the abandoned step's fn has finished.
    await ctx.step({ fn: () => sleep(60) });
    return brief(r);
  });
  assert.deepEqual(JSON.parse(output.Result), {
    all: [
      { index: 0, status: "FAILED", errorType: "TypeError", message: "bad" },
      { index: 1, status: "STARTED" },
    ],
    completionReason: "FAILURE_TOLERANCE_EXCEEDED",
  });
  // The abandoned step's fn finished. Its outcome and the next step were not sent.
  assert.deepEqual(calls, { slow: 1, after: 0, others: 0 });
  assert.deepEqual(
    updates
      .filter((u) => u.ParentId === hashId("1"))
      .map((u) => [u.Id, u.Action])
      .sort(),
    [
      [hashId("1-1-1"), "START"],
      [hashId("1-1-1"), "FAIL"],
      [hashId("1-2-1"), "START"],
    ].sort(),
  );
  // After the batch's SUCCEED, only the workflow's own step (raw id "2") sends updates.
  const close = updates.findIndex(
    (u) => u.Id === hashId("1") && u.Action === "SUCCEED",
  );
  assert.deepEqual(
    [...new Set(updates.slice(close + 1).map((u) => u.Id))],
    [hashId("2")],
  );
});

test("FLAT map: a large early-completed batch replays the live result; no step runs again", async () => {
  // Items settle in the order 1, 2, 0. Item 3 is abandoned. Each result is 150 KiB, so
  // the batch saves only the statuses, with ReplayChildren.
  const delays = [40, 5, 20, 150];
  const stepCalls = [0, 0, 0, 0];
  const fnCalls = [0, 0, 0, 0];
  const seen = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: delays,
        nesting: "FLAT",
        completionConfig: { minSuccessful: 2, toleratedFailureCount: 1 },
        fn: async ({ ctx: c, item, index }) => {
          fnCalls[index]++;
          return c.step({
            retryStrategy: noRetry,
            fn: async () => {
              stepCalls[index]++;
              await sleep(item);
              if (index === 2) throw new RangeError("two");
              return String(index).repeat(150 * 1024);
            },
          });
        },
      });
      // Compare the results by their first character and length.
      const b = brief(r);
      for (const i of b.all) {
        if (i.result) i.result = `${i.result[0]}:${i.result.length}`;
      }
      seen.push(b);
      await ctx.wait({ seconds: 1 });
      return seen.length;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  const live = {
    all: [
      { index: 0, status: "SUCCEEDED", result: `0:${150 * 1024}` },
      { index: 1, status: "SUCCEEDED", result: `1:${150 * 1024}` },
      { index: 2, status: "FAILED", errorType: "RangeError", message: "two" },
      { index: 3, status: "STARTED" },
    ],
    completionReason: "MIN_SUCCESSFUL_REACHED",
  };
  assert.deepEqual(seen, [live, live]);
  // No step fn ran again. The items marked S or F ran their fn again; the item
  // marked "-" did not.
  assert.deepEqual(stepCalls, [1, 1, 1, 1]);
  assert.deepEqual(fnCalls, [2, 2, 2, 1]);
  const batch = byId(run, "1");
  assert.equal(batch.ContextDetails.ReplayChildren, true);
  assert.deepEqual(JSON.parse(batch.ContextDetails.Result), {
    completionReason: "MIN_SUCCESSFUL_REACHED",
    itemStatuses: "SSF-",
  });
  // The abandoned step sent only START. The steps are direct children of the batch.
  assert.equal(byId(run, "1-4-1").Status, "STARTED");
  assert.equal(byId(run, "1-1-1").ParentId, hashId("1"));
});

test("FLAT map: a ReplayChildren re-run does not run an item's unfinished operation", async () => {
  // Each item returns before its second step finishes. The batch completes and
  // abandons that step, so its record stays STARTED. The re-run runs each item's fn
  // again in a replay-only ctx. So the STARTED step must not run its fn again.
  const late = [0, 0];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [0, 1],
        nesting: "FLAT",
        fn: async ({ ctx: c, index }) => {
          void c.step({
            fn: async () => {
              late[index]++;
              await sleep(20);
            },
          });
          return c.step({ fn: () => String(index).repeat(150 * 1024) });
        },
      });
      await ctx.step({ fn: () => sleep(40) });
      await ctx.wait({ seconds: 1 });
      return r.getResults().map((s) => s.length);
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [150 * 1024, 150 * 1024]);
  assert.equal(byId(run, "1").ContextDetails.ReplayChildren, true);
  assert.equal(byId(run, "1-1-1").Status, "STARTED");
  assert.deepEqual(late, [1, 1]);
});

test("FLAT map: a small completed batch replays from its stored JSON without running items", async () => {
  let fnCalls = 0;
  const seen = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [1, 2],
        nesting: "FLAT",
        fn: ({ ctx: c, item }) => {
          fnCalls++;
          return c.step({ fn: () => item * 2 });
        },
      });
      seen.push(brief(r));
      await ctx.wait({ seconds: 1 });
      return r.getResults();
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [2, 4]);
  assert.equal(run.invocations, 2);
  assert.equal(fnCalls, 2);
  assert.deepEqual(seen[1], seen[0]);
  assert.equal(byId(run, "1").ContextDetails.ReplayChildren, false);
});

test("FLAT parallel: branches have no CONTEXT operation and replay across invocations", async () => {
  const stepCalls = { slow: 0, fast: 0 };
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      await ctx.step({ fn: () => 0 });
      const r = await ctx.parallel({
        name: "p",
        nesting: "FLAT",
        branches: [
          {
            name: "slow",
            fn: async ({ ctx: c }) => {
              await c.wait({ seconds: 5 });
              return c.step({ fn: () => ++stepCalls.slow });
            },
          },
          { fn: ({ ctx: c }) => c.step({ fn: () => ++stepCalls.fast }) },
        ],
      });
      await ctx.wait({ seconds: 1 });
      return r.getResults();
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [1, 1]);
  assert.deepEqual(stepCalls, { slow: 1, fast: 1 });
  assert.equal(run.invocations, 3);
  assert.equal(byId(run, "2").SubType, "Parallel");
  assert.equal(
    run.operations.some((op) => op.SubType === "ParallelBranch"),
    false,
  );
  assert.equal(byId(run, "2-1-2").ParentId, hashId("2"));
  assert.deepEqual(JSON.parse(byId(run, "2").ContextDetails.Result), {
    all: [
      { index: 0, status: "SUCCEEDED", result: 1 },
      { index: 1, status: "SUCCEEDED", result: 1 },
    ],
    completionReason: "ALL_COMPLETED",
  });
});

test("FLAT with itemSerdes: no serdes call; the batch keeps its children and a replay returns fn's values", async () => {
  const calls = [];
  const itemSerdes = {
    serialize: ({ entityId }) => {
      calls.push(`serialize:${entityId}`);
      return "x";
    },
    deserialize: ({ entityId }) => {
      calls.push(`deserialize:${entityId}`);
      return undefined;
    },
  };
  const seen = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.map({
        items: [0, 1],
        nesting: "FLAT",
        itemSerdes,
        fn: async ({ ctx: c, index }) => {
          const ms = await c.step({ fn: () => index * 1000 });
          return new Date(ms);
        },
      });
      seen.push(r.getResults().map((d) => d instanceof Date && d.getTime()));
      await ctx.wait({ seconds: 1 });
      return seen;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  // A JSON round trip would turn the Dates into strings. The re-run returns fn's Dates.
  assert.deepEqual(run.result, [
    [0, 1000],
    [0, 1000],
  ]);
  assert.deepEqual(calls, []);
  const batch = byId(run, "1").ContextDetails;
  assert.equal(batch.ReplayChildren, true);
  assert.deepEqual(JSON.parse(batch.Result), {
    completionReason: "ALL_COMPLETED",
    itemStatuses: "SS",
  });
});

test("a 100-item map of one step each: FLAT creates 101 operations, NESTED 201", async () => {
  const count = async (nesting) => {
    const run = await runDurable({
      workflow: async ({ ctx }) =>
        (
          await ctx.map({
            items: Array.from({ length: 100 }, (_, i) => i),
            nesting,
            fn: ({ ctx: c, item }) => c.step({ fn: () => item }),
          })
        ).getResults().length,
    });
    assert.equal(run.result, 100);
    // run.operations lists every operation that the in-memory service created.
    return run.operations.filter((op) => op.Type !== "EXECUTION").length;
  };
  assert.equal(await count("FLAT"), 101);
  assert.equal(await count("NESTED"), 201);
});
