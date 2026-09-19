/**
 * Unit tests for InvocationOtelPlugin with Global provider mode.
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
import { context, trace, propagation } from "@opentelemetry/api";
import {
  createInvocationOtelPluginFactory,
  InvocationOtelPlugin,
} from "../invocation-plugin";
import type { OtelPluginConfig } from "../otel-plugin-config";

/**
 * The plugin the SDK would build for one invocation: the factory called with
 * that invocation's own info, before any hook fires. Tests that drive several
 * invocations build one instance per invocation, as the SDK does, and pass the
 * info of the invocation the instance serves.
 */
function newPlugin(
  config?: OtelPluginConfig,
  info: InvocationInfo = makeInvocationInfo(),
): InvocationOtelPlugin {
  return createInvocationOtelPluginFactory(config).createPlugin(info);
}
import type { TracerProviderFactory } from "../otel-plugin-config";
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

describe("InvocationOtelPlugin - Global provider mode", () => {
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

  it("uses the global provider by default", async () => {
    const plugin = newPlugin();

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
    expect(workflowSpan!.attributes["durable.execution.arn"]).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123",
    );
    expect(workflowSpan!.attributes["durable.execution.status"]).toBe(
      "SUCCEEDED",
    );
    // With no propagated context and no ambient span, a synthetic execution
    // root anchors the trace. Both the Workflow and Invocation spans parent
    // onto it and share one execution trace.
    expect(workflowSpan!.spanContext().traceId).toBe(
      invocationSpan!.spanContext().traceId,
    );
    expect(workflowSpan!.parentSpanContext?.spanId).toBeDefined();
    expect(invocationSpan!.parentSpanContext?.spanId).toBe(
      workflowSpan!.parentSpanContext?.spanId,
    );
    // The Invocation span stays invocation-rooted: it is NOT a child of the
    // Workflow span (both are siblings under the synthetic execution root).
    expect(invocationSpan!.parentSpanContext?.spanId).not.toBe(
      workflowSpan!.spanContext().spanId,
    );
    // Operation spans link to the Workflow span for execution correlation.
    expect(
      opSpan!.links.some(
        (l) => l.context.spanId === workflowSpan!.spanContext().spanId,
      ),
    ).toBe(true);
  });

  it("exports operation spans via the global provider", async () => {
    const plugin = newPlugin();

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
    // Two invocations, so one instance each out of the same factory.
    const factory = createInvocationOtelPluginFactory({});

    // First invocation
    const firstInfo = makeInvocationInfo();
    const plugin = factory.createPlugin(firstInfo);
    await plugin.onInvocationStart(firstInfo);
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
    const secondInfo = makeInvocationInfo({ executionArn: "arn:second" });
    const second = factory.createPlugin(secondInfo);
    await second.onInvocationStart(secondInfo);
    await second.onOperationStart(
      makeOperationInfo({ id: "op-b", name: "step-b" }),
    );
    await second.onOperationEnd(
      makeOperationEndInfo({ id: "op-b", name: "step-b" }),
    );
    await second.onInvocationEnd(
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
    const factory = createInvocationOtelPluginFactory({});
    const firstInfo = makeInvocationInfo();
    const plugin = factory.createPlugin(firstInfo);

    await plugin.onInvocationStart(firstInfo);
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
    const secondInfo = makeInvocationInfo({ executionArn: "arn:second" });
    const second = factory.createPlugin(secondInfo);
    await second.onInvocationStart(secondInfo);
    await second.onOperationStart(
      makeOperationInfo({ id: "op-2", name: "second-op", type: "STEP" }),
    );
    await second.onOperationEnd(
      makeOperationEndInfo({ id: "op-2", name: "second-op", type: "STEP" }),
    );
    await second.onInvocationEnd(
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
  let tracerProviderFactory: TracerProviderFactory;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    tracerProviderFactory = (createIdGenerator) => {
      provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
        idGenerator: createIdGenerator(),
      });
      return provider;
    };
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("uses default instrumentationName when not specified", async () => {
    const plugin = newPlugin({
      tracerProviderFactory,
    });

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
    const plugin = newPlugin({
      tracerProviderFactory,
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

    const plugin = newPlugin({
      tracerProviderFactory: () => failingProvider as any,
    });

    await plugin.onInvocationStart(makeInvocationInfo());

    // Should not throw despite forceFlush failing
    await expect(
      plugin.onInvocationEnd(makeInvocationEndInfo()),
    ).resolves.not.toThrow();
  });
});
