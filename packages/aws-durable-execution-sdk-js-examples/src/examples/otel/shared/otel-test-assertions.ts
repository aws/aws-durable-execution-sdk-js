import type { SerializedSpan } from "./otel-test-setup";

export function assertInvocationViewTraceTopology(
  spans: SerializedSpan[],
): void {
  const workflowSpans = spans.filter((span) => span.name === "Workflow");
  expect(workflowSpans).toHaveLength(1);

  const workflowSpan = workflowSpans[0];
  expect(workflowSpan.parentSpanId).toBeUndefined();
  expect(workflowSpan.traceId).toMatch(/^[0-9a-f]{32}$/);

  const invocationSpans = spans.filter((span) => span.name === "Invocation");
  expect(invocationSpans.length).toBeGreaterThan(0);

  const invocationTraceIds = new Set(
    invocationSpans.map((span) => span.traceId),
  );
  expect(invocationTraceIds.has(workflowSpan.traceId)).toBe(false);

  const invocationViewSpans = spans.filter((span) => span.name !== "Workflow");
  expect(
    invocationViewSpans.every((span) => invocationTraceIds.has(span.traceId)),
  ).toBe(true);

  const durableOperationSpans = spans.filter(
    (span) => span.attributes["durable.operation.type"] !== undefined,
  );
  expect(durableOperationSpans.length).toBeGreaterThan(0);
  for (const span of durableOperationSpans) {
    expect(span.links).toContainEqual({
      traceId: workflowSpan.traceId,
      spanId: workflowSpan.spanId,
    });
  }
}
