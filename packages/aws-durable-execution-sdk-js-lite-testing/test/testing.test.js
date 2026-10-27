import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createInMemoryService,
  runDurable as realRunDurable,
} from "../src/index.js";
import {
  createRetryStrategy,
  runDurable,
  withDurableExecution,
} from "./helpers.js";

// The start of a run: the EXECUTION record's StartTimestamp, from the virtual clock.
const startOf = (run) => run.operations[0].StartTimestamp;

// Applies updates with the current token, like one SDK request.
async function checkpoint(service, token, ...Updates) {
  const res = await service.client.checkpoint({
    DurableExecutionArn: "arn",
    CheckpointToken: token,
    Updates,
  });
  return res;
}
const ids = (event) => event.InitialExecutionState.Operations.map((o) => o.Id);

test("runDurable runs the handler that createHandler builds with the service client", async () => {
  const clients = [];
  const run = await realRunDurable({
    input: { n: 1 },
    createHandler: (client) => {
      clients.push(client);
      return withDurableExecution(
        async ({ event, ctx }) => {
          await ctx.wait({ seconds: 1 });
          return event.n + 1;
        },
        { client },
      );
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 2);
  // runDurable calls createHandler once, although the execution has two invocations.
  assert.equal(run.invocations, 2);
  assert.equal(clients.length, 1);
  assert.equal(typeof clients[0].checkpoint, "function");
});

// The SDK compares a wait's ScheduledEndTimestamp with Date.now(). If the virtual clock
// were in the past, every wait would look due, and the SDK would send an empty refresh
// checkpoint before each suspension. So the clock starts at the real time.
test("the virtual clock starts at the real time, so a wait sends no refresh checkpoint", async () => {
  const before = Math.floor(Date.now() / 1000);
  const updates = [];
  const run = await realRunDurable({
    createHandler: (client) =>
      withDurableExecution(
        async ({ ctx }) => {
          await ctx.step({ name: "a", fn: () => 1 });
          await ctx.wait({ seconds: 10 });
          return "done";
        },
        {
          client: {
            ...client,
            checkpoint: (request) => {
              updates.push(request.Updates.length);
              return client.checkpoint(request);
            },
          },
        },
      ),
  });
  assert.equal(run.status, "SUCCEEDED");
  const start = run.operations[0].StartTimestamp;
  assert.ok(start >= before && start <= Math.floor(Date.now() / 1000));
  assert.equal(updates.includes(0), false, `checkpoint sizes ${updates}`);
});

test("runDurable runs steps and returns the result and operations", async () => {
  const run = await runDurable({
    input: { n: 2 },
    workflow: async ({ event, ctx }) => {
      const a = await ctx.step({ name: "a", fn: () => event.n + 1 });
      const b = await ctx.step({ name: "b", fn: () => a * 10 });
      return { b };
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, { b: 30 });
  assert.equal(run.invocations, 1);
  assert.deepEqual(
    run.operations.map((o) => [o.Type, o.Name, o.Status]),
    [
      ["EXECUTION", undefined, "SUCCEEDED"],
      ["STEP", "a", "SUCCEEDED"],
      ["STEP", "b", "SUCCEEDED"],
    ],
  );
  assert.equal(
    run.operations[0].ExecutionDetails.InputPayload,
    JSON.stringify({ n: 2 }),
  );
  const a = run.getOperation("a");
  assert.deepEqual(a.StepDetails, { Attempt: 1, Result: "3" });
  assert.equal(a.StartTimestamp, startOf(run));
  assert.equal(run.getOperation("missing"), undefined);
});

test("step retry advances the virtual clock and re-invokes", async () => {
  const attempts = [];
  const run = await runDurable({
    workflow: ({ ctx }) =>
      ctx.step({
        name: "flaky",
        retryStrategy: () => ({ shouldRetry: true, delaySeconds: 10 }),
        fn: ({ attempt }) => {
          attempts.push(attempt);
          if (attempt < 3) throw new Error(`fail ${attempt}`);
          return "ok";
        },
      }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "ok");
  assert.equal(run.invocations, 3);
  assert.deepEqual(attempts, [1, 2, 3]);
  const op = run.getOperation("flaky");
  assert.equal(op.StepDetails.Attempt, 3);
  // The second retry was scheduled 10 s after the first one became due.
  assert.equal(op.StepDetails.NextAttemptTimestamp - op.StartTimestamp, 20);
  assert.equal(op.EndTimestamp, startOf(run) + 20);
  assert.equal(op.StepDetails.Error, undefined);
});

test("a step that exhausts its retries fails the execution", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      await ctx.step({
        name: "bad",
        retryStrategy: createRetryStrategy({ maxAttempts: 2, jitter: false }),
        fn: () => {
          throw new TypeError("nope");
        },
      });
    },
  });
  assert.equal(run.status, "FAILED");
  assert.equal(run.error.ErrorType, "TypeError");
  assert.equal(run.error.ErrorMessage, "nope");
  assert.equal(run.invocations, 2);
  const op = run.getOperation("bad");
  assert.equal(op.Status, "FAILED");
  assert.equal(op.StepDetails.Attempt, 2);
  assert.equal(op.StepDetails.Error.ErrorType, "TypeError");
});

test("replay does not call completed step functions again", async () => {
  const calls = { a: 0, b: 0, c: 0 };
  const run = await runDurable({
    pageSize: 1,
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "a", fn: () => ++calls.a });
      await ctx.step({ name: "b", fn: () => ++calls.b });
      return ctx.step({
        name: "c",
        retryStrategy: () => ({ shouldRetry: true, delaySeconds: 1 }),
        fn: () => {
          if (++calls.c < 3) throw new Error("again");
          return "done";
        },
      });
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "done");
  assert.equal(run.invocations, 3);
  assert.deepEqual(calls, { a: 1, b: 1, c: 3 });
});

test("pageSize serves the state in pages through getExecutionState", async () => {
  const service = createInMemoryService({ input: 1, pageSize: 1 });
  let token = service.event().CheckpointToken;
  for (const Id of ["s1", "s2"]) {
    token = (
      await checkpoint(service, token, { Id, Type: "STEP", Action: "START" })
    ).CheckpointToken;
  }
  const event = service.event();
  assert.deepEqual(ids(event), ["execution"]);
  assert.equal(event.InitialExecutionState.NextMarker, "1");
  const req = {
    DurableExecutionArn: "arn",
    CheckpointToken: event.CheckpointToken,
  };
  const p1 = await service.client.getExecutionState({ ...req, Marker: "1" });
  assert.deepEqual(
    [p1.Operations.map((o) => o.Id), p1.NextMarker],
    [["s1"], "2"],
  );
  const p2 = await service.client.getExecutionState({ ...req, Marker: "2" });
  assert.deepEqual(
    [p2.Operations.map((o) => o.Id), p2.NextMarker],
    [["s2"], undefined],
  );
});

test("an invocation error is retried with a new invocation", async () => {
  let first = true;
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      const v = await ctx.step({ name: "s", fn: () => 7 });
      // A BigInt cannot be serialized, so the handler wrapper throws: an invocation error.
      if (first) {
        first = false;
        return 1n;
      }
      return v;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 7);
  assert.equal(run.invocations, 2);
});

test("exceeding maxInvocations throws with the last invocation error", async () => {
  await assert.rejects(
    runDurable({ maxInvocations: 3, workflow: async () => 1n }),
    (err) => {
      assert.match(err.message, /did not finish in 3 invocations/);
      assert.match(err.message, /BigInt/);
      assert.equal(err.cause.name, "TypeError");
      return true;
    },
  );
});

test("a large result arrives through the EXECUTION checkpoint", async () => {
  // Its JSON is above the 6 MiB - 50 bytes response limit and within the service's
  // 6 MiB limit for an EXECUTION payload.
  const big = "x".repeat(6 * 1024 * 1024 - 40);
  const run = await runDurable({ workflow: async () => big });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, big);
  assert.equal(run.operations.length, 1);
  assert.equal(run.operations[0].Status, "SUCCEEDED");
});

test("a stale checkpoint token is rejected", async () => {
  const service = createInMemoryService();
  const old = service.event().CheckpointToken;
  const res = await checkpoint(service, old, {
    Id: "s",
    Type: "STEP",
    Action: "START",
  });
  assert.notEqual(res.CheckpointToken, old);
  await assert.rejects(checkpoint(service, old), {
    name: "InvalidParameterValueException",
    status: 400,
    message: "Invalid checkpoint token",
  });
  // A new invocation gets a new token, which invalidates the previous one.
  service.event();
  await assert.rejects(checkpoint(service, res.CheckpointToken), {
    name: "InvalidParameterValueException",
  });
});

test("STEP RETRY stores Payload and becomes READY when due", async () => {
  const service = createInMemoryService();
  const T0 = service.now;
  const token = service.event().CheckpointToken;
  const step = {
    Id: "w",
    Type: "STEP",
    SubType: "WaitForCondition",
    Name: "n",
  };
  const res = await checkpoint(
    service,
    token,
    { ...step, Action: "START" },
    {
      ...step,
      Action: "RETRY",
      Payload: '{"s":1}',
      StepOptions: { NextAttemptDelaySeconds: 5 },
    },
  );
  assert.deepEqual(res.NewExecutionState.Operations, [
    {
      ...step,
      StartTimestamp: T0,
      Status: "PENDING",
      StepDetails: {
        Attempt: 1,
        Result: '{"s":1}',
        NextAttemptTimestamp: T0 + 5,
      },
    },
  ]);
  assert.equal(service.advance(), true);
  assert.equal(service.now, T0 + 5);
  assert.equal(service.ops.get("w").Status, "READY");
  assert.equal(service.advance(), false);
});

test("WAIT ends at ScheduledEndTimestamp when time advances", async () => {
  const service = createInMemoryService();
  const T0 = service.now;
  const token = service.event().CheckpointToken;
  const res = await checkpoint(service, token, {
    Id: "w",
    Type: "WAIT",
    SubType: "Wait",
    Action: "START",
    WaitOptions: { WaitSeconds: 30 },
  });
  const [op] = res.NewExecutionState.Operations;
  assert.equal(op.Status, "STARTED");
  assert.equal(op.WaitDetails.ScheduledEndTimestamp, T0 + 30);
  assert.equal(await service.boundary(), 0);
  assert.equal(service.advance(), true);
  assert.equal(service.now, T0 + 30);
  assert.equal(service.ops.get("w").Status, "SUCCEEDED");
  assert.equal(service.ops.get("w").EndTimestamp, T0 + 30);
  assert.equal(service.advance(), false);
});

test("the EXECUTION record ends with the final output, not a PENDING one", async () => {
  const run = await runDurable({
    workflow: async ({ ctx }) => {
      await ctx.wait({ seconds: 5 });
      return "done";
    },
  });
  assert.equal(run.invocations, 2);
  const [execution] = run.operations;
  assert.equal(execution.Type, "EXECUTION");
  assert.equal(execution.Status, "SUCCEEDED");
  assert.equal(execution.EndTimestamp, startOf(run) + 5);
});

test("CALLBACK answers land at the boundary and timeouts when due", async () => {
  const seen = [];
  const service = createInMemoryService({
    onCallback: ({ callbackId, name }) => {
      seen.push([name, callbackId]);
      if (name === "ok") return { result: '"yes"' };
      if (name === "err")
        return { error: { ErrorType: "Denied", ErrorMessage: "no" } };
      return undefined;
    },
  });
  const T0 = service.now;
  const token = service.event().CheckpointToken;
  const cb = (Name, CallbackOptions) => ({
    Id: Name,
    Name,
    Type: "CALLBACK",
    SubType: "Callback",
    Action: "START",
    ...(CallbackOptions && { CallbackOptions }),
  });
  const res = await checkpoint(
    service,
    token,
    cb("ok"),
    cb("err"),
    cb("open"),
    cb("late", { TimeoutSeconds: 60 }),
  );
  const ops = res.NewExecutionState.Operations;
  assert.ok(ops.every((o) => o.Status === "STARTED"));
  const cbIds = ops.map((o) => o.CallbackDetails.CallbackId);
  assert.equal(new Set(cbIds).size, 4);

  assert.equal(await service.boundary(), 2);
  assert.deepEqual(
    seen,
    ops.map((o) => [o.Name, o.CallbackDetails.CallbackId]),
  );
  const get = (id) => service.ops.get(id);
  assert.equal(get("ok").Status, "SUCCEEDED");
  assert.deepEqual(get("ok").CallbackDetails, {
    CallbackId: cbIds[0],
    Result: '"yes"',
  });
  assert.equal(get("err").Status, "FAILED");
  assert.deepEqual(get("err").CallbackDetails.Error, {
    ErrorType: "Denied",
    ErrorMessage: "no",
  });
  assert.equal(get("open").Status, "STARTED");

  assert.equal(service.advance(), true);
  assert.equal(service.now, T0 + 60);
  assert.equal(get("late").Status, "TIMED_OUT");
  assert.deepEqual(get("late").CallbackDetails, {
    CallbackId: cbIds[3],
    Error: { ErrorMessage: "Callback timed out" },
  });
  // The open callback has no timeout, so nothing can change any more.
  assert.equal(service.advance(), false);
  assert.equal(await service.boundary(), 0);
  assert.equal(seen.length, 4);
});

// A Lambda function that a chained invoke without Payload calls receives the event {}.
// Measured live in us-west-2 (durable-lite-bench/results/g4-invoke-input.md).
test("CHAINED_INVOKE without Payload passes {} and with Payload null passes null", async () => {
  const inputs = [];
  const service = createInMemoryService({
    functions: { echo: ({ input }) => inputs.push(input) },
  });
  const start = (Id, Payload) => ({
    Id,
    Type: "CHAINED_INVOKE",
    SubType: "ChainedInvoke",
    Action: "START",
    ChainedInvokeOptions: { FunctionName: "echo" },
    ...(Payload !== undefined && { Payload }),
  });
  await checkpoint(
    service,
    service.event().CheckpointToken,
    start("a"),
    start("n", "null"),
  );
  assert.equal(await service.boundary(), 2);
  assert.deepEqual(inputs, [{}, null]);
});

test("CHAINED_INVOKE runs the registered function and lands at the boundary", async () => {
  const service = createInMemoryService({
    functions: {
      double: async ({ input }) => input * 2,
      boom: () => {
        throw new RangeError("bad");
      },
      nothing: () => undefined,
    },
  });
  const token = service.event().CheckpointToken;
  const inv = (Id, FunctionName, Payload) => ({
    Id,
    Type: "CHAINED_INVOKE",
    SubType: "ChainedInvoke",
    Action: "START",
    ChainedInvokeOptions: { FunctionName },
    ...(Payload !== undefined && { Payload }),
  });
  const res = await checkpoint(
    service,
    token,
    inv("d", "double", "21"),
    inv("b", "boom"),
    inv("n", "nothing"),
    inv("m", "missing"),
  );
  assert.ok(
    res.NewExecutionState.Operations.every((o) => o.Status === "STARTED"),
  );
  assert.equal(await service.boundary(), 4);
  const get = (id) => service.ops.get(id);
  assert.deepEqual(
    [get("d").Status, get("d").ChainedInvokeDetails],
    ["SUCCEEDED", { Result: "42" }],
  );
  assert.deepEqual(
    [get("b").Status, get("b").ChainedInvokeDetails],
    ["FAILED", { Error: { ErrorType: "RangeError", ErrorMessage: "bad" } }],
  );
  assert.deepEqual(
    [get("n").Status, get("n").ChainedInvokeDetails],
    ["SUCCEEDED", {}],
  );
  assert.equal(get("m").Status, "FAILED");
  assert.equal(
    get("m").ChainedInvokeDetails.Error.ErrorType,
    "ResourceNotFoundException",
  );
});

test("completed contexts hide their descendants unless ReplayChildren is set", async () => {
  const service = createInMemoryService();
  let token = service.event().CheckpointToken;
  const ctxOp = (Id, ParentId) => ({
    Id,
    ParentId,
    Type: "CONTEXT",
    SubType: "RunInChildContext",
  });
  const stepOp = (Id, ParentId) => ({
    Id,
    ParentId,
    Type: "STEP",
    SubType: "Step",
  });
  const send = async (...u) => {
    const res = await checkpoint(service, token, ...u);
    token = res.CheckpointToken;
    return res;
  };
  await send(
    { ...ctxOp("c"), Action: "START" },
    { ...stepOp("c-s", "c"), Action: "START" },
    { ...ctxOp("c-c", "c"), Action: "START" },
    { ...stepOp("c-c-s", "c-c"), Action: "START" },
    { ...ctxOp("r"), Action: "START" },
    { ...stepOp("r-s", "r"), Action: "START" },
    { ...ctxOp("f"), Action: "START" },
    { ...stepOp("f-s", "f"), Action: "START" },
  );
  assert.deepEqual(ids(service.event()), [
    "execution",
    "c",
    "c-s",
    "c-c",
    "c-c-s",
    "r",
    "r-s",
    "f",
    "f-s",
  ]);
  token = service.event().CheckpointToken;
  const res = await send(
    { ...ctxOp("c"), Action: "SUCCEED", Payload: "1" },
    {
      ...ctxOp("r"),
      Action: "SUCCEED",
      ContextOptions: { ReplayChildren: true },
    },
    { ...ctxOp("f"), Action: "FAIL", Error: { ErrorMessage: "x" } },
  );
  // Checkpoint responses are not pruned.
  assert.deepEqual(
    res.NewExecutionState.Operations.map((o) => o.Id),
    ["c", "r", "f"],
  );
  assert.deepEqual(service.ops.get("c").ContextDetails, {
    Result: "1",
    ReplayChildren: false,
  });
  assert.equal(service.ops.get("r").ContextDetails.ReplayChildren, true);
  assert.equal(service.ops.get("f").Status, "FAILED");
  const event = service.event();
  assert.deepEqual(ids(event), ["execution", "c", "r", "r-s", "f"]);
  const state = await service.client.getExecutionState({
    DurableExecutionArn: "arn",
    CheckpointToken: event.CheckpointToken,
  });
  assert.deepEqual(
    state.Operations.map((o) => o.Id),
    ["execution", "c", "r", "r-s", "f"],
  );
});

test("the service rejects updates that the real service rejects", async () => {
  const service = createInMemoryService();
  let token = service.event().CheckpointToken;
  const step = (Id, Action, fields = {}) => ({
    Id,
    Type: "STEP",
    Action,
    ...fields,
  });
  const rejects = (name, message, ...updates) =>
    assert.rejects(checkpoint(service, token, ...updates), {
      name,
      status: 400,
      message,
    });

  // Every string member must be a string.
  await rejects(
    "SerializationException",
    "Error.ErrorData must be a string",
    step("a", "FAIL", { Error: { ErrorType: "E", ErrorData: { code: 1 } } }),
  );
  await rejects(
    "SerializationException",
    "Name must be a string",
    step("a", "START", { Name: 7 }),
  );
  // STEP and CONTEXT payloads are at most 256 KiB.
  await rejects(
    "InvalidParameterValueException",
    "STEP payload is larger than 262144 bytes",
    step("a", "SUCCEED", { Payload: "x".repeat(262_145) }),
  );
  // One update per operation, except START followed by another action.
  await rejects(
    "InvalidParameterValueException",
    "Cannot update operation a twice in one request",
    step("a", "START"),
    step("a", "START"),
  );
  // A request is at most 6 MiB plus 11 KiB, whatever the number of updates.
  await assert.rejects(
    checkpoint(
      service,
      token,
      ...Array.from({ length: 25 }, (_, i) =>
        step(`big${i}`, "SUCCEED", { Payload: "x".repeat(256 * 1024) }),
      ),
    ),
    { name: "RequestEntityTooLargeException", status: 413 },
  );
  // A rejected request applies nothing.
  assert.equal(service.ops.has("a"), false);

  token = (
    await checkpoint(
      service,
      token,
      step("a", "START"),
      step("a", "SUCCEED", { Payload: "x".repeat(262_142) }),
      step("b", "START"),
    )
  ).CheckpointToken;
  // Only a READY step can start again.
  await rejects(
    "InvalidParameterValueException",
    "Cannot start STEP b in status STARTED",
    step("b", "START"),
  );
  token = (
    await checkpoint(
      service,
      token,
      step("b", "RETRY", { StepOptions: { NextAttemptDelaySeconds: 1 } }),
    )
  ).CheckpointToken;
  service.advance();
  assert.equal(service.ops.get("b").Status, "READY");
  await checkpoint(service, token, step("b", "START"));
  assert.equal(service.ops.get("b").Status, "STARTED");
});

test("runDurable fails a step whose result is larger than 256 KiB", async () => {
  const run = await runDurable({
    workflow: ({ ctx }) => ctx.step({ fn: () => "x".repeat(300 * 1024) }),
  });
  assert.equal(run.status, "FAILED");
  assert.equal(run.error.ErrorType, "InvalidParameterValueException");
});

// The limits of the OperationUpdate members in the public Lambda API reference.
for (const [member, max, bad, valid] of [
  ["SubType", 32, "bad subtype!", "a-Z_9"],
  ["Name", 256, "caf\u00e9", " ~!"],
  ["Id", 64, "a.b", "a-Z_9"],
  ["ParentId", 64, "a/b", "a-Z_9"],
]) {
  test(`the service checks the length and characters of ${member}`, async () => {
    const service = createInMemoryService();
    const token = service.event().CheckpointToken;
    const update = (value) => ({
      Id: "s",
      Type: "STEP",
      Action: "START",
      [member]: value,
    });
    const rejected = { name: "ValidationException", status: 400 };
    for (const value of ["", "a".repeat(max + 1), bad]) {
      await assert.rejects(checkpoint(service, token, update(value)), {
        ...rejected,
        message: new RegExp(`^${member} must match`),
      });
    }
    const next = await checkpoint(service, token, update("a".repeat(max)));
    await checkpoint(service, next.CheckpointToken, {
      ...update(valid),
      ...(member !== "Id" && { Id: "t" }),
    });
  });
}

test("runDurable fails a step whose subType the service rejects", async () => {
  const run = await runDurable({
    workflow: ({ ctx }) =>
      ctx.step({ name: "charge", subType: "bad subtype!", fn: () => 1 }),
  });
  assert.equal(run.status, "FAILED");
  assert.equal(run.invocations, 1);
  assert.equal(run.error.ErrorType, "ValidationException");
});
