import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { DurableOperationError } from "../src/errors.js";
import { hashId } from "../src/ids.js";
import { runDurable } from "./helpers/run-durable.js";
import { createFakeClient, executionOp } from "./helpers/fake-client.js";
import { invoke } from "./helpers/invoke.js";

const callbackRecord = (Status, CallbackDetails = {}, Name) => ({
  Id: hashId("1"),
  Type: "CALLBACK",
  SubType: "Callback",
  ...(Name !== undefined && { Name }),
  Status,
  StartTimestamp: 1,
  CallbackDetails: { CallbackId: "cb-1", ...CallbackDetails },
});

// A client whose START response carries the service-assigned CallbackId.
function startingClient() {
  const client = createFakeClient({ operations: [executionOp()] });
  client.script(({ Updates }) => ({
    CheckpointToken: "token-1",
    NewExecutionState: {
      Operations: [
        {
          ...callbackRecord("STARTED"),
          Name: Updates[0].Name,
          StartTimestamp: 1,
        },
      ],
    },
  }));
  return client;
}

test("fresh createCallback sends START with CallbackOptions and reads the id", async () => {
  const client = startingClient();
  let callbackId;
  const { output, updates } = await invoke(
    async ({ ctx }) => {
      const cb = await ctx.createCallback({
        name: "approve",
        timeoutSeconds: 60,
        heartbeatTimeoutSeconds: 10,
      });
      callbackId = cb.callbackId;
      await cb.result;
      assert.fail("must not continue");
    },
    { client },
  );
  assert.equal(callbackId, "cb-1");
  assert.deepEqual(updates, [
    {
      Id: hashId("1"),
      Name: "approve",
      Type: "CALLBACK",
      SubType: "Callback",
      Action: "START",
      CallbackOptions: { TimeoutSeconds: 60, HeartbeatTimeoutSeconds: 10 },
    },
  ]);
  assert.deepEqual(output, { Status: "PENDING" });
});

test("undefined timeouts are omitted, and CallbackOptions without any", async () => {
  const one = await invoke(async ({ ctx }) => {
    await ctx.createCallback({ timeoutSeconds: 5 });
  });
  assert.deepEqual(one.updates[0].CallbackOptions, { TimeoutSeconds: 5 });
  const none = await invoke(async ({ ctx }) => {
    await ctx.createCallback();
  });
  assert.equal("CallbackOptions" in none.updates[0], false);
  assert.equal("Name" in none.updates[0], false);
});

test("SUCCEEDED resolves to the raw result string, not parsed", async () => {
  const { output, client } = await invoke(
    async ({ ctx }) => {
      const { callbackId, result } = await ctx.createCallback({});
      assert.equal(callbackId, "cb-1");
      const value = await result;
      assert.equal(value, '{"ok":true}');
      return value;
    },
    { operations: [callbackRecord("SUCCEEDED", { Result: '{"ok":true}' })] },
  );
  assert.deepEqual(output, {
    Status: "SUCCEEDED",
    Result: JSON.stringify('{"ok":true}'),
  });
  assert.equal(client.checkpoints.length, 0);
});

test("SUCCEEDED without a Result resolves to undefined", async () => {
  const { output } = await invoke(
    async ({ ctx }) => {
      const { result } = await ctx.createCallback({});
      assert.equal(await result, undefined);
      return "ok";
    },
    { operations: [callbackRecord("SUCCEEDED")] },
  );
  assert.equal(output.Status, "SUCCEEDED");
});

test("FAILED rejects with the sender's error, or CallbackError", async () => {
  const caught = [];
  const workflow = async ({ ctx }) => {
    const { result } = await ctx.createCallback({});
    await result.catch((err) => caught.push(err));
  };
  const error = { ErrorType: "Denied", ErrorMessage: "no", ErrorData: "d" };
  await invoke(workflow, {
    operations: [callbackRecord("FAILED", { Error: error })],
  });
  await invoke(workflow, {
    operations: [callbackRecord("FAILED", { Error: { ErrorMessage: "x" } })],
  });
  assert.ok(caught[0] instanceof DurableOperationError);
  assert.deepEqual(
    caught.map((e) => [e.errorType, e.message, e.data]),
    [
      ["Denied", "no", "d"],
      ["CallbackError", "x", undefined],
    ],
  );
});

test("TIMED_OUT rejects with CallbackTimeoutError", async () => {
  const caught = [];
  const workflow = async ({ ctx }) => {
    const { result } = await ctx.createCallback({});
    await result.catch((err) => caught.push(err));
  };
  await invoke(workflow, {
    operations: [
      callbackRecord("TIMED_OUT", { Error: { ErrorMessage: "late" } }),
    ],
  });
  await invoke(workflow, { operations: [callbackRecord("TIMED_OUT")] });
  assert.deepEqual(
    caught.map((e) => [e.errorType, e.message]),
    [
      ["CallbackTimeoutError", "late"],
      ["CallbackTimeoutError", "Callback timed out"],
    ],
  );
});

test("STARTED returns the id and blocks on result without a checkpoint", async () => {
  const { output, client } = await invoke(
    async ({ ctx }) => {
      const { callbackId, result } = await ctx.createCallback({});
      assert.equal(callbackId, "cb-1");
      await result;
      assert.fail("must not continue");
    },
    { operations: [callbackRecord("STARTED")] },
  );
  assert.deepEqual(output, { Status: "PENDING" });
  assert.equal(client.checkpoints.length, 0);
});

test("a callback that replays a different operation fails the execution", async () => {
  const { output } = await invoke(
    ({ ctx }) => ctx.createCallback({ name: "b" }),
    { operations: [callbackRecord("STARTED", {}, "a")] },
  );
  assert.equal(output.Status, "FAILED");
  assert.equal(output.Error.ErrorType, "NonDeterministicExecutionError");
});

test("an un-awaited rejected result does not cause an unhandled rejection", async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    const { output } = await invoke(
      async ({ ctx }) => {
        await ctx.createCallback({});
        return "ignored";
      },
      { operations: [callbackRecord("FAILED", { Error: { ErrorType: "X" } })] },
    );
    assert.equal(output.Status, "SUCCEEDED");
    await sleep(10);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

// The usual pattern: send the id from a step, then await the result.
const approval = async ({ ctx }) => {
  const { callbackId, result } = await ctx.createCallback({
    name: "approve",
    timeoutSeconds: 300,
  });
  await ctx.step({ name: "send", fn: () => callbackId });
  return { answer: await result };
};

test("runDurable: callback success resumes with the raw string", async () => {
  const seen = [];
  const run = await runDurable({
    workflow: approval,
    onCallback: (cb) => {
      seen.push(cb);
      return { result: '"yes"' };
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, { answer: '"yes"' });
  assert.equal(run.invocations, 2);
  const op = run.getOperation("approve");
  assert.deepEqual(seen, [
    { callbackId: op.CallbackDetails.CallbackId, name: "approve" },
  ]);
  assert.equal(
    JSON.parse(run.getOperation("send").StepDetails.Result),
    op.CallbackDetails.CallbackId,
  );
});

test("runDurable: callback failure keeps the sender's errorType", async () => {
  const run = await runDurable({
    workflow: approval,
    onCallback: () => ({
      error: { ErrorType: "Rejected", ErrorMessage: "denied" },
    }),
  });
  assert.equal(run.status, "FAILED");
  assert.deepEqual(run.error, {
    ErrorType: "Rejected",
    ErrorMessage: "denied",
  });
});

test("runDurable: an unanswered callback times out", async () => {
  const run = await runDurable({ workflow: approval, onCallback: () => {} });
  assert.equal(run.status, "FAILED");
  assert.deepEqual(run.error, {
    ErrorType: "CallbackTimeoutError",
    ErrorMessage: "Callback timed out",
  });
  const op = run.getOperation("approve");
  assert.equal(op.Status, "TIMED_OUT");
  assert.equal(op.EndTimestamp - op.StartTimestamp, 300);
});

test("runDurable: a callback without timeout stays open and the run is PENDING", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const { result } = await ctx.createCallback({ name: "open" });
      return result;
    },
  });
  assert.equal(run.status, "PENDING");
  assert.equal(run.getOperation("open").Status, "STARTED");
});

test("subType replaces the SubType Callback on the wire; omitted keeps the default", async () => {
  for (const [subType, expected] of [
    ["approval-cb", "approval-cb"],
    ["", "Callback"],
    [undefined, "Callback"],
  ]) {
    const { output, updates } = await invoke(
      async ({ ctx }) => {
        await ctx.createCallback({ name: "c", subType });
      },
      { client: startingClient() },
    );
    assert.deepEqual(output, { Status: "SUCCEEDED" });
    assert.deepEqual(updates, [
      {
        Id: hashId("1"),
        Name: "c",
        Type: "CALLBACK",
        SubType: expected,
        Action: "START",
      },
    ]);
  }
});

test("a callback with a custom subType replays its record; another SubType fails", async () => {
  const record = {
    ...callbackRecord("SUCCEEDED", { Result: "yes" }),
    SubType: "custom",
  };
  const replayed = await invoke(
    async ({ ctx }) => {
      const { result } = await ctx.createCallback({ subType: "custom" });
      return result;
    },
    { operations: [record] },
  );
  assert.deepEqual(replayed.output, { Status: "SUCCEEDED", Result: '"yes"' });
  assert.equal(replayed.client.checkpoints.length, 0);

  for (const subType of ["other", undefined]) {
    const { output, client } = await invoke(
      ({ ctx }) => ctx.createCallback({ subType }),
      { operations: [record] },
    );
    assert.equal(output.Status, "FAILED");
    assert.equal(output.Error.ErrorType, "NonDeterministicExecutionError");
    assert.equal(client.checkpoints.length, 0);
  }
});

test("the in-memory service stores a custom callback SubType as given", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const { result } = await ctx.createCallback({
        name: "c",
        subType: "custom",
      });
      return result;
    },
    onCallback: () => ({ result: "ok" }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "ok");
  assert.equal(run.getOperation("c").SubType, "custom");
});
