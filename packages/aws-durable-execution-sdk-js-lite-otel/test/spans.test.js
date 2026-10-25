import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  byName,
  fakeExporter,
  idOf,
  one,
  otel,
  parentOf,
  runDurable,
} from "./helpers.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");

const childWorkflow = async ({ ctx }) => {
  await ctx.runInChildContext({
    name: "child",
    fn: async ({ ctx: c }) => {
      await c.step({ name: "inner", fn: () => 1 });
      await c.wait({ name: "pause", seconds: 5 });
      return 2;
    },
  });
  return "ok";
};

test("a child span emitted early has the context span of a later invocation as parent", async () => {
  const exporter = fakeExporter();
  const run = await runDurable({
    workflow: childWorkflow,
    plugins: [otel(exporter)],
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.invocations, 2);
  const [first, second] = exporter.batches;
  const inner = one(first, "inner");
  const child = one(second, "child");
  assert.equal(byName(first, "child").length, 0);
  assert.equal(parentOf(inner), idOf(child));
  assert.equal(inner.parentSpanContext.isRemote, true);

  const arn = inner.attributes["durable.execution.arn"];
  const traceId = sha(arn).slice(0, 32);
  for (const span of exporter.spans()) {
    assert.equal(span.spanContext().traceId, traceId);
    assert.equal(span.spanContext().traceFlags, 1);
  }
  const childRecord = run.getOperation("child");
  assert.equal(idOf(child), sha(`${arn}:${childRecord.Id}`).slice(0, 16));
  // The context has no ParentId, so its parent is the workflow span.
  const workflow = one(second, "workflow");
  assert.equal(idOf(workflow), sha(`workflow:${arn}`).slice(0, 16));
  assert.equal(parentOf(child), idOf(workflow));
});

test("two runs of one execution produce the same span ids", async () => {
  const a = fakeExporter();
  const b = fakeExporter();
  await runDurable({ workflow: childWorkflow, plugins: [otel(a)] });
  await runDurable({ workflow: childWorkflow, plugins: [otel(b)] });
  assert.deepEqual(a.spans().map(idOf), b.spans().map(idOf));
});

test("a wait that ends between invocations is emitted once, and no span twice", async () => {
  const exporter = fakeExporter();
  const run = await runDurable({
    plugins: [otel(exporter)],
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "a", fn: () => 1 });
      await ctx.wait({ name: "w1", seconds: 10 });
      await ctx.step({ name: "b", fn: () => 2 });
      await ctx.wait({ name: "w2", seconds: 10 });
      await ctx.step({ name: "c", fn: () => 3 });
      return "done";
    },
  });
  assert.equal(run.invocations, 3);
  const names = exporter.batches.map((b) => b.map((s) => s.name).sort());
  assert.deepEqual(names, [
    ["Invocation", "a", "a attempt 1"],
    ["Invocation", "b", "b attempt 1", "w1"],
    ["Invocation", "c", "c attempt 1", "w2", "workflow"],
  ]);
  const ids = exporter.spans().map(idOf);
  assert.equal(new Set(ids).size, ids.length);

  const w1 = one(exporter.spans(), "w1");
  assert.equal(w1.kind, SpanKind.INTERNAL);
  assert.deepEqual(w1.status, { code: SpanStatusCode.OK });
  assert.equal(w1.attributes["durable.operation.type"], "WAIT");
  assert.equal(w1.attributes["durable.operation.status"], "SUCCEEDED");
  assert.equal(
    w1.attributes["durable.operation.id"],
    run.getOperation("w1").Id,
  );
  // The virtual clock moved 10 seconds during the wait.
  assert.deepEqual(w1.duration, [10, 0]);
  assert.equal("durable.attempt.number" in w1.attributes, false);
});

test("a retried step has two attempt spans under one step span", async () => {
  const exporter = fakeExporter();
  const run = await runDurable({
    plugins: [otel(exporter)],
    workflow: async ({ ctx }) =>
      ctx.step({
        name: "flaky",
        retryStrategy: ({ attempt }) => ({
          shouldRetry: attempt < 2,
          delaySeconds: 1,
        }),
        fn: ({ attempt }) => {
          if (attempt === 1) throw new TypeError("first try fails");
          return "ok";
        },
      }),
  });
  assert.equal(run.status, "SUCCEEDED");
  const [first, second] = exporter.batches;
  const a1 = one(first, "flaky attempt 1");
  const a2 = one(second, "flaky attempt 2");
  const step = one(exporter.spans(), "flaky");
  assert.ok(second.includes(step));
  assert.notEqual(idOf(a1), idOf(a2));
  assert.equal(parentOf(a1), idOf(step));
  assert.equal(parentOf(a2), idOf(step));
  assert.equal(a1.status.code, SpanStatusCode.ERROR);
  assert.equal(a1.status.message, "first try fails");
  assert.deepEqual(a1.events[0].attributes, {
    "exception.type": "TypeError",
    "exception.message": "first try fails",
  });
  assert.equal(a1.attributes["durable.attempt.number"], 1);
  assert.equal(a2.status.code, SpanStatusCode.OK);
  assert.equal(a2.attributes["durable.attempt.number"], 2);
  assert.equal(step.attributes["durable.attempt.number"], 2);
  assert.equal(step.status.code, SpanStatusCode.OK);
});

test("a failed step has ERROR status and an exception event", async () => {
  const exporter = fakeExporter();
  const run = await runDurable({
    plugins: [otel(exporter)],
    workflow: async ({ ctx }) =>
      ctx.step({
        name: "boom",
        retryStrategy: () => ({ shouldRetry: false }),
        fn: () => {
          throw new RangeError("out of range");
        },
      }),
  });
  assert.equal(run.status, "FAILED");
  const step = one(exporter.spans(), "boom");
  assert.deepEqual(step.status, {
    code: SpanStatusCode.ERROR,
    message: "out of range",
  });
  assert.equal(step.events.length, 1);
  assert.equal(step.events[0].name, "exception");
  assert.deepEqual(step.events[0].time, step.endTime);
  assert.deepEqual(step.events[0].attributes, {
    "exception.type": "RangeError",
    "exception.message": "out of range",
  });

  const workflow = one(exporter.spans(), "workflow");
  assert.equal(workflow.status.code, SpanStatusCode.ERROR);
  assert.equal(workflow.attributes["durable.execution.status"], "FAILED");
  assert.equal(workflow.events.length, 1);
});

test("the workflow span is a root span in the final invocation only", async () => {
  const exporter = fakeExporter();
  await runDurable({ workflow: childWorkflow, plugins: [otel(exporter)] });
  const [first, second] = exporter.batches;
  assert.equal(byName(first, "workflow").length, 0);
  const workflow = one(second, "workflow");
  assert.equal(workflow.parentSpanContext, undefined);
  assert.deepEqual(workflow.status, { code: SpanStatusCode.OK });
  assert.equal(workflow.attributes["durable.execution.status"], "SUCCEEDED");
  // The EXECUTION record's start, from the virtual clock.
  assert.deepEqual(workflow.startTime, [1_700_000_000, 0]);
  assert.equal(workflow.ended, true);
  assert.deepEqual(workflow.links, []);
  assert.deepEqual(workflow.instrumentationScope, {
    name: "@aws/durable-execution-sdk-js-lite-otel",
    version: "0.1.0",
  });
});

test("every invocation emits one invocation span with its status", async () => {
  const exporter = fakeExporter();
  await runDurable({ workflow: childWorkflow, plugins: [otel(exporter)] });
  const invocations = byName(exporter.spans(), "Invocation");
  assert.equal(invocations.length, 2);
  const workflow = one(exporter.spans(), "workflow");
  assert.deepEqual(
    invocations.map((s) => s.attributes),
    [
      {
        "durable.execution.arn": workflow.attributes["durable.execution.arn"],
        "faas.invocation_id": "request-1",
        "durable.invocation.status": "PENDING",
        "durable.invocation.first": true,
      },
      {
        "durable.execution.arn": workflow.attributes["durable.execution.arn"],
        "faas.invocation_id": "request-2",
        "durable.invocation.status": "SUCCEEDED",
        "durable.invocation.first": false,
      },
    ],
  );
  for (const s of invocations) {
    assert.equal(parentOf(s), idOf(workflow));
    assert.equal(s.status.code, SpanStatusCode.OK);
  }
  assert.notEqual(idOf(invocations[0]), idOf(invocations[1]));
});

test("sampleRate 0 exports nothing, and sampleRate 1 exports every invocation", async () => {
  const none = fakeExporter();
  await runDurable({
    workflow: childWorkflow,
    plugins: [otel(none, { sampleRate: 0 })],
  });
  assert.equal(none.batches.length, 0);
  const all = fakeExporter();
  await runDurable({
    workflow: childWorkflow,
    plugins: [otel(all, { sampleRate: 1 })],
  });
  assert.equal(all.batches.length, 2);
});
