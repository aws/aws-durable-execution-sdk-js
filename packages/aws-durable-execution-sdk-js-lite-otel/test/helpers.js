import { createOtelPlugin } from "../src/index.js";

export { runDurable } from "../../aws-durable-execution-sdk-js-lite/src/testing/index.js";

// An exporter that keeps every batch and reports success.
export function fakeExporter() {
  const batches = [];
  return {
    batches,
    spans: () => batches.flat(),
    export(spans, cb) {
      batches.push(spans);
      cb({ code: 0 });
    },
  };
}

export const otel = (exporter, config = {}) =>
  createOtelPlugin({ exporter, ...config });

export const idOf = (span) => span.spanContext().spanId;
export const parentOf = (span) => span.parentSpanContext?.spanId;
export const byName = (spans, name) => spans.filter((s) => s.name === name);
export const one = (spans, name) => {
  const found = byName(spans, name);
  if (found.length !== 1) {
    throw new Error(`expected one span "${name}", found ${found.length}`);
  }
  return found[0];
};

export const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:workflow:$LATEST/durable-execution/local/run";

// The argument of a factory, for tests that call the hooks directly.
export const info = (overrides = {}) => ({
  arn: ARN,
  requestId: "req-1",
  input: {},
  operations: [{ Id: "exec", Type: "EXECUTION", Status: "STARTED" }],
  updatedOperationIds: [],
  lambdaContext: {},
  ...overrides,
});
