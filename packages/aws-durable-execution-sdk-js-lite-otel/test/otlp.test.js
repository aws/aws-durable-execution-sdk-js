import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeExporter, otel, runDurable } from "./helpers.js";

// @opentelemetry/otlp-transformer is not a dependency. The test runs only when it is
// installed, for example by an OTLP exporter in the workspace. Otherwise it is skipped.
test("the OTLP JSON serializer accepts a batch", async (t) => {
  let transformer;
  try {
    transformer = await import("@opentelemetry/otlp-transformer");
  } catch {
    t.skip("@opentelemetry/otlp-transformer is not installed");
    return;
  }
  const exporter = fakeExporter();
  await runDurable({
    plugins: [otel(exporter)],
    workflow: async ({ ctx }) => {
      await ctx.step({
        name: "s",
        retryStrategy: () => ({ shouldRetry: false }),
        fn: () => {
          throw new Error("x");
        },
      });
    },
  });
  const bytes = transformer.JsonTraceSerializer.serializeRequest(
    exporter.spans(),
  );
  const body = JSON.parse(new TextDecoder().decode(bytes));
  const spans = body.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(body.resourceSpans.length, 1);
  assert.equal(spans.length, exporter.spans().length);
  const step = spans.find((s) => s.name === "s");
  assert.match(step.traceId, /^[0-9a-f]{32}$/);
  assert.match(step.parentSpanId, /^[0-9a-f]{16}$/);
  assert.equal(step.status.code, 2);
  assert.equal(step.events[0].name, "exception");
});
