// A blocked operation wakes when a checkpoint response changes its record (README
// 2.5). These tests let the in-memory service change a record while another branch's
// step runs. That branch's SUCCEED response then reports the change, like the service.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashId } from "../src/ids.js";
import { createInMemoryService, runDurable } from "../src/testing/index.js";
import { createFakeClient, executionOp } from "./helpers/fake-client.js";
import { invoke } from "./helpers/invoke.js";

// Resolves once the service holds a record of this type and status. The record exists
// only after the first checkpoint request, which the SDK sends after setImmediate.
async function until(service, type, status) {
  for (let i = 0; i < 1000; i++) {
    const op = [...service.ops.values()].find((o) => o.Type === type);
    if (op && op.Status === status) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`no ${type} record reached ${status}`);
}

const noErrors = (run) =>
  assert.deepEqual(
    run.invocationErrors.map((e) => e.message),
    [],
  );

// The live scenario: branch A waits 2 seconds, branch B runs a step for 10 seconds.
test("a wait that ends during another branch's step continues in the same invocation", async () => {
  const service = createInMemoryService();
  const run = await runDurable({
    service,
    workflow: async ({ ctx }) =>
      Promise.all([
        ctx.runInChildContext({
          name: "A",
          fn: async ({ ctx: c }) => {
            await c.wait({ name: "w", seconds: 2 });
            return c.step({ name: "after-wait", fn: () => "a" });
          },
        }),
        ctx.runInChildContext({
          name: "B",
          fn: ({ ctx: c }) =>
            c.step({
              name: "long",
              fn: async () => {
                await until(service, "WAIT", "STARTED");
                service.advanceBy(10);
                return "b";
              },
            }),
        }),
      ]),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["a", "b"]);
  assert.equal(run.invocations, 1);
  noErrors(run);
  assert.equal(run.getOperation("after-wait").Status, "SUCCEEDED");
});

test("a step retry that becomes READY during another branch's step runs in the same invocation", async () => {
  const service = createInMemoryService();
  const attempts = [];
  const run = await runDurable({
    service,
    workflow: async ({ ctx }) =>
      Promise.all([
        ctx.runInChildContext({
          fn: ({ ctx: c }) =>
            c.step({
              name: "flaky",
              retryStrategy: () => ({ shouldRetry: true, delaySeconds: 2 }),
              fn: ({ attempt }) => {
                attempts.push(attempt);
                if (attempt === 1) throw new Error("first attempt");
                return "ok";
              },
            }),
        }),
        ctx.runInChildContext({
          fn: ({ ctx: c }) =>
            c.step({
              fn: async () => {
                await until(service, "STEP", "PENDING");
                service.advanceBy(10);
                return "b";
              },
            }),
        }),
      ]),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["ok", "b"]);
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(run.invocations, 1);
  noErrors(run);
});

test("a callback completed during another branch's step resolves in the same invocation", async () => {
  const service = createInMemoryService({
    onCallback: () => ({ result: "answer" }),
  });
  const run = await runDurable({
    service,
    workflow: async ({ ctx }) =>
      Promise.all([
        ctx.runInChildContext({
          fn: async ({ ctx: c }) => {
            const { result } = await c.createCallback();
            return result;
          },
        }),
        ctx.runInChildContext({
          fn: ({ ctx: c }) =>
            c.step({
              fn: async () => {
                await until(service, "CALLBACK", "STARTED");
                assert.equal(await service.boundary(), 1);
                return "b";
              },
            }),
        }),
      ]),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, ["answer", "b"]);
  assert.equal(run.invocations, 1);
  noErrors(run);
});

test("an invoke finished during another branch's step returns in the same invocation", async () => {
  const service = createInMemoryService({
    functions: { double: ({ input }) => input * 2 },
  });
  const run = await runDurable({
    service,
    workflow: async ({ ctx }) =>
      Promise.all([
        ctx.runInChildContext({
          fn: ({ ctx: c }) => c.invoke({ functionName: "double", input: 21 }),
        }),
        ctx.runInChildContext({
          fn: ({ ctx: c }) =>
            c.step({
              fn: async () => {
                await until(service, "CHAINED_INVOKE", "STARTED");
                assert.equal(await service.boundary(), 1);
                return "b";
              },
            }),
        }),
      ]),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [42, "b"]);
  assert.equal(run.invocations, 1);
  noErrors(run);
});

test("an abandoned branch does not run again when its wait ends", async () => {
  const service = createInMemoryService();
  const run = await runDurable({
    service,
    workflow: async ({ ctx }) => {
      await ctx.parallel({
        completionConfig: { minSuccessful: 1 },
        branches: [
          ({ ctx: c }) => c.step({ fn: () => "fast" }),
          async ({ ctx: c }) => {
            await c.wait({ seconds: 2 });
            return c.step({ name: "must-not-run", fn: () => "late" });
          },
        ],
      });
      // This step's SUCCEED response reports the ended wait of the abandoned branch.
      return ctx.step({
        fn: async () => {
          service.advanceBy(10);
          return "done";
        },
      });
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "done");
  assert.equal(run.getOperation("must-not-run"), undefined);
  noErrors(run);
});

const waitRecord = (Status, ScheduledEndTimestamp) => ({
  Id: hashId("1"),
  Type: "WAIT",
  SubType: "Wait",
  Status,
  StartTimestamp: 1,
  WaitDetails: { ScheduledEndTimestamp },
});

// The API sends epoch seconds as a number. The invocation event sends an ISO string.
for (const [form, past] of [
  ["epoch seconds", Date.now() / 1000 - 1],
  ["an ISO string", new Date(Date.now() - 1000).toISOString()],
]) {
  test(`a blocked wait past its end (${form}) refreshes the state once before suspending`, async () => {
    const started = waitRecord("STARTED", past);
    const client = createFakeClient({ operations: [executionOp(), started] });
    client.script(() => ({
      CheckpointToken: "token-1",
      NewExecutionState: { Operations: [{ ...started, Status: "SUCCEEDED" }] },
    }));
    const { output } = await invoke(
      async ({ ctx }) => {
        await ctx.wait({ seconds: 5 });
        return "after";
      },
      { operations: [started], client },
    );
    assert.deepEqual(output, { Status: "SUCCEEDED", Result: '"after"' });
    assert.deepEqual(
      client.checkpoints.map((r) => r.Updates),
      [[]],
    );
  });
}

test("a refresh that changes nothing suspends after one empty checkpoint", async () => {
  const { output, client } = await invoke(
    async ({ ctx }) => {
      await ctx.wait({ seconds: 5 });
      assert.fail("must not continue");
    },
    { operations: [waitRecord("STARTED", Date.now() / 1000 - 1)] },
  );
  assert.deepEqual(output, { Status: "PENDING" });
  assert.deepEqual(
    client.checkpoints.map((r) => r.Updates),
    [[]],
  );
});

test("a blocked callback suspends without a refresh", async () => {
  const record = {
    Id: hashId("1"),
    Type: "CALLBACK",
    SubType: "Callback",
    Status: "STARTED",
    StartTimestamp: 1,
    CallbackDetails: { CallbackId: "cb" },
  };
  const { output, client } = await invoke(
    async ({ ctx }) => {
      const { result } = await ctx.createCallback();
      await result;
    },
    { operations: [record] },
  );
  assert.deepEqual(output, { Status: "PENDING" });
  assert.equal(client.checkpoints.length, 0);
});

test("runDurable records PENDING with nothing pending as an invocation error and invokes again", async () => {
  const service = createInMemoryService();
  // The first check reports nothing pending, as if the service had ended the wait before
  // the invocation returned PENDING.
  const hasPending = service.hasPending;
  let checks = 0;
  service.hasPending = () => ++checks > 1 && hasPending();
  const run = await runDurable({
    service,
    workflow: async ({ ctx }) => {
      await ctx.wait({ seconds: 5 });
      return "done";
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(
    run.invocationErrors.map((e) => e.message),
    ["Invocation 1 returned PENDING while no operation is pending"],
  );
  // Invocation 2 finds the wait still running and suspends. Then the clock advances.
  assert.equal(run.invocations, 3);
});

test("runDurable records a throw from the handler as an invocation error", async () => {
  const service = createInMemoryService();
  const checkpoint = service.client.checkpoint;
  let calls = 0;
  service.client.checkpoint = (request) => {
    if (++calls === 1) {
      throw Object.assign(new Error("unavailable"), { status: 503 });
    }
    return checkpoint(request);
  };
  const run = await runDurable({
    service,
    workflow: ({ ctx }) => ctx.step({ fn: () => "ok" }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(
    run.invocationErrors.map((e) => e.message),
    ["unavailable"],
  );
  assert.equal(run.invocations, 2);
});

test("a waitForCondition poll that becomes READY during another branch's step runs in the same invocation", async () => {
  const service = createInMemoryService();
  const checks = [];
  const run = await runDurable({
    service,
    workflow: async ({ ctx }) =>
      Promise.all([
        ctx.runInChildContext({
          fn: ({ ctx: c }) =>
            c.waitForCondition({
              name: "poll",
              initialState: 0,
              fn: ({ state, attempt }) => {
                checks.push({ state, attempt });
                return state + 1;
              },
              waitStrategy: ({ state }) => ({
                shouldContinue: state < 2,
                delaySeconds: 2,
              }),
            }),
        }),
        ctx.runInChildContext({
          fn: ({ ctx: c }) =>
            c.step({
              fn: async () => {
                // The first check saved its RETRY. The service makes it READY after 2
                // seconds, and this step's SUCCEED response reports that.
                await until(service, "STEP", "PENDING");
                service.advanceBy(10);
                return "b";
              },
            }),
        }),
      ]),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [2, "b"]);
  // The second check read the state that the first check saved.
  assert.deepEqual(checks, [
    { state: 0, attempt: 1 },
    { state: 1, attempt: 2 },
  ]);
  assert.equal(run.invocations, 1);
  noErrors(run);
});
