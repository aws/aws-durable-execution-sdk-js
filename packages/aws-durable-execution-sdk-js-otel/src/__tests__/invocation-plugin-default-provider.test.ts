/**
 * Unit tests for InvocationOtelPlugin with useDefaultTracerProvider mode.
 *
 * These tests mirror the execution-plugin-default-provider-integration tests
 * but verify InvocationOtelPlugin-specific behavior:
 * - Uses the globally registered TracerProvider by default
 * - Emits the "Workflow" root span plus the "Invocation" span in both provider
 *   modes (matching ExecutionOtelPlugin)
 * - Custom instrumentationName support
 * - forceFlush error handling
 */
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import {
  context,
  trace,
  propagation,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { InvocationOtelPlugin } from "../invocation-plugin";
import type {
  InvocationInfo,
  InvocationEndInfo,
  OperationInfo,
  OperationEndInfo,
} from "@aws/durable-execution-sdk-js";

const TEST_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123";
const TEST_REQUEST_ID = "req-abc-123";

function makeInvocationInfo(
  overrides?: Partial<InvocationInfo>,
): InvocationInfo {
  return {
    requestId: TEST_REQUEST_ID,
    executionArn: TEST_ARN,
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
    ...overrides,
  };
}

function makeInvocationEndInfo(
  overrides?: Partial<InvocationEndInfo>,
): InvocationEndInfo {
  return {
    requestId: TEST_REQUEST_ID,
    executionArn: TEST_ARN,
    executionInput: {},
    operations: {},
    status: "SUCCEEDED" as any,
    executionResult: undefined,
    executionError: undefined,
    ...overrides,
  };
}

function makeOperationInfo(overrides?: Partial<OperationInfo>): OperationInfo {
  return {
    id: "op-1",
    type: "STEP",
    isReplay: false,
    ...overrides,
  };
}

function makeOperationEndInfo(
  overrides?: Partial<OperationEndInfo>,
): OperationEndInfo {
  return {
    id: "op-1",
    type: "STEP",
    isReplay: false,
    ...overrides,
  };
}

describe("InvocationOtelPlugin - useDefaultTracerProvider mode", () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("uses the global provider when useDefaultTracerProvider is explicitly true", async () => {
    const plugin = new InvocationOtelPlugin({ useDefaultTracerProvider: true });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-1", name: "test-op", type: "STEP" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-1", name: "test-op", type: "STEP" }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const spans = exporter.getFinishedSpans();
    // Operation spans are exported via the global provider
    const opSpan = spans.find((s) => s.name === "test-op");
    expect(opSpan).toBeDefined();
    // Invocation span is always created (with durable.execution.arn)
    const invocationSpan = spans.find((s) => s.name === "Invocation");
    expect(invocationSpan).toBeDefined();
    expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123",
    );
    // The Workflow root span is now emitted in default provider mode too
    // (matching ExecutionOtelPlugin and the Python/Java reference plugins).
    const workflowSpan = spans.find((s) => s.name === "Workflow");
    expect(workflowSpan).toBeDefined();
    expect(workflowSpan!.parentSpanContext).toBeUndefined();
    expect(workflowSpan!.attributes["durable.execution.arn"]).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123",
    );
    expect(workflowSpan!.attributes["durable.execution.status"]).toBe(
      "SUCCEEDED",
    );
    // The Invocation span parents to the Workflow root
    expect(invocationSpan!.parentSpanContext?.spanId).toBe(
      workflowSpan!.spanContext().spanId,
    );
  });

  it("creates its own internal provider when no config is provided", async () => {
    // When no config is provided, InvocationOtelPlugin creates its own provider (option 3)
    // Spans will NOT appear in the globally registered exporter
    const plugin = new InvocationOtelPlugin();

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    // The global exporter should NOT have any spans since the plugin uses its own provider
    const globalSpans = exporter.getFinishedSpans();
    const invocationSpan = globalSpans.find((s) => s.name === "Invocation");
    expect(invocationSpan).toBeUndefined();
  });

  it("exports operation spans via the global provider when useDefaultTracerProvider=true", async () => {
    const plugin = new InvocationOtelPlugin({ useDefaultTracerProvider: true });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-1", name: "fetch-data", type: "STEP" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-1", name: "fetch-data", type: "STEP" }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const spans = exporter.getFinishedSpans();
    const opSpan = spans.find((s) => s.name === "fetch-data");
    expect(opSpan).toBeDefined();
    expect(opSpan!.attributes["durable.operation.type"]).toBe("STEP");
  });

  it("supports multiple invocation lifecycles without leaking state", async () => {
    const plugin = new InvocationOtelPlugin({ useDefaultTracerProvider: true });

    // First invocation
    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-a", name: "step-a" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-a", name: "step-a" }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const firstSpans = exporter.getFinishedSpans().slice();
    exporter.reset();

    // Second invocation
    await plugin.onInvocationStart(
      makeInvocationInfo({ executionArn: "arn:second" }),
    );
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-b", name: "step-b" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-b", name: "step-b" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ executionArn: "arn:second" }),
    );

    const secondSpans = exporter.getFinishedSpans();

    // First invocation had step-a + invocation = 2 spans
    expect(firstSpans.find((s) => s.name === "step-a")).toBeDefined();
    expect(firstSpans.find((s) => s.name === "step-b")).toBeUndefined();

    // Second invocation had step-b + invocation = 2 spans
    expect(secondSpans.find((s) => s.name === "step-b")).toBeDefined();
    expect(secondSpans.find((s) => s.name === "step-a")).toBeUndefined();
  });

  it("does not shutdown the global provider on invocation end", async () => {
    const plugin = new InvocationOtelPlugin({ useDefaultTracerProvider: true });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-1", name: "first-op", type: "STEP" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-1", name: "first-op", type: "STEP" }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    // If provider was shut down, creating another span would fail silently
    // Verify by running another invocation
    exporter.reset();
    await plugin.onInvocationStart(
      makeInvocationInfo({ executionArn: "arn:second" }),
    );
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-2", name: "second-op", type: "STEP" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-2", name: "second-op", type: "STEP" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ executionArn: "arn:second" }),
    );

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.find((s) => s.name === "second-op")).toBeDefined();
  });
});

describe("InvocationOtelPlugin - custom instrumentationName", () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("uses default instrumentationName when not specified", async () => {
    const plugin = new InvocationOtelPlugin({ tracerProvider: provider });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const spans = exporter.getFinishedSpans();
    const invSpan = spans.find((s) => s.name === "Invocation");
    expect(invSpan).toBeDefined();
    expect(invSpan!.instrumentationScope.name).toBe(
      "aws-durable-execution-sdk-js",
    );
  });

  it("uses custom instrumentationName when specified", async () => {
    const plugin = new InvocationOtelPlugin({
      tracerProvider: provider,
      instrumentationName: "my-custom-tracer",
    });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const spans = exporter.getFinishedSpans();
    const invSpan = spans.find((s) => s.name === "Invocation");
    expect(invSpan).toBeDefined();
    expect(invSpan!.instrumentationScope.name).toBe("my-custom-tracer");
  });
});

describe("InvocationOtelPlugin - forceFlush error handling", () => {
  afterEach(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("swallows forceFlush errors gracefully", async () => {
    const failingProvider = {
      getTracer: () => ({
        startSpan: jest.fn().mockReturnValue({
          spanContext: () => ({
            traceId: "a".repeat(32),
            spanId: "b".repeat(16),
            traceFlags: 1,
          }),
          setAttribute: jest.fn(),
          setStatus: jest.fn(),
          recordException: jest.fn(),
          end: jest.fn(),
          isRecording: () => true,
        }),
        startActiveSpan: jest.fn(),
      }),
      forceFlush: jest.fn().mockRejectedValue(new Error("flush failed")),
    };

    const plugin = new InvocationOtelPlugin({
      tracerProvider: failingProvider as any,
    });

    await plugin.onInvocationStart(makeInvocationInfo());

    // Should not throw despite forceFlush failing
    await expect(
      plugin.onInvocationEnd(makeInvocationEndInfo()),
    ).resolves.not.toThrow();
  });
});
