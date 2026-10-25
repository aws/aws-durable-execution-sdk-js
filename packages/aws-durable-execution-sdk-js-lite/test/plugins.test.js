import assert from "node:assert/strict";
import { test } from "node:test";
import { withDurableExecution } from "../src/index.js";
import { runDurable } from "../src/testing/index.js";
import { createFakeClient, event, executionOp } from "./helpers/fake-client.js";

const retryOnce = ({ attempt }) => ({ shouldRetry: attempt < 2 });

// A plugin factory that records every hook call. ends and changes collect the calls of
// all invocations. infos collects the factory arguments.
function recorder(tag = "p", log = []) {
  const rec = { infos: [], wraps: [], changes: [], ends: [], log };
  rec.factory = (info) => {
    rec.infos.push(info);
    return {
      wrap(w) {
        const { fn, ...fields } = w;
        rec.wraps.push(fields);
        log.push(`${tag}>${w.kind}`);
        const out = fn();
        log.push(`${tag}<${w.kind}`);
        return out;
      },
      onOperationChange(change) {
        rec.changes.push(change);
      },
      onInvocationEnd(end) {
        rec.ends.push(end);
      },
    };
  };
  return rec;
}

test("the factory runs once per invocation with the documented info", async () => {
  const rec = recorder();
  const events = [];
  const input = { n: 1 };
  const run = await runDurable({
    input,
    plugins: [rec.factory],
    workflow: async ({ event: e, ctx }) => {
      events.push(e);
      await ctx.step({ name: "a", fn: () => 1 });
      await ctx.wait({ name: "w", seconds: 10 });
      return "done";
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.invocations, 2);
  assert.equal(rec.infos.length, 2);
  const [first, second] = rec.infos;
  assert.equal(first.arn, second.arn);
  assert.match(first.arn, /durable-execution/);
  assert.equal(first.requestId, "request-1");
  assert.equal(second.requestId, "request-2");
  assert.equal(first.lambdaContext.awsRequestId, "request-1");
  assert.deepEqual(first.input, input);
  // The factory receives the same object that the workflow receives.
  assert.equal(first.input, events[0]);
  assert.equal(second.input, events[1]);
  assert.deepEqual(first.updatedOperationIds, []);
  assert.deepEqual(
    first.operations.map((o) => o.Type),
    ["EXECUTION"],
  );
  const wait = run.getOperation("w");
  assert.deepEqual(second.updatedOperationIds, [wait.Id]);
  assert.deepEqual(
    second.operations.map((o) => [o.Type, o.Name, o.Status]),
    [
      ["EXECUTION", undefined, "PENDING"],
      ["STEP", "a", "SUCCEEDED"],
      ["WAIT", "w", "SUCCEEDED"],
    ],
  );
});

test("the operations of the factory are a new array of the stored records", async () => {
  const client = createFakeClient({ operations: [executionOp()] });
  let info;
  let changes = 0;
  await withDurableExecution(
    async ({ ctx }) => ctx.step({ name: "a", fn: () => 1 }),
    {
      client,
      plugins: [
        (i) => {
          info = i;
          return {
            onOperationChange: ({ operations }) => {
              changes++;
              // The first record is the same stored object, in a new array.
              assert.equal(operations[0], i.operations[0]);
              assert.notEqual(operations, i.operations);
            },
          };
        },
      ],
    },
  )({ ...event(), UpdatedOperationIds: ["x"] }, { awsRequestId: "r-1" });
  assert.equal(info.requestId, "r-1");
  assert.deepEqual(info.updatedOperationIds, ["x"]);
  assert.equal(changes, 1);
});

test("wrap receives every kind with the ids of the records", async () => {
  const rec = recorder();
  let checks = 0;
  const run = await runDurable({
    plugins: [rec.factory],
    onCallback: () => ({ result: "ok" }),
    workflow: async ({ ctx }) => {
      await ctx.step({
        name: "s",
        retryStrategy: retryOnce,
        fn: ({ attempt }) => {
          if (attempt === 1) throw new Error("first");
          return 1;
        },
      });
      await ctx.waitForCondition({
        name: "c",
        initialState: 0,
        fn: ({ state }) => {
          checks++;
          return state + 1;
        },
        waitStrategy: ({ state }) => ({ shouldContinue: state < 2 }),
      });
      await ctx.runInChildContext({
        name: "child",
        fn: ({ ctx: c }) => c.step({ name: "inner", fn: () => 2 }),
      });
      await ctx.map({
        name: "nested",
        items: [1, 2],
        itemName: ({ index }) => `n${index}`,
        fn: ({ ctx: c, item }) => c.step({ name: `ns${item}`, fn: () => item }),
      });
      await ctx.map({
        name: "flat",
        nesting: "FLAT",
        items: [1, 2],
        fn: ({ ctx: c, item }) => c.step({ name: `fs${item}`, fn: () => item }),
      });
      await ctx.waitForCallback({ name: "cb", submitter: () => {} });
      return "done";
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(checks, 2);
  const byName = (name) => run.getOperation(name);
  // Each wrap call, by invocation of the plugin: the first invocation's step attempt
  // fails and suspends; the retry runs in the next invocation.
  const summary = rec.wraps.map((w) => [w.kind, w.name, w.attempt]);
  assert.deepEqual(summary.slice(0, 2), [
    ["invocation", undefined, undefined],
    ["attempt", "s", 1],
  ]);
  const attempts = rec.wraps.filter((w) => w.name === "s");
  assert.deepEqual(
    attempts.map((w) => w.attempt),
    [1, 2],
  );
  const conditions = rec.wraps.filter((w) => w.name === "c");
  assert.deepEqual(
    conditions.map((w) => [w.kind, w.type, w.subType, w.attempt]),
    [
      ["attempt", "STEP", "WaitForCondition", 1],
      ["attempt", "STEP", "WaitForCondition", 2],
    ],
  );
  // The invocation kind has only kind and fn.
  assert.deepEqual(
    rec.wraps.filter((w) => w.kind === "invocation"),
    Array(run.invocations).fill({ kind: "invocation" }),
  );
  // Every context and attempt carries the Id and ParentId of its record.
  for (const w of rec.wraps.filter((x) => x.kind !== "invocation")) {
    const record = run.operations.find((o) => o.Id === w.id);
    assert.ok(record, `a record for ${w.name}`);
    assert.equal(w.parentId, record.ParentId);
    assert.equal(w.name, record.Name);
    assert.equal(w.type, record.Type);
    assert.equal(w.subType, record.SubType);
  }
  const contexts = rec.wraps.filter((w) => w.kind === "context");
  assert.deepEqual(
    [...new Set(contexts.map((w) => `${w.subType}:${w.name}`))],
    [
      "RunInChildContext:child",
      "Map:nested",
      "MapIteration:n0",
      "MapIteration:n1",
      "Map:flat",
      "WaitForCallback:cb",
    ],
  );
  assert.ok(contexts.every((w) => w.attempt === undefined));
  // The child context's step has the context as its parent.
  const inner = rec.wraps.find((w) => w.name === "inner");
  assert.equal(inner.parentId, byName("child").Id);
  assert.equal(inner.subType, "Step");
  // A FLAT item has no record and no wrap. Its step has the map as its parent.
  const fs1 = rec.wraps.find((w) => w.name === "fs1");
  assert.equal(fs1.parentId, byName("flat").Id);
  // The root has no parent.
  assert.equal(attempts[0].parentId, undefined);
  // The submitter step of waitForCallback is an attempt inside its context.
  const submitter = rec.wraps.find(
    (w) => w.kind === "attempt" && w.parentId === byName("cb").Id,
  );
  assert.deepEqual(
    [submitter.type, submitter.subType, submitter.attempt],
    ["STEP", "Step", 1],
  );
});

test("wrap composes in array order and returns fn's result", async () => {
  const log = [];
  const a = recorder("a", log);
  const b = recorder("b", log);
  const run = await runDurable({
    plugins: [a.factory, () => undefined, b.factory],
    workflow: async ({ ctx }) => {
      log.push("workflow");
      const v = await ctx.step({
        name: "s",
        fn: () => {
          log.push("fn");
          return 7;
        },
      });
      return v * 2;
    },
  });
  assert.equal(run.result, 14);
  assert.deepEqual(log, [
    "a>invocation",
    "b>invocation",
    "workflow",
    "a>attempt",
    "b>attempt",
    "fn",
    "b<attempt",
    "a<attempt",
    "b<invocation",
    "a<invocation",
  ]);
  // Both plugins see the same fields.
  assert.deepEqual(a.wraps, b.wraps);
});

test("a ReplayChildren re-run of a child context is wrapped too", async () => {
  const rec = recorder();
  // Two steps of 150 KiB each give a context result larger than 256 KiB.
  const half = "x".repeat(150 * 1024);
  const run = await runDurable({
    plugins: [rec.factory],
    workflow: async ({ ctx }) => {
      const r = await ctx.runInChildContext({
        name: "big",
        fn: async ({ ctx: c }) =>
          (await c.step({ name: "s1", fn: () => half })) +
          (await c.step({ name: "s2", fn: () => half })),
      });
      await ctx.wait({ name: "w", seconds: 1 });
      return r.length;
    },
  });
  assert.equal(run.result, 2 * half.length);
  assert.deepEqual(
    rec.wraps.filter((w) => w.name === "big").map((w) => w.kind),
    ["context", "context"],
  );
});

test("onOperationChange receives the returned records after the merge", async () => {
  const rec = recorder();
  await runDurable({
    plugins: [rec.factory],
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "a", fn: () => 1 });
      await ctx.step({ name: "b", fn: () => 2 });
    },
  });
  assert.ok(rec.changes.length >= 1);
  for (const { updated, operations } of rec.changes) {
    assert.ok(updated.length > 0);
    // The updated records are the stored objects in the snapshot.
    for (const op of updated) assert.ok(operations.includes(op));
  }
  const last = rec.changes.at(-1);
  assert.deepEqual(
    last.operations.map((o) => [o.Name, o.Status]),
    [
      [undefined, "STARTED"],
      ["a", "SUCCEEDED"],
      ["b", "SUCCEEDED"],
    ],
  );
});

test("onOperationChange is not called for a response without records", async () => {
  const client = createFakeClient({ operations: [executionOp()] });
  client.script({ CheckpointToken: "t-1", NewExecutionState: {} });
  const rec = recorder();
  const output = await withDurableExecution(
    async ({ ctx }) => ctx.step({ name: "a", fn: () => 1 }),
    { client, plugins: [rec.factory] },
  )(event(), {});
  assert.equal(output.Status, "SUCCEEDED");
  assert.equal(client.checkpoints.length, 1);
  assert.equal(rec.changes.length, 0);
});

test("onInvocationEnd reports SUCCEEDED after the last checkpoint is saved", async () => {
  const rec = recorder();
  const value = { ok: true };
  const run = await runDurable({
    plugins: [rec.factory],
    workflow: async ({ ctx }) => {
      // An at-least-once step returns before its SUCCEED is saved.
      await ctx.step({ name: "last", fn: () => 1 });
      return value;
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(rec.ends.length, 1);
  const [end] = rec.ends;
  assert.equal(end.status, "SUCCEEDED");
  assert.equal(end.result, value);
  assert.equal(end.error, undefined);
  assert.equal(
    end.operations.find((o) => o.Name === "last").Status,
    "SUCCEEDED",
  );
});

test("onInvocationEnd reports SUCCEEDED for a result saved by checkpoint", async () => {
  const rec = recorder();
  const big = "x".repeat(6 * 1024 * 1024);
  const run = await runDurable({
    plugins: [rec.factory],
    workflow: async () => big,
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(rec.ends[0].status, "SUCCEEDED");
  assert.equal(rec.ends[0].result, big);
  assert.equal(rec.ends[0].operations[0].Status, "SUCCEEDED");
});

test("onInvocationEnd reports FAILED with the ErrorObject", async () => {
  const rec = recorder();
  const run = await runDurable({
    plugins: [rec.factory],
    workflow: async () => {
      throw new TypeError("bad");
    },
  });
  assert.equal(run.status, "FAILED");
  const [end] = rec.ends;
  assert.equal(end.status, "FAILED");
  assert.deepEqual(end.error, { ErrorType: "TypeError", ErrorMessage: "bad" });
  assert.deepEqual(end.error, run.error);
  assert.equal(end.result, undefined);
});

test("onInvocationEnd reports PENDING when the invocation suspends", async () => {
  const rec = recorder();
  await runDurable({
    plugins: [rec.factory],
    workflow: async ({ ctx }) => {
      await ctx.wait({ name: "w", seconds: 5 });
    },
  });
  assert.deepEqual(
    rec.ends.map((e) => e.status),
    ["PENDING", "SUCCEEDED"],
  );
  assert.equal(
    rec.ends[0].operations.find((o) => o.Name === "w").Status,
    "STARTED",
  );
});

test("onInvocationEnd reports RETRYING with the error the handler throws", async () => {
  const rec = recorder();
  let calls = 0;
  const serdes = {
    serialize: ({ value }) => {
      calls++;
      if (calls === 1) throw new Error("s3 down");
      return JSON.stringify(value);
    },
    deserialize: ({ data }) => JSON.parse(data),
  };
  const run = await runDurable({
    plugins: [rec.factory],
    workflow: async ({ ctx }) => ctx.step({ name: "s", fn: () => 1, serdes }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.invocationErrors.length, 1);
  assert.deepEqual(
    rec.ends.map((e) => e.status),
    ["RETRYING", "SUCCEEDED"],
  );
  assert.equal(rec.ends[0].error, run.invocationErrors[0]);
  assert.equal(rec.ends[0].error.name, "SerdesFailedError");
});

test("onInvocationEnd hooks run in parallel and are awaited", async () => {
  const order = [];
  const slow = () => ({
    onInvocationEnd: async () => {
      order.push("slow start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("slow end");
    },
  });
  const fast = () => ({
    onInvocationEnd: () => {
      order.push("fast");
    },
  });
  const client = createFakeClient({ operations: [executionOp()] });
  const output = await withDurableExecution(async () => 1, {
    client,
    plugins: [slow, fast],
  })(event(), {});
  order.push("returned");
  assert.equal(output.Status, "SUCCEEDED");
  assert.deepEqual(order, ["slow start", "fast", "slow end", "returned"]);
});

test("a throwing onOperationChange ends the invocation as RETRYING", async () => {
  const boom = new Error("hook failed");
  const ends = [];
  const client = createFakeClient({ operations: [executionOp()] });
  const handler = withDurableExecution(
    async ({ ctx }) => {
      await ctx.step({ name: "a", fn: () => 1 });
      await ctx.wait({ name: "w", seconds: 1 });
    },
    {
      client,
      plugins: [
        () => ({
          onOperationChange: () => {
            throw boom;
          },
          onInvocationEnd: (end) => {
            ends.push(end);
          },
        }),
      ],
    },
  );
  await assert.rejects(handler(event(), {}), (err) => err === boom);
  assert.deepEqual(
    ends.map((e) => [e.status, e.error]),
    [["RETRYING", boom]],
  );
});

test("a throw from wrap fails the wrapped attempt", async () => {
  const run = await runDurable({
    plugins: [
      () => ({
        wrap: ({ kind, fn }) => {
          if (kind === "attempt") throw new RangeError("wrap failed");
          return fn();
        },
      }),
    ],
    workflow: async ({ ctx }) =>
      ctx.step({
        name: "s",
        retryStrategy: () => ({ shouldRetry: false }),
        fn: () => 1,
      }),
  });
  assert.equal(run.status, "FAILED");
  assert.equal(run.error.ErrorType, "RangeError");
});

test("a throwing onInvocationEnd makes the handler throw", async () => {
  const boom = new Error("exporter failed");
  const client = createFakeClient({ operations: [executionOp()] });
  const handler = withDurableExecution(async () => 1, {
    client,
    plugins: [
      () => ({
        onInvocationEnd: async () => {
          throw boom;
        },
      }),
    ],
  });
  await assert.rejects(handler(event(), {}), (err) => err === boom);
});

test("an event without DurableExecutionArn throws before any plugin runs", async () => {
  let called = false;
  const handler = withDurableExecution(async () => 1, {
    plugins: [
      () => {
        called = true;
      },
    ],
  });
  await assert.rejects(handler({}, {}), /DurableExecutionArn/);
  assert.equal(called, false);
});

test("an empty plugins array behaves like no plugins", async () => {
  const run = await runDurable({
    plugins: [],
    workflow: async ({ ctx }) => ctx.step({ name: "a", fn: () => 3 }),
  });
  assert.equal(run.result, 3);
});

test("the event's epoch milliseconds reach plugins as epoch seconds", async () => {
  // Lambda sends the event's timestamps as epoch milliseconds. The SDK stores seconds.
  const step = {
    Id: "s",
    Type: "STEP",
    Name: "a",
    Status: "PENDING",
    StartTimestamp: 1_792_914_400_873,
    EndTimestamp: 1_792_914_402_873,
    StepDetails: { Attempt: 1, NextAttemptTimestamp: 1_792_914_403_500 },
  };
  const wait = {
    Id: "w",
    Type: "WAIT",
    Status: "STARTED",
    StartTimestamp: "2026-10-25T07:46:40.250Z",
    WaitDetails: { ScheduledEndTimestamp: 1_792_914_410_000 },
  };
  const client = createFakeClient({ operations: [executionOp(), step, wait] });
  let seen;
  await withDurableExecution(async () => 1, {
    client,
    plugins: [
      (i) => {
        seen = i.operations;
      },
    ],
  })(event([step, wait]), {});
  const [, s, w] = seen;
  assert.equal(s.StartTimestamp, 1_792_914_400.873);
  assert.equal(s.EndTimestamp, 1_792_914_402.873);
  assert.equal(s.StepDetails.NextAttemptTimestamp, 1_792_914_403.5);
  assert.equal(s.StepDetails.Attempt, 1);
  assert.equal(w.StartTimestamp, Date.parse("2026-10-25T07:46:40.250Z") / 1000);
  assert.equal(w.WaitDetails.ScheduledEndTimestamp, 1_792_914_410);
  // The event's own objects are not changed.
  assert.equal(step.StartTimestamp, 1_792_914_400_873);
});

// A workflow with one invoke at the root and one inside a child context.
const invokeWorkflow = async ({ ctx }) => {
  const a = await ctx.invoke({ name: "top", functionName: "callee", input: 1 });
  const b = await ctx.runInChildContext({
    name: "child",
    fn: ({ ctx: c }) => c.invoke({ functionName: "callee", input: 2 }),
  });
  return [a, b];
};

test("traceHeader is called once per new invoke START, and never on replay", async () => {
  const calls = [];
  const received = [];
  const run = await runDurable({
    functions: {
      callee: ({ input, traceHeader }) => {
        received.push([input, traceHeader]);
        return input * 10;
      },
    },
    plugins: [
      ({ requestId }) => ({
        traceHeader: (info) => {
          calls.push({ requestId, ...info });
          return `header-${info.id}`;
        },
      }),
    ],
    workflow: invokeWorkflow,
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, [10, 20]);
  // Each invoke suspends the invocation. So 3 invocations run, and each later one
  // replays the earlier invokes without calling the hook.
  assert.equal(run.invocations, 3);
  const top = run.getOperation("top");
  const child = run.getOperation("child");
  const inner = run.operations.find(
    (op) => op.Type === "CHAINED_INVOKE" && op.ParentId === child.Id,
  );
  assert.deepEqual(calls, [
    {
      requestId: "request-1",
      id: top.Id,
      parentId: undefined,
      name: "top",
      functionName: "callee",
    },
    {
      requestId: "request-2",
      id: inner.Id,
      parentId: child.Id,
      name: undefined,
      functionName: "callee",
    },
  ]);
  assert.deepEqual(received, [
    [1, `header-${top.Id}`],
    [2, `header-${inner.Id}`],
  ]);
});

test("traceHeader's value is sent as ChainedInvokeOptions.XAmznTraceId", async () => {
  const client = createFakeClient({ operations: [executionOp()] });
  const handler = withDurableExecution(
    async ({ ctx }) => ctx.invoke({ functionName: "f", tenantId: "t" }),
    { client, plugins: [() => ({ traceHeader: () => "Root=1-a-b" })] },
  );
  assert.deepEqual(await handler(event(), {}), { Status: "PENDING" });
  const [start] = client.checkpoints.flatMap((r) => r.Updates);
  assert.deepEqual(start.ChainedInvokeOptions, {
    FunctionName: "f",
    TenantId: "t",
    XAmznTraceId: "Root=1-a-b",
  });
});

test("the first plugin that returns a non-empty traceHeader wins", async () => {
  const log = [];
  const plugin = (tag, value) => () => ({
    traceHeader: () => {
      log.push(tag);
      return value;
    },
  });
  const received = [];
  await runDurable({
    functions: { f: ({ traceHeader }) => received.push(traceHeader) },
    plugins: [
      plugin("a", undefined),
      () => ({ wrap: ({ fn }) => fn() }),
      plugin("b", ""),
      plugin("c", "from-c"),
      plugin("d", "from-d"),
    ],
    workflow: async ({ ctx }) => ctx.invoke({ functionName: "f" }),
  });
  assert.deepEqual(log, ["a", "b", "c"]);
  assert.deepEqual(received, ["from-c"]);
});

test("without a traceHeader value, the START has no XAmznTraceId", async () => {
  for (const plugins of [
    [() => ({ wrap: ({ fn }) => fn() })],
    [() => ({ traceHeader: () => undefined })],
  ]) {
    const client = createFakeClient({ operations: [executionOp()] });
    const handler = withDurableExecution(
      async ({ ctx }) => ctx.invoke({ functionName: "f" }),
      { client, plugins },
    );
    await handler(event(), {});
    const [start] = client.checkpoints.flatMap((r) => r.Updates);
    assert.deepEqual(start.ChainedInvokeOptions, { FunctionName: "f" });
  }
});

test("a throw from traceHeader rejects the invoke and sends no START", async () => {
  const boom = new TypeError("header failed");
  const client = createFakeClient({ operations: [executionOp()] });
  let caught;
  const handler = withDurableExecution(
    async ({ ctx }) => {
      const p = ctx.invoke({ functionName: "f" });
      caught = await p.catch((e) => e);
      throw caught;
    },
    {
      client,
      plugins: [
        () => ({
          traceHeader: () => {
            throw boom;
          },
        }),
      ],
    },
  );
  const output = await handler(event(), {});
  assert.equal(caught, boom);
  assert.equal(output.Status, "FAILED");
  assert.equal(output.Error.ErrorType, "TypeError");
  assert.equal(
    client.checkpoints
      .flatMap((r) => r.Updates)
      .some((u) => u.Type === "CHAINED_INVOKE"),
    false,
  );
});
