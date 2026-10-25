import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
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

const CALLEE_ARN = ARN.replace("function:workflow", "function:callee");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const ROOT = "6a0b1c2d0123456789abcdef01234567";
const header = (root = ROOT, parent = "89abcdef01234567") =>
  `Root=1-${root.slice(0, 8)}-${root.slice(8)};Parent=${parent};Sampled=0;Lineage=2:0908e91c:1`;

const final = (operations) => ({
  status: "SUCCEEDED",
  result: undefined,
  error: undefined,
  operations,
});
const EXEC = { Id: "exec", Type: "EXECUTION", Status: "STARTED" };

// Runs one final invocation through the hooks and returns its spans.
async function finalSpans(overrides, config) {
  const exporter = fakeExporter();
  const plugin = createOtelPlugin({ exporter, ...config })(info(overrides));
  await plugin.onInvocationEnd(final([EXEC]));
  return exporter.spans();
}

// Sets _X_AMZN_TRACE_ID for one test. undefined removes it.
function withEnv(t, value) {
  const old = process.env._X_AMZN_TRACE_ID;
  if (value === undefined) delete process.env._X_AMZN_TRACE_ID;
  else process.env._X_AMZN_TRACE_ID = value;
  t.after(() => {
    if (old === undefined) delete process.env._X_AMZN_TRACE_ID;
    else process.env._X_AMZN_TRACE_ID = old;
  });
}

test("the trace id is the Root of lambdaContext.xRayTraceId", async (t) => {
  withEnv(t, undefined);
  const spans = await finalSpans({
    lambdaContext: { xRayTraceId: header() },
  });
  assert.equal(spans.length, 2);
  for (const s of spans) assert.equal(s.spanContext().traceId, ROOT);
});

test("without a header, the trace id is the hash of the ARN", async (t) => {
  withEnv(t, undefined);
  const spans = await finalSpans({ lambdaContext: {} });
  for (const s of spans) {
    assert.equal(s.spanContext().traceId, sha(ARN).slice(0, 32));
  }
  const workflow = one(spans, "workflow");
  assert.deepEqual(workflow.links, []);
  assert.equal("durable.trace.header_parent" in workflow.attributes, false);
});

test("_X_AMZN_TRACE_ID is read only without lambdaContext.xRayTraceId", async (t) => {
  const other = "1111111122222222333333334444444a";
  withEnv(t, header(other));
  const fromEnv = await finalSpans({ lambdaContext: undefined });
  assert.equal(fromEnv[0].spanContext().traceId, other);
  const local = await finalSpans({ lambdaContext: { xRayTraceId: header() } });
  assert.equal(local[0].spanContext().traceId, ROOT);
});

test("a header without a valid Root falls back to the hash of the ARN", async (t) => {
  withEnv(t, undefined);
  for (const xRayTraceId of [
    "",
    "Parent=89abcdef01234567;Sampled=1",
    "Root=1-6a0b1c2d-0123;Parent=89abcdef01234567",
    "Root=2-6a0b1c2d-0123456789abcdef01234567",
    "Root=1-6A0B1C2D-0123456789ABCDEF01234567",
    "Root=1-6a0b1c2d-0123456789abcdef01234567x",
    "XRoot=1-6a0b1c2d-0123456789abcdef01234567",
  ]) {
    const spans = await finalSpans({ lambdaContext: { xRayTraceId } });
    assert.equal(
      spans[0].spanContext().traceId,
      sha(ARN).slice(0, 32),
      xRayTraceId,
    );
    assert.deepEqual(one(spans, "workflow").links, []);
  }
});

test("the workflow span links to the header's Parent and stays a root", async (t) => {
  withEnv(t, undefined);
  const spans = await finalSpans({
    lambdaContext: { xRayTraceId: header(ROOT, "0123456789abcdef") },
  });
  const workflow = one(spans, "workflow");
  assert.equal(workflow.parentSpanContext, undefined);
  assert.deepEqual(workflow.links, [
    {
      context: {
        traceId: ROOT,
        spanId: "0123456789abcdef",
        traceFlags: 1,
        isRemote: true,
      },
      attributes: { "durable.link": "invoker" },
    },
  ]);
  assert.equal(
    workflow.attributes["durable.trace.header_parent"],
    "0123456789abcdef",
  );
  // Only the workflow span has the link.
  assert.deepEqual(one(spans, "Invocation").links, []);
});

test("a header with a valid Root and an invalid Parent gives no link", async (t) => {
  withEnv(t, undefined);
  const spans = await finalSpans({
    lambdaContext: {
      xRayTraceId: `Root=1-6a0b1c2d-${ROOT.slice(8)};Parent=xyz`,
    },
  });
  assert.equal(spans[0].spanContext().traceId, ROOT);
  assert.deepEqual(one(spans, "workflow").links, []);
});

test("sampling decides on the trace id from the header", async (t) => {
  withEnv(t, undefined);
  const plugin = (root, sampleRate) =>
    createOtelPlugin({ exporter: fakeExporter(), sampleRate })(
      info({ lambdaContext: { xRayTraceId: header(root) } }),
    );
  // The last 8 hex digits divided by 2^32 are compared with sampleRate.
  const low = `${"a".repeat(24)}00000001`;
  const high = `${"a".repeat(24)}ffffffff`;
  assert.notEqual(plugin(low, 0.01), undefined);
  assert.equal(plugin(high, 0.99), undefined);
});

test("traceHeader returns this trace's Root and the invoke operation's span id", (t) => {
  withEnv(t, undefined);
  const plugin = otel(fakeExporter())(
    info({ lambdaContext: { xRayTraceId: header() } }),
  );
  assert.equal(
    plugin.traceHeader({
      id: "op-9",
      parentId: undefined,
      name: "call",
      functionName: "f",
    }),
    `Root=1-6a0b1c2d-0123456789abcdef01234567;Parent=${sha(`${ARN}:op-9`).slice(0, 16)};Sampled=1`,
  );
});

test("an invoked execution joins the caller's trace and links to its invoke span", async (t) => {
  // The caller's own header, as Lambda sets it. In runDurable, lambdaContext has no
  // xRayTraceId, so the plugin reads the environment.
  const callerParent = "0026fca1b02a7daf";
  withEnv(t, header(ROOT, callerParent));
  const callerExporter = fakeExporter();
  const calleeExporter = fakeExporter();
  const received = [];
  const run = await runDurable({
    plugins: [otel(callerExporter)],
    functions: {
      callee: async ({ input, traceHeader }) => {
        received.push(traceHeader);
        // Lambda gives the callee the header of the START as its own header.
        const saved = process.env._X_AMZN_TRACE_ID;
        process.env._X_AMZN_TRACE_ID = `${traceHeader};Lineage=2:0908e91c:1`;
        try {
          const inner = await runDurable({
            // runDurable gives every execution the same ARN. The callee's spans need
            // other ids, so its plugin sees another ARN.
            plugins: [(i) => otel(calleeExporter)({ ...i, arn: CALLEE_ARN })],
            input,
            workflow: async ({ ctx, event }) => {
              await ctx.step({ name: "c1", fn: () => 1 });
              await ctx.wait({ name: "pause", seconds: 1 });
              return event.n * 2;
            },
          });
          return inner.result;
        } finally {
          process.env._X_AMZN_TRACE_ID = saved;
        }
      },
    },
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "before", fn: () => 1 });
      return ctx.invoke({
        name: "call",
        functionName: "callee",
        input: { n: 4 },
      });
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, 8);

  const caller = callerExporter.spans();
  const callee = calleeExporter.spans();
  const call = one(caller, "call");
  const callRecord = run.getOperation("call");
  assert.equal(idOf(call), sha(`${ARN}:${callRecord.Id}`).slice(0, 16));
  assert.deepEqual(received, [
    `Root=1-6a0b1c2d-0123456789abcdef01234567;Parent=${idOf(call)};Sampled=1`,
  ]);

  // One trace: both executions use the caller's Root.
  for (const s of [...caller, ...callee]) {
    assert.equal(s.spanContext().traceId, ROOT);
  }
  // Two root spans: the caller's and the callee's workflow spans.
  const roots = [...caller, ...callee].filter((s) => !s.parentSpanContext);
  assert.equal(roots.length, 2);

  // The callee's workflow span links to the caller's invoke span.
  const calleeWorkflow = one(callee, "callee");
  assert.equal(calleeWorkflow.parentSpanContext, undefined);
  assert.equal(calleeWorkflow.links[0].context.spanId, idOf(call));
  assert.equal(
    calleeWorkflow.attributes["durable.trace.header_parent"],
    idOf(call),
  );
  // The caller's workflow span links to the Parent of its own header.
  const callerWorkflow = one(caller, "workflow");
  assert.equal(callerWorkflow.links[0].context.spanId, callerParent);
  assert.equal(parentOf(call), idOf(callerWorkflow));

  const ids = [...caller, ...callee].map(idOf);
  assert.equal(new Set(ids).size, ids.length);
});
