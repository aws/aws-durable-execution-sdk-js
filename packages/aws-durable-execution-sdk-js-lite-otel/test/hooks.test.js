import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createOtelPlugin } from "../src/index.js";
import { STATUS_ERROR } from "../src/spans.js";
import {
  ARN,
  fakeExporter,
  idOf,
  info,
  one,
  otel,
  parentOf,
  runDurable,
} from "./helpers.js";

const attemptInfo = (fn) => ({
  kind: "attempt",
  id: "op-1",
  parentId: undefined,
  name: "s",
  type: "STEP",
  subType: "Step",
  attempt: 1,
  fn,
});

const end = (status = "PENDING", operations = []) => ({
  status,
  result: undefined,
  error: undefined,
  operations,
});

test("wrap returns the value and the promise of fn unchanged", async () => {
  const exporter = fakeExporter();
  const plugin = otel(exporter)(info());
  const value = { v: 1 };
  assert.equal(plugin.wrap(attemptInfo(() => value)), value);
  const promise = Promise.resolve(2);
  assert.equal(plugin.wrap(attemptInfo(() => promise)), promise);
  const ctxValue = {};
  assert.equal(
    plugin.wrap({
      kind: "context",
      id: "c",
      type: "CONTEXT",
      fn: () => ctxValue,
    }),
    ctxValue,
  );
  assert.equal(plugin.wrap({ kind: "invocation", fn: () => 3 }), 3);
  await promise;
  await plugin.onInvocationEnd(end());
  assert.equal(
    exporter.spans().filter((s) => s.name === "s attempt 1").length,
    2,
  );
});

test("a synchronous throw and a rejection propagate unchanged and fail the attempt span", async () => {
  const exporter = fakeExporter();
  const plugin = otel(exporter)(info());
  const error = new SyntaxError("sync");
  assert.throws(
    () =>
      plugin.wrap(
        attemptInfo(() => {
          throw error;
        }),
      ),
    (e) => e === error,
  );
  const rejected = Promise.reject("plain string");
  assert.equal(plugin.wrap(attemptInfo(() => rejected)), rejected);
  await assert.rejects(rejected, (e) => e === "plain string");
  await plugin.onInvocationEnd(end());
  const attempts = exporter.spans().filter((s) => s.name === "s attempt 1");
  assert.deepEqual(
    attempts.map((s) => [s.status, s.events[0].attributes]),
    [
      [
        { code: STATUS_ERROR, message: "sync" },
        { "exception.type": "SyntaxError", "exception.message": "sync" },
      ],
      [
        { code: STATUS_ERROR, message: "plain string" },
        { "exception.type": "Error", "exception.message": "plain string" },
      ],
    ],
  );
});

test("RETRYING and FAILED invocations have ERROR status", async () => {
  for (const status of ["RETRYING", "FAILED"]) {
    const exporter = fakeExporter();
    await otel(exporter)(info()).onInvocationEnd(end(status));
    const inv = one(exporter.spans(), "Invocation");
    assert.deepEqual(inv.status, {
      code: STATUS_ERROR,
      message: status,
    });
  }
});

test("record fallbacks: fractional seconds, a missing end, no name, other error details", async () => {
  const exporter = fakeExporter();
  const plugin = otel(exporter)(info({ requestId: undefined }));
  await plugin.onInvocationEnd(
    end("PENDING", [
      {
        Id: "cb",
        Type: "CALLBACK",
        Status: "TIMED_OUT",
        StartTimestamp: 1_767_225_600.25,
        EndTimestamp: 1_767_225_601.5,
      },
      {
        Id: "inv",
        Type: "CHAINED_INVOKE",
        Status: "FAILED",
        StartTimestamp: 1_700_000_000.5,
        ChainedInvokeDetails: {
          Error: { ErrorType: "Remote", ErrorMessage: "remote failed" },
        },
      },
      { Id: "open", Type: "STEP", Status: "STARTED", StartTimestamp: 1 },
    ]),
  );
  const cb = one(exporter.spans(), "CALLBACK");
  assert.deepEqual(cb.startTime, [1_767_225_600, 250_000_000]);
  assert.deepEqual(cb.duration, [1, 250_000_000]);
  assert.deepEqual(cb.status, {
    code: STATUS_ERROR,
    message: "TIMED_OUT",
  });
  assert.deepEqual(cb.events, []);
  const inv = one(exporter.spans(), "CHAINED_INVOKE");
  assert.deepEqual(inv.startTime, [1_700_000_000, 500_000_000]);
  // No EndTimestamp: the span ends at the time of onInvocationEnd.
  assert.ok(inv.endTime[0] >= Math.floor(Date.now() / 1000) - 5);
  assert.equal(inv.status.message, "remote failed");
  assert.equal(inv.events[0].attributes["exception.type"], "Remote");
  assert.equal(exporter.spans().filter((s) => s.name === "STEP").length, 0);
  // Without a request id, the invocation span id is random.
  const invocation = one(exporter.spans(), "Invocation");
  assert.match(idOf(invocation), /^[0-9a-f]{16}$/);
  assert.equal("faas.invocation_id" in invocation.attributes, false);
});

test("the workflow span name falls back to Workflow for an unexpected ARN", async () => {
  const exporter = fakeExporter();
  await otel(exporter)(
    info({ arn: "not-an-arn", operations: [] }),
  ).onInvocationEnd(end("SUCCEEDED"));
  const workflow = one(exporter.spans(), "Workflow");
  assert.equal(parentOf(workflow), undefined);
});

test("the default resource names the service; a given resource is used as is", async (t) => {
  const saved = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
  };
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  process.env.AWS_REGION = "eu-west-1";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "orders";
  const a = fakeExporter();
  await otel(a)(info()).onInvocationEnd(end());
  const res = a.spans()[0].resource;
  assert.deepEqual(res.attributes, {
    "service.name": "orders",
    "cloud.provider": "aws",
    "cloud.region": "eu-west-1",
    "faas.name": "orders",
  });
  assert.equal(res.schemaUrl, undefined);
  assert.equal(res.asyncAttributesPending, false);
  await res.waitForAsyncAttributes();
  assert.deepEqual(res.getRawAttributes()[0], ["service.name", "orders"]);
  assert.deepEqual(
    res.merge({ attributes: { "service.name": "x", k: 1 } }).attributes,
    {
      ...res.attributes,
      "service.name": "x",
      k: 1,
    },
  );
  assert.deepEqual(res.merge(null).attributes, res.attributes);

  const b = fakeExporter();
  await otel(b, { serviceName: "svc" })(info()).onInvocationEnd(end());
  assert.equal(b.spans()[0].resource.attributes["service.name"], "svc");

  const resource = { attributes: { "service.name": "mine" } };
  const c = fakeExporter();
  await otel(c, { resource })(info()).onInvocationEnd(end());
  assert.equal(c.spans()[0].resource, resource);
});

test("every span of one invocation shares one resource object", async () => {
  const exporter = fakeExporter();
  await runDurable({
    plugins: [otel(exporter)],
    workflow: ({ ctx }) => ctx.step({ name: "a", fn: () => 1 }),
  });
  assert.equal(new Set(exporter.spans().map((s) => s.resource)).size, 1);
});

test("an unsampled execution gets no plugin", () => {
  assert.equal(
    createOtelPlugin({ exporter: fakeExporter(), sampleRate: 0 })(info()),
    undefined,
  );
});

test("ARN in helpers matches the in-memory service", async () => {
  const exporter = fakeExporter();
  await runDurable({ plugins: [otel(exporter)], workflow: () => 1 });
  assert.equal(exporter.spans()[0].attributes["durable.execution.arn"], ARN);
});

// A promise and the functions that settle it.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// A terminal STEP record, as a checkpoint response carries it.
const stepRecord = (Id, Name) => ({
  Id,
  Name,
  Type: "STEP",
  SubType: "Step",
  Status: "SUCCEEDED",
  StartTimestamp: 1,
  EndTimestamp: 2,
  StepDetails: { Attempt: 1 },
});

test("an attempt that settles after onInvocationEnd adds no span and starts no export", async () => {
  const exporter = fakeExporter();
  // A short interval: a span buffered after the end would be exported within 20 ms.
  const plugin = otel(exporter, { flushIntervalMs: 20 })(info());
  const resolved = deferred();
  const rejected = deferred();
  const p1 = plugin.wrap({
    ...attemptInfo(() => resolved.promise),
    name: "late-ok",
  });
  const p2 = plugin.wrap({
    ...attemptInfo(() => rejected.promise),
    id: "op-2",
    name: "late-error",
  });
  await plugin.onInvocationEnd(end());
  const batches = exporter.batches.length;
  const spans = exporter.spans().length;

  resolved.resolve(1);
  rejected.reject(new Error("late"));
  await p1;
  await assert.rejects(p2);
  // The SDK can also call onOperationChange after the end (README of the lite SDK, "A
  // plugin ignores work that settles after onInvocationEnd").
  plugin.onOperationChange({
    updated: [stepRecord("op-3", "late-record")],
    operations: [],
  });
  await sleep(50);

  assert.equal(exporter.batches.length, batches);
  assert.equal(exporter.spans().length, spans);
  for (const name of [
    "late-ok attempt 1",
    "late-error attempt 1",
    "late-record",
  ]) {
    assert.equal(exporter.spans().filter((s) => s.name === name).length, 0);
  }
});

test("two concurrent plugin objects never mix spans", async () => {
  const exporter = fakeExporter();
  const factory = otel(exporter, { flushIntervalMs: 60_000 });
  const arnA = `${ARN}-a`;
  const arnB = `${ARN}-b`;
  const a = factory(info({ arn: arnA, requestId: "req-a" }));
  const b = factory(info({ arn: arnB, requestId: "req-b" }));
  assert.notEqual(a, b);

  // The hooks of the two invocations interleave, as on Lambda Managed Instances.
  const fa = deferred();
  const fb = deferred();
  const pa = a.wrap({ ...attemptInfo(() => fa.promise), name: "step-a" });
  const pb = b.wrap({ ...attemptInfo(() => fb.promise), name: "step-b" });
  b.onOperationChange({
    updated: [stepRecord("op-b", "rec-b")],
    operations: [],
  });
  a.onOperationChange({
    updated: [stepRecord("op-a", "rec-a")],
    operations: [],
  });
  fb.resolve();
  fa.resolve();
  await Promise.all([pa, pb]);
  await b.onInvocationEnd(end());
  await a.onInvocationEnd(end());

  assert.equal(exporter.batches.length, 2);
  const [batchB, batchA] = exporter.batches;
  const expected = [
    [batchA, arnA, "a"],
    [batchB, arnB, "b"],
  ];
  for (const [batch, arn, x] of expected) {
    assert.deepEqual(batch.map((s) => s.name).sort(), [
      "Invocation",
      `rec-${x}`,
      `step-${x} attempt 1`,
    ]);
    for (const s of batch) {
      assert.equal(s.attributes["durable.execution.arn"], arn);
    }
    assert.equal(new Set(batch.map((s) => s.spanContext().traceId)).size, 1);
  }
  assert.notEqual(
    batchA[0].spanContext().traceId,
    batchB[0].spanContext().traceId,
  );
});
