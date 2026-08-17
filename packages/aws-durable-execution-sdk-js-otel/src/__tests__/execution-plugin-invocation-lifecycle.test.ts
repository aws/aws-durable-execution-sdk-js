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
import type { Span } from "@opentelemetry/api";
import type {
  InvocationInfo,
  InvocationEndInfo,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { ProviderSource } from "../otel-plugin-config";

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

/**
 * An OTel SpanId identifies exactly one span. Because span IDs here are derived
 * deterministically from the execution ARN / operation ID so spans correlate
 * across invocations, it is easy to accidentally export two spans claiming the
 * same (traceId, spanId) — which makes generic OTLP backends retain duplicates,
 * overcount span metrics, or (as X-Ray does) let an earlier incomplete segment
 * overwrite the terminal one.
 */
function expectUniqueSpanIdentities(exporter: InMemorySpanExporter): void {
  const ids = getExportedSpans(exporter).map(
    (s) => `${s.spanContext().traceId}:${s.spanContext().spanId}`,
  );
  expect([...new Set(ids)]).toHaveLength(ids.length);
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

  describe("Invocation_Span is created when providerSource is GLOBAL", () => {
    it("creates an Invocation span as child of ambient context when providerSource is GLOBAL", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });

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

    it("creates an Invocation span with providerSource Explicit", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.EXPLICIT,
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

  describe("Workflow_Span has no span links to saved invocation context", () => {
    it("Workflow_Span has no links when an ambient invocation span exists", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
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

  describe("Ambient context is captured BEFORE Workflow_Span creation", () => {
    it("captures the ambient context with the active invocation span before Workflow_Span is created", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
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
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });

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

      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.EXPLICIT,
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
        providerSource: ProviderSource.EXPLICIT,
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

  describe("Per-invocation state is cleared after onInvocationEnd", () => {
    it("does not leak invocation state across invocations (no ambient context on second)", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
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
      // No state from the first invocation should leak into the second
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
      // Should link to the new Invocation span (not the previous ambient context)
      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(opSpan!.links.length).toBe(1);
      expect(opSpan!.links[0].context.spanId).toBe(
        invocationSpan!.spanContext().spanId,
      );
    });

    it("clears workflowSpan, invocationSpan, and spanMap after onInvocationEnd", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
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

      // Invocation span is created for the second invocation
      const invocationSpans = spans.filter((s) => s.name === "Invocation");
      expect(invocationSpans.length).toBe(1);
      expect(invocationSpans[0].attributes["durable.execution.arn"]).toBe(
        "arn:second",
      );
    });

    it.each(["PENDING", "RETRYING"])(
      "clears attemptSpan after onInvocationEnd (%s)",
      async (status) => {
        const plugin = new ExecutionOtelPlugin({
          providerSource: ProviderSource.GLOBAL,
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

        // Live reference: assert the span stops recording, not just that it
        // reaches the exporter.
        const spanMap = (plugin as any).spanMap as Map<string, Span>;
        const stepSpanRef = spanMap.get("op-1");
        const attemptSpanRef = spanMap.get("op-1:attempt:1");
        expect(stepSpanRef?.isRecording()).toBe(true);
        expect(attemptSpanRef?.isRecording()).toBe(true);

        // End invocation without ending the attempt
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: status as any }),
        );

        // Both the in-flight attempt and the suspended operation are ended.
        expect(attemptSpanRef?.isRecording()).toBe(false);
        expect(stepSpanRef?.isRecording()).toBe(false);
        expect(findSpan(exporter, "my-step attempt 1")).toBeDefined();
        expect(findSpan(exporter, "my-step")).toBeDefined();

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
      },
    );
  });

  describe("Invocation_Span status mapping (PluginInvocationStatus -> OTel span status)", () => {
    it("honors custom workflowSpanName from config; invocation span name is fixed", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
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
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: status as any }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(expected);
    });

    it("maps RETRYING -> Invocation_Span status UNSET (STOPPED/TIMED_OUT indistinguishable from RETRYING)", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "RETRYING" as any }),
      );

      const invocationSpan = findSpan(exporter, "Invocation");
      expect(invocationSpan).toBeDefined();
      expect(invocationSpan!.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("maps FAILED -> Invocation_Span status ERROR with the execution error message", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });
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
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      const workflowSpan = findSpan(exporter, "Workflow");
      expect(workflowSpan).toBeDefined();
      expect(workflowSpan!.kind).toBe(SpanKind.INTERNAL);
    });

    it("maps SUCCEEDED -> span status OK", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });
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
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });
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
      "creates no recording Workflow_Span to abandon on non-terminal status %s",
      async (status) => {
        const plugin = new ExecutionOtelPlugin({
          providerSource: ProviderSource.GLOBAL,
        });
        await plugin.onInvocationStart(makeInvocationInfo());

        // Non-recording identity: nothing to end, nothing exported yet.
        let capturedSpan: Span | undefined;
        await plugin.wrapInvocation(makeInvocationInfo(), async () => {
          capturedSpan = trace.getSpan(context.active());
          return {} as any;
        });
        expect(capturedSpan).toBeDefined();
        expect(capturedSpan!.isRecording()).toBe(false);

        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: status as any }),
        );

        expect(capturedSpan!.isRecording()).toBe(false);
        expect(findSpan(exporter, "Workflow")).toBeUndefined();
      },
    );

    it("keeps a non-negative duration when executionStartTimestamp is omitted", async () => {
      // Optional field; fallback is captured at onInvocationStart.
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });
      await plugin.onInvocationStart(
        makeInvocationInfo({ executionStartTimestamp: undefined }),
      );
      // Real gap: Date is ms-truncated, so a late fallback must be measurable.
      await new Promise((r) => setTimeout(r, 15));

      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          status: "SUCCEEDED" as any,
          executionStartTimestamp: undefined,
        }),
      );

      const workflow = findSpan(exporter, "Workflow")!;
      const invocation = findSpan(exporter, "Invocation")!;
      expect(workflow).toBeDefined();
      expect(invocation).toBeDefined();

      // The Workflow_Span must contain the invocation it covers; a late
      // fallback would start it after the invocation span began.
      const cmp = (
        a: ReadableSpan["startTime"],
        b: ReadableSpan["startTime"],
      ) => a[0] - b[0] || a[1] - b[1];
      expect(cmp(workflow.startTime, invocation.startTime)).toBeLessThanOrEqual(
        0,
      );
      expect(cmp(workflow.endTime, workflow.startTime)).toBeGreaterThanOrEqual(
        0,
      );
    });

    it("exports exactly one Workflow_Span identity across a suspend/resume pair", async () => {
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });

      // Invocation 1 suspends.
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "PENDING" as any }),
      );

      // Invocation 2 (same ARN) completes the execution.
      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      // A second span with the same identity would let a backend keep the
      // earlier PENDING copy over this SUCCEEDED one.
      const workflowSpans = getExportedSpans(exporter).filter(
        (s) => s.name === "Workflow",
      );
      expect(workflowSpans).toHaveLength(1);
      expect(workflowSpans[0].attributes["durable.execution.status"]).toBe(
        "SUCCEEDED",
      );
      expect(workflowSpans[0].status.code).toBe(SpanStatusCode.OK);
      expectUniqueSpanIdentities(exporter);
    });

    it.each(["WAIT", "CALLBACK"] as const)(
      "gives a suspended %s and its completion distinct identities",
      async (type) => {
        const plugin = new ExecutionOtelPlugin({
          providerSource: ProviderSource.GLOBAL,
        });
        const name = `my-${type.toLowerCase()}`;

        // Invocation 1: the operation starts and suspends.
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationStart({
          id: "sus-1",
          type,
          name,
          isReplay: false,
        });
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "PENDING" as any }),
        );

        // Invocation 2: it resolves (cross-invocation completion).
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onOperationEnd({
          id: "sus-1",
          type,
          name,
          isReplay: false,
          status: "SUCCEEDED" as any,
        });
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
        );

        // Two segments — the partial one ended at suspension and the terminal
        // completion — with DISTINCT identities, so the incomplete copy cannot
        // overwrite the completed one.
        const opSpans = getExportedSpans(exporter).filter(
          (s) => s.name === name,
        );
        expect(opSpans).toHaveLength(2);
        expect(opSpans[0].spanContext().spanId).not.toBe(
          opSpans[1].spanContext().spanId,
        );
        expect(
          opSpans.some(
            (s) => s.attributes["durable.operation.status"] === "SUCCEEDED",
          ),
        ).toBe(true);
        expectUniqueSpanIdentities(exporter);
      },
    );

    it("keeps exported identities unique for a STEP retried across three invocations", async () => {
      // Regression guard: onOperationStart re-derives the deterministic ID on
      // every replay, so ending those spans can emit duplicate identities.
      const plugin = new ExecutionOtelPlugin({
        providerSource: ProviderSource.GLOBAL,
      });

      for (let i = 1; i <= 3; i++) {
        const base = {
          id: "op-1",
          type: "STEP",
          name: "retry-step",
          isReplay: i > 1,
        };

        await plugin.onInvocationStart(
          makeInvocationInfo({ isFirstInvocation: i === 1 }),
        );
        await plugin.onOperationStart(base);
        await plugin.onOperationAttemptStart({ ...base, attempt: i });
        await plugin.onOperationAttemptEnd({
          ...base,
          attempt: i,
          outcome: (i === 3 ? "SUCCEEDED" : "FAILED") as any,
        });
        if (i === 3) {
          await plugin.onOperationEnd({
            ...base,
            isReplay: false,
            status: "SUCCEEDED" as any,
            attempt: 3,
          });
        }
        await plugin.onInvocationEnd(
          makeInvocationEndInfo({
            status: (i === 3 ? "SUCCEEDED" : "RETRYING") as any,
          }),
        );
      }

      expectUniqueSpanIdentities(exporter);
      expect(
        getExportedSpans(exporter)
          .filter((s) => s.name === "retry-step")
          .some(
            (s) => s.attributes["durable.operation.status"] === "SUCCEEDED",
          ),
      ).toBe(true);
    });
  });
});
