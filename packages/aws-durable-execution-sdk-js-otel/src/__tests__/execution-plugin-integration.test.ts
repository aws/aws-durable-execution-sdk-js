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
} from "@opentelemetry/api";
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
    // Register the provider globally so the plugin resolves it by default.
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
     * Integration test: Full lifecycle with the global provider.
     *
     * Exercises: onInvocationStart (with ambient invocation span) →
     * onOperationStart → onOperationAttemptStart → onOperationAttemptEnd →
     * onOperationEnd → wrapChildContextFn (CONTEXT type) → onInvocationEnd
     */
    // Create an ambient invocation span (simulating the one from the Lambda layer/environment)
    const ambientTracer = provider.getTracer("test-ambient-layer");
    const ambientSpan = ambientTracer.startSpan("lambda-invocation");
    const ambientContext = trace.setSpan(ROOT_CONTEXT, ambientSpan);
    const ambientSpanContext = ambientSpan.spanContext();

    // The extractor reports the ambient span's trace (propagated Root, no
    // Parent). With no complete remote parent, the execution joins that Root
    // trace but anchors on the deterministic synthetic root rather than the
    // ambient span.
    const plugin = new ExecutionOtelPlugin({
      contextExtractor: () => ({
        traceId: ambientSpanContext.traceId,
      }),
    });

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

    // Assertion 2: The extractor reports only a Root (no usable Parent), so
    // there is no complete remote parent. The execution joins the propagated
    // Root trace but anchors on a synthetic execution root, NOT the ambient
    // span (an ambient span's trace is not stable across reinvocations).
    const workflowSpan = findSpan(exporter, "Workflow");
    expect(workflowSpan).toBeDefined();
    expect(workflowSpan!.spanContext().traceId).toBe(
      ambientSpanContext.traceId,
    );
    expect(workflowSpan!.parentSpanContext?.spanId).not.toBe(
      ambientSpanContext.spanId,
    );

    // Assertion 3: Invocation_Span shares the execution trace with the Workflow
    // span. It parents onto the active ambient span (which is on the canonical
    // execution trace), keeping the per-invocation span nested under the layer's
    // handler span without changing the execution ancestor.
    const invocationSpan = findSpan(exporter, "Invocation");
    expect(invocationSpan).toBeDefined();
    expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(TEST_ARN);
    expect(invocationSpan!.spanContext().traceId).toBe(
      workflowSpan!.spanContext().traceId,
    );
    expect(invocationSpan!.parentSpanContext?.spanId).toBe(
      ambientSpanContext.spanId,
    );

    // Assertion 4: Operation span has link to the plugin-created Invocation_Span
    const opSpan = findSpan(exporter, "fetch-data");
    expect(opSpan).toBeDefined();
    expect(opSpan!.links.length).toBeGreaterThan(0);
    expect(opSpan!.links[0].context.traceId).toBe(
      invocationSpan!.spanContext().traceId,
    );
    expect(opSpan!.links[0].context.spanId).toBe(
      invocationSpan!.spanContext().spanId,
    );

    // Assertion 5: Attempt span has link to the plugin-created Invocation_Span
    const attemptSpan = spans.find(
      (s) => s.attributes["durable.attempt.number"] === 1,
    );
    expect(attemptSpan).toBeDefined();
    expect(attemptSpan!.links.length).toBeGreaterThan(0);
    expect(attemptSpan!.links[0].context.traceId).toBe(
      invocationSpan!.spanContext().traceId,
    );
    expect(attemptSpan!.links[0].context.spanId).toBe(
      invocationSpan!.spanContext().spanId,
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
     * provider it does not own. When using the global provider, the provider
     * stored internally is the ProxyTracerProvider from trace.getTracerProvider(),
     * which may not expose forceFlush directly. The plugin checks for forceFlush
     * presence and calls it if available.
     */
    const shutdownSpy = jest.spyOn(provider, "shutdown");

    const plugin = new ExecutionOtelPlugin({});

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
    // No backend execution context is extracted, so each invocation anchors on
    // the deterministic ARN-derived execution trace rather than on whichever
    // per-invocation ambient span happens to be active. A live ambient span is
    // never adopted as the execution trace.
    const plugin = new ExecutionOtelPlugin({
      contextExtractor: () => undefined,
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

    // Only the second invocation's Invocation span should be present (state cleared)
    const secondInvocationSpan = spans.find((s) => s.name === "Invocation");
    expect(secondInvocationSpan).toBeDefined();

    // The link on second-op should point to the second invocation's plugin-created
    // Invocation span. The Invocation span should not parent onto either
    // per-invocation ambient span because no backend execution context was
    // extracted, so the execution anchors on the ARN-derived trace.
    expect(secondOpSpan!.links.length).toBeGreaterThan(0);
    expect(secondOpSpan!.links[0].context.spanId).toBe(
      secondInvocationSpan!.spanContext().spanId,
    );
    expect(secondInvocationSpan!.parentSpanContext?.spanId).not.toBe(
      ambientSpan2.spanContext().spanId,
    );
    expect(secondInvocationSpan!.spanContext().traceId).not.toBe(
      ambientSpan2.spanContext().traceId,
    );

    // No leaked link to the first ambient span
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

    const parentPlugin = new ExecutionOtelPlugin({});
    const childPlugin = new ExecutionOtelPlugin({});

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

  // Regression: onOperationEnd can be reached with a terminal FAILURE status
  // (TIMED_OUT/STOPPED/FAILED/CANCELLED) and NO error object (callback-timeout
  // and chained-invoke cross-invocation fast paths). Those must NOT be labelled
  // OTel OK — the OK branch is gated on SUCCEEDED, so a no-error failure leaves
  // the span status at the default UNSET (code 0).
  it("onOperationEnd terminal path: TIMED_OUT status with NO error leaves the operation span NOT OK (UNSET)", async () => {
    const plugin = new ExecutionOtelPlugin({});

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-timeout", name: "timeout-op" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({
        id: "op-timeout",
        name: "timeout-op",
        status: "TIMED_OUT" as any,
        // no error object
      }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const opSpan = findSpan(exporter, "timeout-op");
    expect(opSpan).toBeDefined();
    expect(opSpan!.status.code).not.toBe(SpanStatusCode.OK);
    expect(opSpan!.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("onOperationEnd cross-invocation path: STOPPED status with NO error leaves the span NOT OK (UNSET)", async () => {
    const plugin = new ExecutionOtelPlugin({});

    await plugin.onInvocationStart(makeInvocationInfo());
    // No prior onOperationStart -> spanMap miss -> cross-invocation span path.
    await plugin.onOperationEnd(
      makeOperationEndInfo({
        id: "op-cross-stopped",
        name: "cross-stopped",
        status: "STOPPED" as any,
        // no error object
      }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const opSpan = findSpan(exporter, "cross-stopped");
    expect(opSpan).toBeDefined();
    expect(opSpan!.status.code).not.toBe(SpanStatusCode.OK);
    expect(opSpan!.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("onOperationEnd terminal path: SUCCEEDED status with NO error stamps OK", async () => {
    const plugin = new ExecutionOtelPlugin({});

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "op-ok", name: "ok-op" }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({
        id: "op-ok",
        name: "ok-op",
        status: "SUCCEEDED" as any,
      }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const opSpan = findSpan(exporter, "ok-op");
    expect(opSpan).toBeDefined();
    expect(opSpan!.status.code).toBe(SpanStatusCode.OK);
  });

  // ExecutionOtelPlugin has its own span-creation paths (deterministic span IDs,
  // Workflow_Span as the fallback parent, and a cross-invocation path in
  // onOperationEnd), so handler-provided-name behaviour is covered separately
  // from InvocationOtelPlugin rather than assumed to be shared.
  describe("Handler-provided names on unnamed child operations", () => {
    it("child operation carries durable.operation.name provided by the handler", async () => {
      const plugin = new ExecutionOtelPlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      // Parent CONTEXT operation (the waitForCallback child context) is named.
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "ctx-1",
          type: "CONTEXT",
          subType: "WaitForCallback",
          name: "otel-callback",
        }),
      );
      // Child CALLBACK operation: the plugin doesn't derive this name — the
      // handler passes the derived name ("otel-callback-callback") to the inner
      // createCallback via config, so the plugin receives it directly here.
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "cb-1",
          type: "CALLBACK",
          subType: "Callback",
          parentId: "ctx-1",
          name: "otel-callback-callback",
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "cb-1",
          type: "CALLBACK",
          parentId: "ctx-1",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "ctx-1",
          type: "CONTEXT",
          name: "otel-callback",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const cbSpan = getExportedSpans(exporter).find(
        (s) => s.attributes["durable.operation.id"] === "cb-1",
      );
      expect(cbSpan).toBeDefined();
      expect(cbSpan!.attributes["durable.operation.name"]).toBe(
        "otel-callback-callback",
      );
    });

    it("child operation has no name when none is provided", async () => {
      const plugin = new ExecutionOtelPlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({ id: "ctx-2", type: "CONTEXT" }),
      );
      await plugin.onOperationStart(
        makeOperationInfo({ id: "step-2", type: "STEP", parentId: "ctx-2" }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "step-2",
          type: "STEP",
          parentId: "ctx-2",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "ctx-2",
          type: "CONTEXT",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const stepSpan = getExportedSpans(exporter).find(
        (s) => s.attributes["durable.operation.id"] === "step-2",
      );
      expect(stepSpan).toBeDefined();
      expect(stepSpan!.attributes["durable.operation.name"]).toBeUndefined();
    });

    it("attempt span carries durable.operation.name passed by the handler", async () => {
      const plugin = new ExecutionOtelPlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "ctx-3",
          type: "CONTEXT",
          subType: "WaitForCallback",
          name: "my-callback",
        }),
      );
      // Unnamed submitter STEP inside the child context.
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "step-3",
          type: "STEP",
          subType: "Step",
          parentId: "ctx-3",
          name: "my-callback-submitter",
        }),
      );
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({
          id: "step-3",
          type: "STEP",
          attempt: 1,
          name: "my-callback-submitter",
        }),
      );
      await plugin.onOperationAttemptEnd(
        makeAttemptEndInfo({ id: "step-3", type: "STEP", attempt: 1 }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "step-3",
          type: "STEP",
          parentId: "ctx-3",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "ctx-3",
          type: "CONTEXT",
          name: "my-callback",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const attemptSpan = findSpan(exporter, "my-callback-submitter attempt 1");
      expect(attemptSpan).toBeDefined();
      expect(attemptSpan!.attributes["durable.operation.name"]).toBe(
        "my-callback-submitter",
      );
      // The attempt still parents to its own operation span, not the context.
      // Look the operation span up by name: the attempt span carries the same
      // durable.operation.id and is exported first. The operation span's name
      // reflects the handler-provided name ("my-callback-submitter"), not the
      // bare operation type.
      const stepSpan = findSpan(exporter, "my-callback-submitter");
      expect(stepSpan).toBeDefined();
      expect(attemptSpan!.parentSpanContext?.spanId).toBe(
        stepSpan!.spanContext().spanId,
      );
    });

    it("cross-invocation child span carries the handler-provided name and parents to the parent span", async () => {
      const plugin = new ExecutionOtelPlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      // CONTEXT is replayed in this invocation, so it populates spanMap.
      await plugin.onOperationStart(
        makeOperationInfo({
          id: "ctx-4",
          type: "CONTEXT",
          subType: "WaitForCallback",
          name: "otel-callback",
          isReplay: true,
        }),
      );
      // The CALLBACK completed between invocations: no onOperationStart in this
      // invocation, so onOperationEnd takes the cross-invocation span path.
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "cb-4",
          type: "CALLBACK",
          subType: "Callback",
          parentId: "ctx-4",
          name: "otel-callback-callback",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onOperationEnd(
        makeOperationEndInfo({
          id: "ctx-4",
          type: "CONTEXT",
          name: "otel-callback",
          status: "SUCCEEDED" as any,
        }),
      );
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const ctxSpan = getExportedSpans(exporter).find(
        (s) => s.attributes["durable.operation.id"] === "ctx-4",
      );
      const cbSpan = getExportedSpans(exporter).find(
        (s) => s.attributes["durable.operation.id"] === "cb-4",
      );
      expect(ctxSpan).toBeDefined();
      expect(cbSpan).toBeDefined();
      expect(cbSpan!.attributes["durable.operation.name"]).toBe(
        "otel-callback-callback",
      );
      expect(cbSpan!.parentSpanContext?.spanId).toBe(
        ctxSpan!.spanContext().spanId,
      );
    });
  });

  // Guards the waitForCondition parity fix: a check that returns
  // normally but keeps polling ends the attempt with outcome SUCCEEDED, so the
  // attempt span must carry an explicit OK status. OTel conformance test 9
  // asserts `status: OK` on the first, non-terminal polling attempt.
  it("a SUCCEEDED attempt end stamps explicit OK and records no exception", async () => {
    const plugin = new ExecutionOtelPlugin();

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({
        id: "cond-1",
        type: "STEP",
        subType: "WaitForCondition",
        name: "otel-condition",
      }),
    );
    await plugin.onOperationAttemptStart(
      makeAttemptInfo({
        id: "cond-1",
        type: "STEP",
        subType: "WaitForCondition",
        name: "otel-condition",
        attempt: 1,
      }),
    );
    // Condition not yet met: the check ran successfully and polling continues.
    await plugin.onOperationAttemptEnd(
      makeAttemptEndInfo({
        id: "cond-1",
        type: "STEP",
        subType: "WaitForCondition",
        name: "otel-condition",
        attempt: 1,
        outcome: "SUCCEEDED" as any,
        // No error: continuing to poll is not an attempt failure.
      }),
    );
    await plugin.onInvocationEnd(makeInvocationEndInfo());

    const attemptSpan = findSpan(exporter, "otel-condition attempt 1");
    expect(attemptSpan).toBeDefined();
    expect(attemptSpan!.attributes["durable.attempt.outcome"]).toBe(
      "SUCCEEDED",
    );
    expect(attemptSpan!.status.code).toBe(SpanStatusCode.OK);
    expect(attemptSpan!.events).toHaveLength(0);
  });
});
