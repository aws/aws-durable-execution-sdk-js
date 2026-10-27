import assert from "node:assert/strict";
import { test } from "node:test";
import { hashId } from "../src/ids.js";
import { createInMemoryService, runDurable } from "./helpers/run-durable.js";
import { withDurableExecution } from "../src/with-durable-execution.js";
import { invoke } from "./helpers/invoke.js";

const record = (Status, StepDetails = {}, extra = {}) => ({
  Id: hashId("1"),
  Type: "STEP",
  SubType: "WaitForCondition",
  Status,
  StartTimestamp: 1,
  StepDetails,
  ...extra,
});

test("waitForCondition polls with the strategy's delays and carries the state", async () => {
  const seen = [];
  const workflow = async ({ ctx }) =>
    ctx.waitForCondition({
      name: "poll",
      initialState: { n: 0 },
      fn: ({ state, attempt }) => {
        seen.push({ state, attempt });
        return { n: state.n + 1 };
      },
      waitStrategy: ({ state, attempt }) =>
        state.n < 3
          ? { shouldContinue: true, delaySeconds: 5 * attempt }
          : { shouldContinue: false },
    });
  const service = createInMemoryService();
  const handler = withDurableExecution(workflow, { client: service.client });
  const deltas = [];
  let output;
  for (let i = 0; i < 10; i++) {
    output = await handler(service.event(), {});
    service.complete(output);
    if (output.Status !== "PENDING") break;
    const op = service.ops.get(hashId("1"));
    deltas.push(op.StepDetails.NextAttemptTimestamp - service.now);
    assert.equal(service.advance(), true);
  }
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '{"n":3}' });
  assert.deepEqual(deltas, [5, 10]);
  assert.deepEqual(seen, [
    { state: { n: 0 }, attempt: 1 },
    { state: { n: 1 }, attempt: 2 },
    { state: { n: 2 }, attempt: 3 },
  ]);
  const op = service.ops.get(hashId("1"));
  assert.equal(op.Name, "poll");
  assert.equal(op.Status, "SUCCEEDED");
});

test("runDurable runs one check per invocation", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      ctx.waitForCondition({
        initialState: 0,
        fn: ({ state }) => state + 1,
        waitStrategy: ({ state }) => ({ shouldContinue: state < 4 }),
      }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 4);
  assert.equal(run.invocations, 4);
});

test("fresh check sends START then RETRY with the state as Payload", async () => {
  const { output, updates } = await invoke(async ({ ctx }) =>
    ctx.waitForCondition({
      name: "w",
      initialState: { n: 0 },
      fn: ({ state }) => ({ n: state.n + 1 }),
      waitStrategy: () => ({ shouldContinue: true }),
    }),
  );
  const base = {
    Id: hashId("1"),
    Name: "w",
    Type: "STEP",
    SubType: "WaitForCondition",
  };
  assert.deepEqual(updates, [
    { ...base, Action: "START" },
    {
      ...base,
      Action: "RETRY",
      Payload: '{"n":1}',
      StepOptions: { NextAttemptDelaySeconds: 1 },
    },
  ]);
  assert.deepEqual(output, { Status: "PENDING" });
});

test("READY resumes from the saved state, STARTED sends no START", async () => {
  const check = {
    initialState: { n: 0 },
    fn: ({ state, attempt }) => ({ n: state.n + 1, attempt }),
    waitStrategy: () => ({ shouldContinue: false }),
  };
  const ready = await invoke(async ({ ctx }) => ctx.waitForCondition(check), {
    operations: [record("READY", { Attempt: 1, Result: '{"n":5}' })],
  });
  assert.deepEqual(
    ready.updates.map((u) => u.Action),
    ["START", "SUCCEED"],
  );
  assert.deepEqual(ready.output, {
    Status: "SUCCEEDED",
    Result: '{"n":6,"attempt":2}',
  });
  const started = await invoke(async ({ ctx }) => ctx.waitForCondition(check), {
    operations: [record("STARTED", { Attempt: 2, Result: '{"n":5}' })],
  });
  assert.deepEqual(
    started.updates.map((u) => u.Action),
    ["SUCCEED"],
  );
  assert.equal(started.output.Result, '{"n":6,"attempt":3}');
});

test("a check error fails the execution without retry", async () => {
  let calls = 0;
  const run = await runDurable({
    workflow: async ({ ctx }) =>
      ctx.waitForCondition({
        initialState: 0,
        fn: ({ state }) => {
          calls++;
          if (state === 1) throw new TypeError("broken");
          return state + 1;
        },
        waitStrategy: () => ({ shouldContinue: true }),
      }),
  });
  assert.equal(run.status, "FAILED");
  assert.equal(run.error.ErrorType, "TypeError");
  assert.equal(calls, 2);
  assert.equal(run.invocations, 2);
  assert.equal(run.operations[1].Status, "FAILED");
});

test("a waitStrategy error fails too", async () => {
  const { output, updates } = await invoke(async ({ ctx }) =>
    ctx.waitForCondition({
      initialState: 0,
      fn: () => 1,
      waitStrategy: () => {
        throw new RangeError("too many");
      },
    }),
  );
  assert.equal(updates.at(-1).Action, "FAIL");
  assert.deepEqual(updates.at(-1).Error, {
    ErrorType: "RangeError",
    ErrorMessage: "too many",
  });
  assert.equal(output.Error.ErrorType, "RangeError");
});

test("replay: SUCCEEDED returns, FAILED throws, PENDING blocks, no fn", async () => {
  const check = {
    initialState: 0,
    fn: () => assert.fail("must not run"),
    waitStrategy: () => ({ shouldContinue: false }),
  };
  const workflow = async ({ ctx }) => ctx.waitForCondition(check);
  const ok = await invoke(workflow, {
    operations: [record("SUCCEEDED", { Result: "7" })],
  });
  assert.deepEqual(ok.output, { Status: "SUCCEEDED", Result: "7" });
  const failed = await invoke(workflow, {
    operations: [record("FAILED", { Error: { ErrorMessage: "x" } })],
  });
  assert.equal(failed.output.Error.ErrorType, "WaitForConditionError");
  const pending = await invoke(workflow, {
    operations: [record("PENDING", { Attempt: 1, Result: "1" })],
  });
  assert.deepEqual(pending.output, { Status: "PENDING" });
  assert.equal(pending.updates.length, 0);
});

test("a replay mismatch fails with NonDeterministicExecutionError", async () => {
  const { output } = await invoke(
    async ({ ctx }) =>
      ctx.waitForCondition({
        initialState: 0,
        fn: () => 1,
        waitStrategy: () => ({ shouldContinue: false }),
      }),
    { operations: [record("STARTED", {}, { SubType: "Step" })] },
  );
  assert.equal(output.Status, "FAILED");
  assert.equal(output.Error.ErrorType, "NonDeterministicExecutionError");
});
