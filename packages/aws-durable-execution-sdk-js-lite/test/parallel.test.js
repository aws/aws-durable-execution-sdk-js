import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableOperationError } from "../src/errors.js";
import { hashId } from "../src/ids.js";
import { runDurable } from "./helpers/run-durable.js";

const byId = (run, rawId) =>
  run.operations.find((op) => op.Id === hashId(rawId));

test("parallel runs named branches as ParallelBranch child contexts", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      await ctx.step({ fn: () => 0 });
      const r = await ctx.parallel({
        name: "p",
        branches: [
          {
            name: "slow",
            fn: async ({ ctx: c }) => {
              await c.wait({ seconds: 5 });
              return c.step({ fn: () => "s" });
            },
          },
          { fn: ({ ctx: c }) => c.step({ fn: () => "f" }) },
        ],
      });
      return r.getResults();
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["s", "f"]);
  const batch = byId(run, "2");
  assert.equal(batch.Name, "p");
  assert.equal(batch.SubType, "Parallel");
  assert.equal(byId(run, "2-1").Name, "slow");
  assert.equal(byId(run, "2-1").SubType, "ParallelBranch");
  assert.equal(byId(run, "2-1").ParentId, hashId("2"));
  assert.equal(byId(run, "2-2").Name, undefined);
  assert.equal(byId(run, "2-2").SubType, "ParallelBranch");
  assert.deepEqual(JSON.parse(batch.ContextDetails.Result), {
    all: [
      { index: 0, status: "SUCCEEDED", result: "s" },
      { index: 1, status: "SUCCEEDED", result: "f" },
    ],
    completionReason: "ALL_COMPLETED",
  });
});

test("a failed branch is recorded and throwIfError throws it on replay too", async () => {
  const errors = [];
  let calls = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const r = await ctx.parallel({
        branches: [
          {
            fn: () => {
              calls++;
              throw new RangeError("no");
            },
          },
          {
            fn: () => {
              calls++;
              return 2;
            },
          },
        ],
        maxConcurrency: 1,
        // The default stops at the first failure. Tolerate one so branch 2 runs.
        completionConfig: { toleratedFailureCount: 1 },
      });
      try {
        r.throwIfError();
      } catch (err) {
        errors.push(err);
      }
      await ctx.wait({ seconds: 1 });
      return r.getResults();
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [2]);
  assert.equal(calls, 2);
  assert.equal(errors.length, 2);
  for (const err of errors) {
    assert.ok(err instanceof DurableOperationError);
    assert.equal(err.errorType, "RangeError");
    assert.equal(err.message, "no");
  }
});

test("empty branches return an empty result", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      (await ctx.parallel({ branches: [] })).getResults(),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, []);
});
