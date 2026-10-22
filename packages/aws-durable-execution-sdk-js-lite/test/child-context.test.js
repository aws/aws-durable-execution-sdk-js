import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableOperationError } from "../src/errors.js";
import { hashId } from "../src/ids.js";
import { runDurable } from "../src/testing/index.js";
import { invoke } from "./helpers/invoke.js";
import { stepRecord } from "./helpers/fake-client.js";

const noRetry = () => ({ shouldRetry: false });
const byId = (run, rawId) =>
  run.operations.find((op) => op.Id === hashId(rawId));

test("fresh child context sends START, the children, then SUCCEED", async () => {
  const { output, updates } = await invoke(async ({ ctx }) =>
    ctx.runInChildContext({
      name: "c",
      fn: ({ ctx: child }) => child.step({ fn: () => ({ a: 1 }) }),
    }),
  );
  const context = {
    Id: hashId("1"),
    Name: "c",
    Type: "CONTEXT",
    SubType: "RunInChildContext",
  };
  const inner = {
    Id: hashId("1-1"),
    ParentId: hashId("1"),
    Type: "STEP",
    SubType: "Step",
  };
  assert.deepEqual(updates, [
    { ...context, Action: "START" },
    { ...inner, Action: "START" },
    { ...inner, Action: "SUCCEED", Payload: '{"a":1}' },
    { ...context, Action: "SUCCEED", Payload: '{"a":1}' },
  ]);
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '{"a":1}' });
});

test("child ids are prefixed, ParentId is the hashed context id, nesting works", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      ctx.runInChildContext({
        fn: async ({ ctx: c }) => {
          const inner = await c.runInChildContext({
            fn: ({ ctx: cc }) => cc.step({ fn: () => 1 }),
          });
          const next = await c.step({ fn: () => 2 });
          return inner + next;
        },
      }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 3);
  assert.equal(byId(run, "1").ParentId, undefined);
  assert.equal(byId(run, "1-1").ParentId, hashId("1"));
  assert.equal(byId(run, "1-1").Type, "CONTEXT");
  assert.equal(byId(run, "1-1-1").ParentId, hashId("1-1"));
  assert.equal(byId(run, "1-2").ParentId, hashId("1"));
  assert.equal(byId(run, "1-2").Type, "STEP");
});

test("a completed child context does not run again", async () => {
  let calls = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const value = await ctx.runInChildContext({
        fn: async ({ ctx: c }) => {
          calls++;
          return c.step({ fn: () => "v" });
        },
      });
      await ctx.wait({ seconds: 10 });
      return value;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "v");
  assert.equal(run.invocations, 2);
  assert.equal(calls, 1);
});

test("a failed child keeps the errorType and replays without running again", async () => {
  let calls = 0;
  const seen = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      try {
        await ctx.runInChildContext({
          fn: async ({ ctx: c }) => {
            calls++;
            await c.step({
              fn: () => {
                throw new TypeError("bad");
              },
              retryStrategy: noRetry,
            });
          },
        });
      } catch (err) {
        seen.push(err);
      }
      await ctx.wait({ seconds: 1 });
      return seen.at(-1).errorType;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "TypeError");
  assert.equal(calls, 1);
  assert.equal(seen.length, 2);
  for (const err of seen) {
    assert.ok(err instanceof DurableOperationError);
    assert.equal(err.errorType, "TypeError");
    assert.equal(err.message, "bad");
  }
  assert.equal(byId(run, "1").Status, "FAILED");
  assert.equal(byId(run, "1").ContextDetails.Error.ErrorType, "TypeError");
});

test("a large result sets ReplayChildren and is rebuilt without running steps", async () => {
  let fnCalls = 0;
  let stepCalls = 0;
  const results = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const value = await ctx.runInChildContext({
        fn: async ({ ctx: c }) => {
          fnCalls++;
          const a = await c.step({
            fn: () => {
              stepCalls++;
              return "a".repeat(200 * 1024);
            },
          });
          const b = await c.step({
            fn: () => {
              stepCalls++;
              return "b".repeat(100 * 1024);
            },
          });
          return { text: a + b };
        },
      });
      results.push(value);
      await ctx.wait({ seconds: 1 });
      return value.text.length;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 300 * 1024);
  assert.equal(fnCalls, 2);
  assert.equal(stepCalls, 2);
  assert.deepEqual(results[0], results[1]);
  const context = byId(run, "1");
  assert.equal(context.ContextDetails.Result, "");
  assert.equal(context.ContextDetails.ReplayChildren, true);
});

test("a ReplayChildren re-run does not run a race loser's later operations", async () => {
  // The winner's result is larger than 256 KiB, so a later invocation re-runs the race.
  // By then the loser's wait has ended. Its next step has no record and must not run.
  let loserRuns = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const value = await ctx.runInChildContext({
        name: "race",
        fn: ({ ctx: c }) =>
          Promise.race([
            Promise.all([
              c.step({ name: "w1", fn: () => "x".repeat(150_000) }),
              c.step({ name: "w2", fn: () => "x".repeat(150_000) }),
            ]),
            // The loser is nested, so replay-only must apply at every depth.
            c.runInChildContext({
              name: "loser",
              fn: async ({ ctx: l }) => {
                await l.wait({ name: "timeout", seconds: 60 });
                return l.step({
                  name: "loser-side-effect",
                  fn: () => {
                    loserRuns++;
                    return "late";
                  },
                });
              },
            }),
          ]),
      });
      await ctx.wait({ name: "after", seconds: 120 });
      return value.length;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 2);
  assert.equal(run.invocations, 3);
  assert.equal(loserRuns, 0);
  assert.equal(run.getOperation("loser-side-effect"), undefined);
});

test("a ReplayChildren re-run does not run a step that did not end", async () => {
  // The loser's step started, but its result was never saved. At-least-once would run
  // fn again. The context already succeeded, so the step must not run.
  let loserRuns = 0;
  const { output, updates } = await invoke(
    async ({ ctx }) =>
      ctx.runInChildContext({
        name: "race",
        fn: ({ ctx: c }) =>
          Promise.race([
            c.step({ name: "winner", fn: () => "w" }),
            c.step({
              name: "loser",
              fn: () => {
                loserRuns++;
                return "l";
              },
            }),
          ]),
      }),
    {
      operations: [
        {
          Id: hashId("1"),
          Name: "race",
          Type: "CONTEXT",
          SubType: "RunInChildContext",
          Status: "SUCCEEDED",
          ContextDetails: { Result: "", ReplayChildren: true },
        },
        stepRecord("1-1", "SUCCEEDED", { name: "winner", Result: '"w"' }),
        stepRecord("1-2", "STARTED", { name: "loser" }),
      ],
    },
  );
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '"w"' });
  assert.equal(loserRuns, 0);
  assert.deepEqual(updates, []);
});

test("a large result sends SUCCEED with an empty Payload and ReplayChildren", async () => {
  const { updates } = await invoke(async ({ ctx }) =>
    ctx.runInChildContext({ fn: () => "x".repeat(256 * 1024) }),
  );
  const succeed = updates.find((u) => u.Action === "SUCCEED");
  assert.equal(succeed.Payload, "");
  assert.deepEqual(succeed.ContextOptions, { ReplayChildren: true });
});

test("a result of exactly 256 KiB is stored as the Payload", async () => {
  // JSON adds two quotes around the string.
  const { updates } = await invoke(async ({ ctx }) =>
    ctx.runInChildContext({ fn: () => "x".repeat(256 * 1024 - 2) }),
  );
  const succeed = updates.find((u) => u.Action === "SUCCEED");
  assert.equal(Buffer.byteLength(succeed.Payload), 256 * 1024);
  assert.equal("ContextOptions" in succeed, false);
});

test("SUCCEEDED replay returns the stored result, FAILED replay throws", async () => {
  const record = (Status, ContextDetails) => ({
    Id: hashId("1"),
    Type: "CONTEXT",
    SubType: "RunInChildContext",
    Status,
    StartTimestamp: 1,
    ContextDetails,
  });
  const fn = () => assert.fail("must not run");
  const ok = await invoke(async ({ ctx }) => ctx.runInChildContext({ fn }), {
    operations: [record("SUCCEEDED", { Result: '{"x":2}' })],
  });
  assert.deepEqual(ok.output, { Status: "SUCCEEDED", Result: '{"x":2}' });
  assert.equal(ok.updates.length, 0);

  const failed = await invoke(
    async ({ ctx }) => ctx.runInChildContext({ fn }),
    { operations: [record("FAILED", { Error: { ErrorMessage: "m" } })] },
  );
  assert.equal(failed.output.Status, "FAILED");
  assert.equal(failed.output.Error.ErrorType, "ChildContextError");
  assert.equal(failed.output.Error.ErrorMessage, "m");
});

test("a replay mismatch fails with NonDeterministicExecutionError", async () => {
  const { output } = await invoke(
    async ({ ctx }) => ctx.runInChildContext({ name: "b", fn: () => 1 }),
    {
      operations: [
        {
          Id: hashId("1"),
          Name: "a",
          Type: "CONTEXT",
          SubType: "RunInChildContext",
          Status: "STARTED",
          StartTimestamp: 1,
        },
      ],
    },
  );
  assert.equal(output.Status, "FAILED");
  assert.equal(output.Error.ErrorType, "NonDeterministicExecutionError");
});

test("two child contexts in Promise.all complete with stable ids", async () => {
  let bSteps = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      Promise.all([
        ctx.runInChildContext({
          name: "A",
          fn: async ({ ctx: c }) => {
            await c.wait({ seconds: 5 });
            return c.step({ fn: () => "a" });
          },
        }),
        ctx.runInChildContext({
          name: "B",
          fn: async ({ ctx: c }) => {
            const x = await c.step({ fn: () => ++bSteps });
            const y = await c.step({ fn: () => ++bSteps });
            return x + y;
          },
        }),
      ]),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["a", 3]);
  assert.equal(run.invocations, 2);
  assert.equal(bSteps, 2);
  const expected = ["1", "1-1", "1-2", "2", "2-1", "2-2"].map(hashId);
  assert.deepEqual(
    run.operations
      .filter((op) => op.Type !== "EXECUTION")
      .map((op) => op.Id)
      .sort(),
    expected.sort(),
  );
  assert.equal(run.getOperation("A").Status, "SUCCEEDED");
  assert.equal(run.getOperation("B").Status, "SUCCEEDED");
});
