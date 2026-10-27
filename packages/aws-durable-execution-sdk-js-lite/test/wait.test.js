import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { hashId } from "../src/ids.js";
import { runDurable } from "./helpers/run-durable.js";
import { stepRecord } from "./helpers/fake-client.js";
import { invoke } from "./helpers/invoke.js";

const waitRecord = (rawId, Status, Name) => ({
  Id: hashId(rawId),
  Type: "WAIT",
  SubType: "Wait",
  ...(Name !== undefined && { Name }),
  Status,
  StartTimestamp: 1,
  // Epoch milliseconds, as in the invocation event. In the future. A wait whose end has passed makes the SDK refresh the state once
  // before it suspends (README 2.5).
  WaitDetails: { ScheduledEndTimestamp: Date.now() + 3_600_000 },
});

test("fresh wait sends START with WaitSeconds and suspends", async () => {
  const { output, updates } = await invoke(async ({ ctx }) => {
    await ctx.wait({ name: "w", seconds: 30 });
    assert.fail("must not continue");
  });
  assert.deepEqual(updates, [
    {
      Id: hashId("1"),
      Name: "w",
      Type: "WAIT",
      SubType: "Wait",
      Action: "START",
      WaitOptions: { WaitSeconds: 30 },
    },
  ]);
  assert.deepEqual(output, { Status: "PENDING" });
});

test("SUCCEEDED wait resolves without a checkpoint", async () => {
  const { output, client } = await invoke(
    async ({ ctx }) => {
      assert.equal(await ctx.wait({ seconds: 5 }), undefined);
      return "after";
    },
    { operations: [waitRecord("1", "SUCCEEDED")] },
  );
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '"after"' });
  assert.equal(client.checkpoints.length, 0);
});

for (const status of ["FAILED", "CANCELLED", "STOPPED", "TIMED_OUT"]) {
  test(`${status} wait resolves too`, async () => {
    const { output } = await invoke(
      async ({ ctx }) => {
        await ctx.wait({ seconds: 5 });
        return "after";
      },
      { operations: [waitRecord("1", status)] },
    );
    assert.deepEqual(output, { Status: "SUCCEEDED", Result: '"after"' });
  });
}

test("STARTED wait blocks without a new START", async () => {
  const { output, client } = await invoke(
    async ({ ctx }) => {
      await ctx.wait({ seconds: 5 });
      assert.fail("must not continue");
    },
    { operations: [waitRecord("1", "STARTED")] },
  );
  assert.deepEqual(output, { Status: "PENDING" });
  assert.equal(client.checkpoints.length, 0);
});

test("a wait that replays a different operation fails the execution", async () => {
  const { output } = await invoke(({ ctx }) => ctx.wait({ seconds: 5 }), {
    operations: [stepRecord("1", "SUCCEEDED", { Result: "1" })],
  });
  assert.equal(output.Status, "FAILED");
  assert.equal(output.Error.ErrorType, "NonDeterministicExecutionError");

  const named = await invoke(({ ctx }) => ctx.wait({ name: "b", seconds: 5 }), {
    operations: [waitRecord("1", "SUCCEEDED", "a")],
  });
  assert.equal(named.output.Error.ErrorType, "NonDeterministicExecutionError");
});

test("wait between steps takes 2 invocations and advances the clock", async () => {
  const runs = [];
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "a", fn: () => runs.push("a") });
      await ctx.wait({ name: "w", seconds: 90 });
      await ctx.step({ name: "b", fn: () => runs.push("b") });
      return "done";
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "done");
  assert.equal(run.invocations, 2);
  assert.deepEqual(runs, ["a", "b"]);
  const w = run.getOperation("w");
  assert.equal(w.Status, "SUCCEEDED");
  assert.equal(w.EndTimestamp - w.StartTimestamp, 90);
  assert.equal(run.getOperation("b").StartTimestamp, w.EndTimestamp);
});

test("a branch waits while the other runs a step; suspends after the step", async () => {
  let calls = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const [, value] = await Promise.all([
        ctx.wait({ name: "w", seconds: 10 }),
        ctx.step({
          name: "s",
          fn: async () => {
            calls++;
            await sleep(20);
            return "slow";
          },
        }),
      ]);
      return value;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "slow");
  assert.equal(run.invocations, 2);
  assert.equal(calls, 1);
  // The step finished in the first invocation, before the wait ended.
  const s = run.getOperation("s");
  assert.equal(s.Status, "SUCCEEDED");
  assert.ok(s.EndTimestamp < run.getOperation("w").EndTimestamp);
});
