import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import { context, trace, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import type {
  InvocationInfo,
  InvocationEndInfo,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "../execution-plugin";

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

  describe("No Invocation_Span is created when useDefaultTracerProvider=true (Req 5.1, 5.7)", () => {
    it("does not create an Invocation span when useDefaultTracerProvider is true", async () => {
      const plugin = new ExecutionOtelPlugin({
        useDefaultTracerProvider: true,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const spans = getExportedSpans(exporter);
      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeUndefined();

      // But Workflow_Span should still be created
      const workflowSpan = findSpan(exporter, "Workflow");
      expect(workflowSpan).toBeDefined();
    });

    it("creates an Invocation span when useDefaultTracerProvider is false", async () => {
      const plugin = new ExecutionOtelPlugin({
        tracerProvider: provider,
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
    });
  });

  describe("Workflow_Span has no span links to saved invocation context (Req 5.3)", () => {
    it("Workflow_Span has no links when an ambient invocation span exists", async () => {
      const plugin = new ExecutionOtelPlugin({
        useDefaultTracerProvider: true,
      });

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

  describe("Ambient context is captured BEFORE Workflow_Span creation (Req 5.1)", () => {
    it("captures the ambient context with the active invocation span before Workflow_Span is created", async () => {
      const plugin = new ExecutionOtelPlugin({
        useDefaultTracerProvider: true,
      });

      // Create an ambient span to simulate invocation span from the environment
      const tracer = provider.getTracer("test");
      const ambientSpan = tracer.startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);

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

      // The operation span should have a link to the ambient invocation span
      const opSpan = findSpan(exporter, "test-op");
      expect(opSpan).toBeDefined();
      expect(opSpan!.links.length).toBe(1);
      expect(opSpan!.links[0].context.spanId).toBe(
        ambientSpan.spanContext().spanId,
      );
    });

    it("captures context even if the ambient context has no span", async () => {
      const plugin = new ExecutionOtelPlugin({
        useDefaultTracerProvider: true,
      });

      // No ambient span - just ROOT_CONTEXT
      await plugin.onInvocationStart(makeInvocationInfo());

      // Create an operation - it should have no links since no ambient span exists
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
      expect(opSpan!.links.length).toBe(0);
    });
  });

  describe("forceFlush error is logged and swallowed (Req 4.3)", () => {
    it("logs the error and does not propagate it when forceFlush throws", async () => {
      // Create a provider that throws on forceFlush
      const mockProvider = {
        getTracer: provider.getTracer.bind(provider),
        forceFlush: jest.fn().mockRejectedValue(new Error("flush failed")),
      };

      const plugin = new ExecutionOtelPlugin({
        tracerProvider: mockProvider as any,
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

      const plugin = new ExecutionOtelPlugin({
        tracerProvider: mockProvider as any,
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

  describe("Per-invocation state is cleared after onInvocationEnd (Req 4.3, 5.7)", () => {
    it("clears savedInvocationContext after onInvocationEnd", async () => {
      const plugin = new ExecutionOtelPlugin({
        useDefaultTracerProvider: true,
      });

      // Create ambient span
      const tracer = provider.getTracer("test");
      const ambientSpan = tracer.startSpan("ambient-invocation");
      const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);

      // First invocation with ambient context
      await context.with(ambientContext, async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
        );
      });

      ambientSpan.end();
      exporter.reset();

      // Second invocation WITHOUT ambient context
      // The savedInvocationContext from the first invocation should be cleared
      await plugin.onInvocationStart(
        makeInvocationInfo({ executionArn: "arn:second" }),
      );

      // Create an operation - should have no links since there's no ambient span
      await plugin.onOperationStart({
        id: "op-2",
        type: "step",
        name: "second-op",
        isReplay: false,
      });
      await plugin.onOperationEnd({
        id: "op-2",
        type: "step",
        name: "second-op",
        isReplay: false,
      });

      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          executionArn: "arn:second",
          status: "SUCCEEDED" as any,
        }),
      );

      const opSpan = findSpan(exporter, "second-op");
      expect(opSpan).toBeDefined();
      // No links from previous invocation's ambient context
      expect(opSpan!.links.length).toBe(0);
    });

    it("clears workflowSpan, invocationSpan, and spanMap after onInvocationEnd", async () => {
      const plugin = new ExecutionOtelPlugin({
        useDefaultTracerProvider: true,
      });

      // First invocation
      await plugin.onInvocationStart(makeInvocationInfo());
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

      // Second invocation - should start clean
      await plugin.onInvocationStart(
        makeInvocationInfo({ executionArn: "arn:second" }),
      );
      await plugin.onInvocationEnd(
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

      // No Invocation span (since useDefaultTracerProvider=true)
      const invocationSpans = spans.filter((s) => s.name === "Invocation");
      expect(invocationSpans.length).toBe(0);
    });

    it("clears attemptSpan after onInvocationEnd", async () => {
      const plugin = new ExecutionOtelPlugin({
        useDefaultTracerProvider: true,
      });

      // Start invocation and create an attempt span (but don't end it)
      await plugin.onInvocationStart(makeInvocationInfo());
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

      // Second invocation - wrapOperationAttemptFn should not use stale attempt span
      await plugin.onInvocationStart(
        makeInvocationInfo({ executionArn: "arn:second" }),
      );

      let capturedSpan: any;
      const fn = () => {
        capturedSpan = trace.getSpan(context.active());
        return "result";
      };

      // Call wrapOperationAttemptFn - should not set any context since attemptSpan is cleared
      plugin.wrapOperationAttemptFn(
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

      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          executionArn: "arn:second",
          status: "SUCCEEDED" as any,
        }),
      );
    });
  });
});
