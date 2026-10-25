import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import {
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { createOtelPlugin } from "../src/index.js";
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
        { code: SpanStatusCode.ERROR, message: "sync" },
        { "exception.type": "SyntaxError", "exception.message": "sync" },
      ],
      [
        { code: SpanStatusCode.ERROR, message: "plain string" },
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
      code: SpanStatusCode.ERROR,
      message: status,
    });
  }
});

test("record fallbacks: ISO timestamps, a missing end, no name, other error details", async () => {
  const exporter = fakeExporter();
  const plugin = otel(exporter)(info({ requestId: undefined }));
  await plugin.onInvocationEnd(
    end("PENDING", [
      {
        Id: "cb",
        Type: "CALLBACK",
        Status: "TIMED_OUT",
        StartTimestamp: "2026-01-01T00:00:00.250Z",
        EndTimestamp: "2026-01-01T00:00:01.500Z",
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
    code: SpanStatusCode.ERROR,
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

// A test-only context manager. The plugin source must not use node:async_hooks, but a
// test may. It mirrors AsyncLocalStorageContextManager from
// @opentelemetry/context-async-hooks.
function alsContextManager() {
  const als = new AsyncLocalStorage();
  return {
    active: () => als.getStore() ?? ROOT_CONTEXT,
    with: (ctx, fn, thisArg, ...args) =>
      als.run(ctx, () => fn.call(thisArg, ...args)),
    bind: (_ctx, target) => target,
    enable() {
      return this;
    },
    disable() {
      als.disable();
      return this;
    },
  };
}

test("with a context manager, user code sees the durable span as the active span", async (t) => {
  assert.ok(context.setGlobalContextManager(alsContextManager()));
  t.after(() => context.disable());
  const seen = {};
  const active = () => trace.getSpanContext(context.active());
  const exporter = fakeExporter();
  await runDurable({
    plugins: [otel(exporter)],
    workflow: async ({ ctx }) => {
      seen.workflow = active();
      await ctx.runInChildContext({
        name: "group",
        fn: async ({ ctx: c }) => {
          seen.group = active();
          await c.step({
            name: "work",
            fn: async () => {
              await new Promise((r) => setImmediate(r));
              seen.work = active();
            },
          });
        },
      });
    },
  });
  const spans = exporter.spans();
  const expected = (s) => ({ ...s.spanContext(), isRemote: undefined });
  const strip = ({ traceId, spanId, traceFlags }) => ({
    traceId,
    spanId,
    traceFlags,
    isRemote: undefined,
  });
  assert.deepEqual(strip(seen.workflow), expected(one(spans, "Invocation")));
  assert.deepEqual(strip(seen.group), expected(one(spans, "group")));
  assert.deepEqual(strip(seen.work), expected(one(spans, "work attempt 1")));
  assert.equal(
    parentOf(one(spans, "work attempt 1")),
    idOf(one(spans, "work")),
  );
  assert.equal(seen.work.traceId, one(spans, "work").spanContext().traceId);
});

test("without a context manager, no span is active in user code", async () => {
  let seen = "unset";
  await runDurable({
    plugins: [otel(fakeExporter())],
    workflow: ({ ctx }) =>
      ctx.step({
        name: "s",
        fn: () => {
          seen = trace.getSpanContext(context.active());
        },
      }),
  });
  assert.equal(seen, undefined);
});

test("ARN in helpers matches the in-memory service", async () => {
  const exporter = fakeExporter();
  await runDurable({ plugins: [otel(exporter)], workflow: () => 1 });
  assert.equal(exporter.spans()[0].attributes["durable.execution.arn"], ARN);
});
