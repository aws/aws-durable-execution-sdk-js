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
  OperationInfo,
  OperationEndInfo,
  AttemptInfo,
  AttemptEndInfo,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "../execution-plugin";

const TEST_ARN =
  "arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-integration";
const TEST_REQUEST_ID = "req-integration-001";

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
    type: "step",
    isReplay: false,
    ...overrides,
  };
}

function makeOperationEndInfo(
  overrides?: Partial<OperationEndInfo>,
): OperationEndInfo {
  return {
    id: "op-1",
    type: "step",
    isReplay: false,
    ...overrides,
  };
}

function makeAttemptInfo(overrides?: Partial<AttemptInfo>): AttemptInfo {
  return {
    id: "op-1",
    type: "step",
    isReplay: false,
    attempt: 1,
    ...overrides,
  };
}

function makeAttemptEndInfo(
  overrides?: Partial<AttemptEndInfo>,
): AttemptEndInfo {
  return {
    id: "op-1",
    type: "step",
    isReplay: false,
    attempt: 1,
    outcome: "SUCCEEDED" as any,
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

describe("ExecutionOtelPlugin - Integration: End-to-end span export with default provider", () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // Register the provider globally — this is what useDefaultTracerProvider picks up
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("exports spans via InMemorySpanExporter through a full invocation lifecycle", async () => {
    /**
     * Integration test: Full lifecycle with useDefaultTracerProvider=true.
     *
     * Exercises: onInvocationStart (with ambient invocation span) →
     * onOperationStart → onOperationAttemptStart → onOperationAttemptEnd →
     * onOperationEnd → wrapChildContextFn (CONTEXT type) → onInvocationEnd
     */
    const plugin = new ExecutionOtelPlugin({
      useDefaultTracerProvider: true,
    });

    // Create an ambient invocation span (simulating the one from the Lambda layer/environment)
    const ambientTracer = provider.getTracer("test-ambient-layer");
    const ambientSpan = ambientTracer.startSpan("lambda-invocation");
    const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);
    const ambientSpanContext = ambientSpan.spanContext();

    // --- Phase 1: onInvocationStart with ambient context ---
    await context.with(ambientContext, async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
    });

    // --- Phase 2-3: Operations within wrapInvocation context ---
    await plugin.wrapInvocation(makeInvocationInfo(), async () => {
      await plugin.onOperationStart(
        makeOperationInfo({ id: "op-step-1", name: "fetch-data" }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "op-step-1",
          name: "fetch-data",
          attempt: 1,
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({
          id: "op-step-1",
          name: "fetch-data",
          attempt: 1,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({ id: "op-step-1", name: "fetch-data" }),
      );

      // --- CONTEXT operation (runInChildContext) ---
      const contextOpInfo = makeOperationInfo({
        id: "op-ctx-1",
        name: "child-context",
        type: "CONTEXT",
      });
      await plugin.onOperationStart(contextOpInfo);

      plugin.wrapChildContextFn(contextOpInfo, (...args: unknown[]) => {
        const span = args[0] as any;
        if (span && typeof span.end === "function") {
          span.end();
        }
      });

      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "op-ctx-1",
          name: "child-context",
          type: "CONTEXT",
        }),
      );

      return { output: undefined } as any;
    });

    // --- Phase 4: End invocation ---
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    // End ambient span so it gets exported too
    ambientSpan.end();

    // --- Assertions ---
    const spans = getExportedSpans(exporter);

    // Assertion 1: Spans are exported via InMemorySpanExporter (proves global provider pipeline works)
    // Expected spans: Workflow, fetch-data, fetch-data attempt 1, child-context,
    // child-context execution, lambda-invocation (ambient)
    expect(spans.length).toBeGreaterThanOrEqual(5);

    // Assertion 2: Workflow_Span has no parent (it's a root span — created with ROOT_CONTEXT)
    const workflowSpan = findSpan(exporter, "Workflow");
    expect(workflowSpan).toBeDefined();
    // A root span created with ROOT_CONTEXT has no valid parent
    expect(workflowSpan!.parentSpanContext).toBeUndefined();

    // Assertion 3: Invocation_Span is created as child of the ambient Lambda span
    const invocationSpan = findSpan(exporter, "Invocation");
    expect(invocationSpan).toBeDefined();
    expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(TEST_ARN);
    expect(invocationSpan!.parentSpanContext?.spanId).toBe(
      ambientSpanContext.spanId,
    );

    // Assertion 4: Operation span has link to the ambient invocation span
    const opSpan = findSpan(exporter, "fetch-data");
    expect(opSpan).toBeDefined();
    expect(opSpan!.links.length).toBeGreaterThan(0);
    expect(opSpan!.links[0].context.traceId).toBe(ambientSpanContext.traceId);
    expect(opSpan!.links[0].context.spanId).toBe(ambientSpanContext.spanId);

    // Assertion 5: Attempt span has link to the ambient invocation span
    const attemptSpan = spans.find(
      (s) => s.attributes["durable.attempt.number"] === 1,
    );
    expect(attemptSpan).toBeDefined();
    expect(attemptSpan!.links.length).toBeGreaterThan(0);
    expect(attemptSpan!.links[0].context.traceId).toBe(
      ambientSpanContext.traceId,
    );
    expect(attemptSpan!.links[0].context.spanId).toBe(
      ambientSpanContext.spanId,
    );

    // Assertion 6: All child spans are parented under Workflow_Span or its descendants (not ambient)
    const workflowSpanId = workflowSpan!.spanContext().spanId;
    expect(opSpan!.parentSpanContext?.spanId).toBe(workflowSpanId);

    // Attempt span is child of the operation span
    const opSpanId = opSpan!.spanContext().spanId;
    expect(attemptSpan!.parentSpanContext?.spanId).toBe(opSpanId);

    // CONTEXT operation span is child of workflow
    const ctxOpSpan = findSpan(exporter, "child-context");
    expect(ctxOpSpan).toBeDefined();
    expect(ctxOpSpan!.parentSpanContext?.spanId).toBe(workflowSpanId);
  });

  it("does not shutdown the provider (only forceFlush is called)", async () => {
    /**
     * Verifies that the plugin never calls shutdown on the globally registered
     * provider it does not own. When using useDefaultTracerProvider, the provider
     * stored internally is the ProxyTracerProvider from trace.getTracerProvider(),
     * which may not expose forceFlush directly. The plugin checks for forceFlush
     * presence and calls it if available.
     */
    const shutdownSpy = jest.spyOn(provider, "shutdown");

    const plugin = new ExecutionOtelPlugin({
      useDefaultTracerProvider: true,
    });

    // Run a minimal lifecycle
    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-flush-test", name: "flush-op" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-flush-test", name: "flush-op" }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    // shutdown should NOT have been called by the plugin
    // (afterEach calls it for cleanup, so check it wasn't called yet)
    expect(shutdownSpy).not.toHaveBeenCalled();

    shutdownSpy.mockRestore();
  });

  it("supports multiple invocation lifecycles without leaking state", async () => {
    /**
     * Verifies that per-invocation state is properly cleared between invocations
     * and the global provider remains functional across multiple lifecycles.
     */
    const plugin = new ExecutionOtelPlugin({
      useDefaultTracerProvider: true,
    });

    const ambientTracer = provider.getTracer("test-ambient-layer");

    // --- First invocation with ambient span ---
    const ambientSpan1 = ambientTracer.startSpan("invocation-1");
    const ambientContext1 = trace.setSpan(ROOT_CONTEXT, ambientSpan1);

    await context.with(ambientContext1, async () => {
      await plugin.onInvocationStart(makeInvocationInfo());
    });
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-first", name: "first-op" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-first", name: "first-op" }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());
    ambientSpan1.end();

    exporter.reset();

    // --- Second invocation with a different ambient span ---
    const ambientSpan2 = ambientTracer.startSpan("invocation-2");
    const ambientContext2 = trace.setSpan(ROOT_CONTEXT, ambientSpan2);

    await context.with(ambientContext2, async () => {
      await plugin.onInvocationStart(
        makeInvocationInfo({ executionArn: TEST_ARN + "-2" }),
      );
    });
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-second", name: "second-op" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({ id: "op-second", name: "second-op" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ executionArn: TEST_ARN + "-2" }),
    );
    ambientSpan2.end();

    const spans = getExportedSpans(exporter);

    // Should only have second invocation's spans
    const secondOpSpan = spans.find((s) => s.name === "second-op");
    expect(secondOpSpan).toBeDefined();

    // The link on second-op should point to ambientSpan2 (not ambientSpan1)
    expect(secondOpSpan!.links.length).toBeGreaterThan(0);
    expect(secondOpSpan!.links[0].context.spanId).toBe(
      ambientSpan2.spanContext().spanId,
    );

    // No links to the first ambient span
    expect(secondOpSpan!.links[0].context.spanId).not.toBe(
      ambientSpan1.spanContext().spanId,
    );
  });
});

describe("ExecutionOtelPlugin - Parent-child workflow span ID collision prevention", () => {
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

  it("parent and child workflows with same operation position produce distinct span IDs", async () => {
    const { ExecutionOtelPlugin } = await import("../execution-plugin");

    const PARENT_ARN =
      "arn:aws:lambda:us-east-1:123456789012:function:durable-workflow:$LATEST:parent-exec-1";
    const CHILD_ARN =
      "arn:aws:lambda:us-east-1:123456789012:function:durable-enrich:$LATEST:child-exec-1";

    const parentPlugin = new ExecutionOtelPlugin({
      useDefaultTracerProvider: true,
    });
    const childPlugin = new ExecutionOtelPlugin({
      useDefaultTracerProvider: true,
    });

    // --- Parent workflow execution ---
    await parentPlugin.onInvocationStart(
      makeInvocationInfo({ executionArn: PARENT_ARN }),
    );
    await parentPlugin.onOperationStart(
      makeOperationInfo({
        id: "1",
        name: "validate",
        type: "STEP",
        isReplay: false,
      }),
    );
    await parentPlugin.onOperationEnd(
      makeOperationEndInfo({ id: "1", name: "validate", type: "STEP" }),
    );
    await parentPlugin.onInvocationEnd(
      makeInvocationEndInfo({ executionArn: PARENT_ARN }),
    );

    // --- Child workflow execution ---
    await childPlugin.onInvocationStart(
      makeInvocationInfo({ executionArn: CHILD_ARN }),
    );
    await childPlugin.onOperationStart(
      makeOperationInfo({
        id: "1",
        name: "enrich",
        type: "STEP",
        isReplay: false,
      }),
    );
    await childPlugin.onOperationEnd(
      makeOperationEndInfo({ id: "1", name: "enrich", type: "STEP" }),
    );
    await childPlugin.onInvocationEnd(
      makeInvocationEndInfo({ executionArn: CHILD_ARN }),
    );

    // --- Verify span IDs are DIFFERENT ---
    const allSpans = getExportedSpans(exporter);
    const validateSpan = allSpans.find(
      (s) =>
        s.name === "validate" &&
        s.attributes["durable.execution.arn"] === PARENT_ARN,
    );
    const enrichSpan = allSpans.find(
      (s) =>
        s.name === "enrich" &&
        s.attributes["durable.execution.arn"] === CHILD_ARN,
    );

    expect(validateSpan).toBeDefined();
    expect(enrichSpan).toBeDefined();

    // Same operation position ("1") but different ARNs → different span IDs
    expect(validateSpan!.spanContext().spanId).not.toBe(
      enrichSpan!.spanContext().spanId,
    );
  });
});
