import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import {
  context,
  trace,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  SpanKind,
} from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import type {
  InvocationInfo,
  InvocationEndInfo,
} from "@aws/durable-execution-sdk-js";
import {
  createExecutionOtelPluginFactory,
  ExecutionOtelPlugin,
} from "../execution-plugin";
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
): ExecutionOtelPlugin {
  return createExecutionOtelPluginFactory(config)(info);
}
import type { TracerProviderFactory } from "../otel-plugin-config";

const TEST_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123";
const TEST_REQUEST_ID = "req-abc-123";
const TEST_EXECUTION_START = new Date("2024-01-01T00:00:00Z");

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
    executionStartTimestamp: TEST_EXECUTION_START,
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
    executionStartTimestamp: TEST_EXECUTION_START,
    ...overrides,
  };
}

function getExportedSpans(exporter: InMemorySpanExporter): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

function findSpan(
  exporter: InMemorySpanExporter,
  name: string,
): ReadableSpan | undefined {
  return getExportedSpans(exporter).find((s) => s.name === name);
}

describe("ExecutionOtelPlugin - Invocation lifecycle in default-provider mode", () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;
  let explicitProviders: NodeTracerProvider[];
  let tracerProviderFactory: TracerProviderFactory;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    explicitProviders = [];
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    tracerProviderFactory = (createIdGenerator) => {
      const explicitProvider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
        idGenerator: createIdGenerator(),
      });
      explicitProviders.push(explicitProvider);
      return explicitProvider;
    };
  });

  afterEach(async () => {
    await Promise.all([
      provider.shutdown(),
      ...explicitProviders.map((explicitProvider) =>
        explicitProvider.shutdown(),
      ),
    ]);
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  describe("Invocation_Span provider behavior", () => {
    it("creates an Invocation span as child of ambient context with the global provider", async () => {
      const plugin = newPlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const spans = getExportedSpans(exporter);
      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(
        TEST_ARN,
      );
      expect(invocationSpan!.attributes["durable.invocation.first"]).toBe(true);

      // Workflow_Span should also be created
      const workflowSpan = findSpan(exporter, "Workflow");
      expect(workflowSpan).toBeDefined();
    });

    it("shares one execution trace with an application-owned provider when no ambient span exists", async () => {
      const plugin = newPlugin({
        tracerProviderFactory,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      const workflowSpan = findSpan(exporter, "Workflow");
      expect(invocationSpan).toBeDefined();
      expect(workflowSpan).toBeDefined();
      // With no propagated context and no ambient span, a synthetic execution
      // root anchors the trace and both spans parent onto it, sharing one trace.
      expect(invocationSpan!.spanContext().traceId).toBe(
        workflowSpan!.spanContext().traceId,
      );
      expect(invocationSpan!.parentSpanContext?.spanId).toBeDefined();
      expect(invocationSpan!.parentSpanContext?.spanId).toBe(
        workflowSpan!.parentSpanContext?.spanId,
      );
    });

    it("parents an application-owned provider's Invocation span to the ambient span", async () => {
      const ambientSpan = provider
        .getTracer("test-ambient-provider")
        .startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);
      // The extractor reports the ambient span's trace as the propagated Root
      // (no Parent), so the ambient span is on the canonical execution trace.
      // The Invocation span therefore parents onto the ambient span, staying
      // nested under the layer's handler span on the same trace.
      const plugin = newPlugin({
        tracerProviderFactory,
        contextExtractor: () => ({
          traceId: ambientSpan.spanContext().traceId,
        }),
      });

      await context.with(ambientContext, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
        );
      });
      ambientSpan.end();

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.parentSpanContext?.spanId).toBe(
        ambientSpan.spanContext().spanId,
      );
      expect(invocationSpan!.spanContext().traceId).toBe(
        ambientSpan.spanContext().traceId,
      );
    });

    it("parents an application-owned provider's Invocation span to extracted upstream context when no span is active", async () => {
      const traceId = "1".repeat(32);
      const parentSpanId = "2".repeat(16);
      const plugin = newPlugin({
        tracerProviderFactory,
        contextExtractor: () => ({
          traceId,
          parentSpanId,
          traceFlags: 1,
        }),
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.parentSpanContext).toMatchObject({
        traceId,
        spanId: parentSpanId,
        isRemote: true,
      });
      expect(invocationSpan!.spanContext().traceId).toBe(traceId);
    });

    it("joins chained executions onto the shared propagated trace with distinct Workflow spans", async () => {
      // When a complete remote parent (Root + Parent) is propagated to both a
      // parent and a target execution in a chained invoke, both join that one
      // execution trace. Each keeps its own deterministic Workflow span ID
      // (derived from its ARN), so the two executions stay distinguishable.
      const upstreamTraceId = "1".repeat(32);
      const upstreamParentSpanId = "2".repeat(16);
      const targetArn = `${TEST_ARN}-target`;
      const config = {
        tracerProviderFactory,
        contextExtractor: () => ({
          traceId: upstreamTraceId,
          parentSpanId: upstreamParentSpanId,
          sampling: "SAMPLED" as const,
        }),
      };
      // One instance per execution, each built from its own invocation info.
      const parentInfo = makeInvocationInfo();
      const targetInfo = makeInvocationInfo({ executionArn: targetArn });
      const parentPlugin = newPlugin(config, parentInfo);
      const targetPlugin = newPlugin(config, targetInfo);

      await parentPlugin.onInvocationStart(parentInfo);
      await parentPlugin.onInvocationEnd(makeInvocationEndInfo());
      await targetPlugin.onInvocationStart(targetInfo);
      await targetPlugin.onInvocationEnd(
        makeInvocationEndInfo({ executionArn: targetArn }),
      );

      const workflowSpans = getExportedSpans(exporter).filter(
        (span) => span.name === "Workflow",
      );
      expect(workflowSpans).toHaveLength(2);

      const parentWorkflow = workflowSpans.find(
        (span) => span.attributes["durable.execution.arn"] === TEST_ARN,
      );
      const targetWorkflow = workflowSpans.find(
        (span) => span.attributes["durable.execution.arn"] === targetArn,
      );
      expect(parentWorkflow).toBeDefined();
      expect(targetWorkflow).toBeDefined();

      // Both Workflow spans join the one propagated execution trace and parent
      // onto the propagated remote parent.
      expect(parentWorkflow!.spanContext().traceId).toBe(upstreamTraceId);
      expect(targetWorkflow!.spanContext().traceId).toBe(upstreamTraceId);
      expect(parentWorkflow!.parentSpanContext?.spanId).toBe(
        upstreamParentSpanId,
      );
      expect(targetWorkflow!.parentSpanContext?.spanId).toBe(
        upstreamParentSpanId,
      );

      // The two executions keep distinct deterministic Workflow span IDs.
      expect(parentWorkflow!.spanContext().spanId).not.toBe(
        targetWorkflow!.spanContext().spanId,
      );

      const invocationSpans = getExportedSpans(exporter).filter(
        (span) => span.name === "Invocation",
      );
      expect(invocationSpans).toHaveLength(2);
      expect(
        invocationSpans.every(
          (span) => span.spanContext().traceId === upstreamTraceId,
        ),
      ).toBe(true);
    });
  });

  describe("Workflow_Span has no span links to saved invocation context", () => {
    it("Workflow_Span has no links when an ambient invocation span exists", async () => {
      const plugin = newPlugin({});

      // Create an ambient span to simulate an invocation span from the environment
      const tracer = provider.getTracer("test");
      const ambientSpan = tracer.startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);

      await context.with(ambientContext, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
        );
      });

      ambientSpan.end();

      const workflowSpan = findSpan(exporter, "Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.links.length).toBe(0);
    });
  });

  describe("Ambient context is captured BEFORE Workflow_Span creation", () => {
    it("captures the ambient context with the active invocation span before Workflow_Span is created", async () => {
      // Create an ambient span to simulate invocation span from the environment
      const tracer = provider.getTracer("test");
      const ambientSpan = tracer.startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);
      // The extractor reports the ambient span's trace as the propagated Root,
      // so the ambient span is on the canonical execution trace and the
      // Invocation span parents onto it.
      const plugin = newPlugin({
        contextExtractor: () => ({
          traceId: ambientSpan.spanContext().traceId,
        }),
      });

      await context.with(ambientContext, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());

        // Create an operation to check it gets a link to the ambient span
        await plugin.onOperationStart({
          id: "op-1",
          type: "step",
          name: "test-op",
          isReplay: false,
        });
        await plugin.onOperationEnd({
          id: "op-1",
          type: "step",
          name: "test-op",
          isReplay: false,
        });

        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
        );
      });

      ambientSpan.end();

      // The operation span should link to the plugin-created Invocation span,
      // which is itself parented under the captured ambient invocation span.
      const opSpan = findSpan(exporter, "test-op");
      const invocationSpan = findSpan(exporter, "Invocation");
      expect(opSpan).toBeDefined();
      expect(invocationSpan).toBeDefined();
      expect(opSpan!.links.length).toBe(1);
      expect(opSpan!.links[0].context.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
      expect(invocationSpan!.parentSpanContext?.spanId).toBe(
        ambientSpan.spanContext().spanId,
      );
    });

    it("captures context even if the ambient context has no span", async () => {
      const plugin = newPlugin({});

      // No ambient span - just ROOT_CONTEXT
      await plugin.onInvocationStart(makeInvocationInfo());

      // Create an operation - it should still have a link to our Invocation span
      await plugin.onOperationStart({
        id: "op-1",
        type: "step",
        name: "test-op",
        isReplay: false,
      });
      await plugin.onOperationEnd({
        id: "op-1",
        type: "step",
        name: "test-op",
        isReplay: false,
      });

      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const opSpan = findSpan(exporter, "test-op");
      expect(opSpan).toBeDefined();
      // Links to the Invocation span we always create
      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(opSpan!.links.length).toBe(1);
      expect(opSpan!.links[0].context.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
    });
  });

  describe("forceFlush error is logged and swallowed", () => {
    it("logs the error and does not propagate it when forceFlush throws", async () => {
      // Create a provider that throws on forceFlush
      const mockProvider = {
        getTracer: provider.getTracer.bind(provider),
        forceFlush: jest.fn().mockRejectedValue(new Error("flush failed")),
      };

      const plugin = newPlugin({
        tracerProviderFactory: () => mockProvider as any,
      });

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await plugin.onInvocationStart(makeInvocationInfo());

      // Should not throw
      await expect(
        plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
        ),
      ).resolves.toBeUndefined();

      // Should have logged the error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[ExecutionOtelPlugin] forceFlush failed:",
        "flush failed",
      );

      consoleErrorSpy.mockRestore();
    });

    it("logs non-Error objects when forceFlush throws them", async () => {
      const mockProvider = {
        getTracer: provider.getTracer.bind(provider),
        forceFlush: jest.fn().mockRejectedValue("string error"),
      };

      const plugin = newPlugin({
        tracerProviderFactory: () => mockProvider as any,
      });

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[ExecutionOtelPlugin] forceFlush failed:",
        "string error",
      );

      consoleErrorSpy.mockRestore();
    });
  });

  // Nothing an invocation records can reach the next one: the SDK builds a new
  // instance per invocation out of the same factory, so these tests drive two
  // instances and assert the second invocation's spans reference only its own
  // context.
  describe("No state crosses an invocation boundary", () => {
    it("does not leak invocation state across invocations (no ambient context on second)", async () => {
      const factory = createExecutionOtelPluginFactory({});
      const firstInfo = makeInvocationInfo();
      const plugin = factory(firstInfo);

      // Create ambient span
      const tracer = provider.getTracer("test");
      const ambientSpan = tracer.startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);

      // First invocation with ambient context
      await context.with(ambientContext, async () => {
        await plugin.onInvocationStart(firstInfo);
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
        );
      });

      ambientSpan.end();
      exporter.reset();

      // Second invocation WITHOUT ambient context, on its own instance
      const secondInfo = makeInvocationInfo({ executionArn: "arn:second" });
      const second = factory(secondInfo);
      await second.onInvocationStart(secondInfo);

      // Create an operation - should have no links since there's no ambient span
      await second.onOperationStart({
        id: "op-2",
        type: "step",
        name: "second-op",
        isReplay: false,
      });
      await second.onOperationEnd({
        id: "op-2",
        type: "step",
        name: "second-op",
        isReplay: false,
      });

      await second.onInvocationEnd(
        makeInvocationEndInfo({
          executionArn: "arn:second",
          status: "SUCCEEDED" as any,
        }),
      );

      const opSpan = findSpan(exporter, "second-op");
      expect(opSpan).toBeDefined();
      // Should link to the new Invocation span (not the previous ambient context)
      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(opSpan!.links.length).toBe(1);
      expect(opSpan!.links[0].context.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
    });

    it("gives the next invocation clean workflowSpan, invocationSpan, and spanMap", async () => {
      const factory = createExecutionOtelPluginFactory({});
      const firstInfo = makeInvocationInfo();
      const plugin = factory(firstInfo);

      // First invocation
      await plugin.onInvocationStart(firstInfo);
      await plugin.onOperationStart({
        id: "op-1",
        type: "step",
        name: "first-op",
        isReplay: false,
      });
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      exporter.reset();

      // Second invocation - a new instance, so it starts clean
      const secondInfo = makeInvocationInfo({ executionArn: "arn:second" });
      const second = factory(secondInfo);
      await second.onInvocationStart(secondInfo);
      await second.onInvocationEnd(
        makeInvocationEndInfo({
          executionArn: "arn:second",
          status: "SUCCEEDED" as any,
        }),
      );

      const spans = getExportedSpans(exporter);
      // Only second invocation's Workflow span - no leftover state
      const workflowSpans = spans.filter((s) => s.name === "Workflow");
      expect(workflowSpans.length).toBe(1);
      expect(workflowSpans[0].attributes["durable.execution.arn"]).toBe(
        "arn:second",
      );

      // Invocation span is created for the second invocation
      const invocationSpans = spans.filter((s) => s.name === "Invocation");
      expect(invocationSpans.length).toBe(1);
      expect(invocationSpans[0].attributes["durable.execution.arn"]).toBe(
        "arn:second",
      );
    });

    it("does not reach a previous invocation's attempt span", async () => {
      const factory = createExecutionOtelPluginFactory({});
      const firstInfo = makeInvocationInfo();
      const plugin = factory(firstInfo);

      // Start invocation and create an attempt span (but don't end it)
      await plugin.onInvocationStart(firstInfo);
      await plugin.onOperationStart({
        id: "op-1",
        type: "step",
        name: "my-step",
        isReplay: false,
      });
      await plugin.onOperationAttemptStart({
        id: "op-1",
        type: "step",
        name: "my-step",
        isReplay: false,
        attempt: 1,
      });

      // End invocation without ending the attempt
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "PENDING" as any }),
      );

      exporter.reset();

      // Second invocation - wrapOperationAttemptFn cannot see the first
      // invocation's attempt span: it lives on an instance that is gone.
      const secondInfo = makeInvocationInfo({ executionArn: "arn:second" });
      const second = factory(secondInfo);
      await second.onInvocationStart(secondInfo);

      let capturedSpan: any;
      const fn = () => {
        capturedSpan = trace.getSpan(context.active());
        return "result";
      };

      // Call wrapOperationAttemptFn - no context is set: this instance has no
      // attempt span under that key.
      second.wrapOperationAttemptFn(
        {
          id: "op-new",
          type: "step",
          isReplay: false,
          attempt: 1,
        },
        fn,
      );

      // capturedSpan should be undefined or the root since there's no active attempt span
      expect(capturedSpan?.spanContext().spanId).not.toBeDefined();

      await second.onInvocationEnd(
        makeInvocationEndInfo({
          executionArn: "arn:second",
          status: "SUCCEEDED" as any,
        }),
      );
    });
  });

  describe("Invocation_Span status mapping (PluginInvocationStatus -> OTel span status)", () => {
    it("honors custom workflowSpanName from config; invocation span name is fixed", async () => {
      const plugin = newPlugin({
        workflowSpanName: "my-workflow",
      });
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      expect(findSpan(exporter, "my-workflow")).toBeDefined();
      expect(findSpan(exporter, "Workflow")).toBeUndefined();
      // Invocation span name is not configurable; always "Invocation"
      expect(findSpan(exporter, "Invocation")).toBeDefined();
    });

    it.each([
      ["SUCCEEDED", SpanStatusCode.OK],
      ["PENDING", SpanStatusCode.OK],
    ])("maps %s -> Invocation_Span status OK", async (status, expected) => {
      const plugin = newPlugin({});
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: status as any }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(expected);
    });

    it("maps RETRYING -> Invocation_Span status UNSET (STOPPED/TIMED_OUT indistinguishable from RETRYING)", async () => {
      const plugin = newPlugin({});
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "RETRYING" as any }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("maps FAILED -> Invocation_Span status ERROR with the execution error message", async () => {
      const plugin = newPlugin({});
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          status: "FAILED" as any,
          executionError: new Error("invocation boom"),
        }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(invocationSpan!.status.message).toBe("invocation boom");
    });
  });

  describe("Workflow_Span status mapping (PluginInvocationStatus -> OTel span status)", () => {
    it("creates the Workflow_Span with SpanKind.INTERNAL", async () => {
      const plugin = newPlugin({});
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const workflowSpan = findSpan(exporter, "Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.kind).toBe(SpanKind.INTERNAL);
    });

    it("maps SUCCEEDED -> span status OK", async () => {
      const plugin = newPlugin({});
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const workflowSpan = findSpan(exporter, "Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.status.code).toBe(SpanStatusCode.OK);
      expect(workflowSpan!.attributes["durable.execution.status"]).toBe(
        "SUCCEEDED",
      );
    });

    it("maps FAILED -> span status ERROR with the execution error message", async () => {
      const plugin = newPlugin({});
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          status: "FAILED" as any,
          executionError: new Error("boom"),
        }),
      );

      const workflowSpan = findSpan(exporter, "Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.status.code).toBe(SpanStatusCode.ERROR);
      expect(workflowSpan!.status.message).toBe("boom");
      expect(workflowSpan!.attributes["durable.execution.status"]).toBe(
        "FAILED",
      );
    });

    it.each(["PENDING", "RETRYING"])(
      "leaves the Workflow_Span un-ended (UNSET, never exported) for non-terminal status %s",
      async (status) => {
        const plugin = newPlugin({});
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: status as any }),
        );

        // Non-terminal: the Workflow_Span is intentionally never ended, so it is
        // never exported and its status stays UNSET.
        expect(findSpan(exporter, "Workflow")).toBeUndefined();
      },
    );
  });
});
