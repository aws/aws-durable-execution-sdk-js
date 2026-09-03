import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
  AlwaysOffSampler,
  AlwaysOnSampler,
} from "@opentelemetry/sdk-trace-node";
import { context, trace, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import type {
  InvocationInfo,
  InvocationEndInfo,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import { deriveSpanIdFromOperationId } from "../deterministic-id-generator";
import type { OtelPluginConfig } from "../otel-plugin-config";
import { w3cClientContextExtractor } from "../context-extractors";

const TEST_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:exec-123";
const TEST_START = new Date("2026-08-15T00:00:00Z");

function makeInvocationInfo(
  overrides?: Partial<InvocationInfo>,
): InvocationInfo {
  return {
    requestId: "req-1",
    executionArn: TEST_ARN,
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
    executionStartTimestamp: TEST_START,
    ...overrides,
  };
}

function makeInvocationEndInfo(
  overrides?: Partial<InvocationEndInfo>,
): InvocationEndInfo {
  return {
    requestId: "req-1",
    executionArn: TEST_ARN,
    executionInput: {},
    operations: {},
    status: "SUCCEEDED" as any,
    executionResult: undefined,
    executionError: undefined,
    executionStartTimestamp: TEST_START,
    ...overrides,
  };
}

describe("Execution trace joining", () => {
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

  function spanByName(name: string): ReadableSpan | undefined {
    return exporter.getFinishedSpans().find((s) => s.name === name);
  }

  describe.each([
    [
      "ExecutionOtelPlugin",
      (c?: OtelPluginConfig) => new ExecutionOtelPlugin(c),
    ],
    [
      "InvocationOtelPlugin",
      (c?: OtelPluginConfig) => new InvocationOtelPlugin(c),
    ],
  ] as const)("%s", (_name, makePlugin) => {
    it("joins the propagated Root trace but anchors on a synthetic root when only a Root (no usable Parent) is propagated", async () => {
      // The auto-instrumentation layer creates the ambient handler span before
      // the plugin runs, on the SAME trace the durable backend propagated. The
      // extractor reports that trace (Root, no usable Parent). Because there is
      // no complete remote parent, the execution does NOT adopt the ambient span
      // as its ancestor; it anchors on the deterministic synthetic root. It does
      // still join the propagated Root trace, since that trace ID is canonical.
      const ambient = provider.getTracer("adot").startSpan("LambdaHandler");
      const ambientCtx = ambient.spanContext();
      const plugin = makePlugin({
        // Root matches the ambient trace; no Parent → synthetic-root path.
        contextExtractor: () => ({
          traceId: ambientCtx.traceId,
        }),
      });

      await context.with(trace.setSpan(ROOT_CONTEXT, ambient), async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(makeInvocationEndInfo());
      });
      ambient.end();

      const workflow = spanByName("Workflow")!;
      const invocation = spanByName("Invocation")!;
      // The whole execution joins the propagated Root trace.
      expect(workflow.spanContext().traceId).toBe(ambientCtx.traceId);
      expect(invocation.spanContext().traceId).toBe(ambientCtx.traceId);
      // The Workflow span is the execution ancestor: because there is no
      // complete remote parent it anchors on the deterministic synthetic root,
      // NOT the ambient span.
      expect(workflow.parentSpanContext?.spanId).not.toBe(ambientCtx.spanId);
      // The Invocation span, however, still parents onto the active ambient
      // span because that span is already on the (canonical) execution trace —
      // this keeps the per-invocation span nested under the layer's handler
      // span without changing the execution ancestor.
      expect(invocation.parentSpanContext?.spanId).toBe(ambientCtx.spanId);
    });

    it("does NOT parent Invocation onto a same-trace ambient span whose sampled bit differs from the execution ancestor", async () => {
      // Build an UNSAMPLED ambient span (AlwaysOff), then propagate an explicit
      // Sampled=1 on the SAME trace so the execution ancestor IS sampled. The
      // ambient span shares the canonical trace but its sampled bit differs.
      // Adopting it would make the (sampled, exported) Invocation span parent
      // onto a dropped ambient span; the plugin must instead fall back to the
      // execution ancestor, which carries the authoritative sampled decision.
      const unsampledProvider = new NodeTracerProvider({
        sampler: new AlwaysOffSampler(),
      });
      const ambient = unsampledProvider
        .getTracer("adot")
        .startSpan("LambdaHandler");
      const ambientCtx = ambient.spanContext();
      // Sanity: the ambient span is NOT sampled.
      expect(ambientCtx.traceFlags & 1).toBe(0);

      const plugin = makePlugin({
        // Same trace as the ambient span, but an explicit Sampled=1 decision.
        contextExtractor: () => ({
          traceId: ambientCtx.traceId,
          sampling: "SAMPLED" as const,
        }),
      });

      await context.with(trace.setSpan(ROOT_CONTEXT, ambient), async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(makeInvocationEndInfo());
      });
      ambient.end();
      await unsampledProvider.shutdown();

      const invocation = spanByName("Invocation")!;
      expect(invocation).toBeDefined();
      // The execution joins the ambient span's trace...
      expect(invocation.spanContext().traceId).toBe(ambientCtx.traceId);
      // ...but the sampled bits differ, so the ambient span is rejected as the
      // parent; the Invocation span parents onto the execution ancestor.
      expect(invocation.parentSpanContext?.spanId).not.toBe(ambientCtx.spanId);
    });

    it("ignores an uncorroborated ambient span (no propagation) and anchors on the stable synthetic root", async () => {
      // Reviewer case: with NO propagated context, a fresh ambient trace must
      // NOT anchor the execution (it is not stable across reinvocations). The
      // execution anchors on the deterministic ARN-derived synthetic root.
      const plugin = makePlugin({ contextExtractor: () => undefined });
      const ambient = provider.getTracer("adot").startSpan("LambdaHandler");
      const ambientCtx = ambient.spanContext();

      await context.with(trace.setSpan(ROOT_CONTEXT, ambient), async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(makeInvocationEndInfo());
      });
      ambient.end();

      const workflow = spanByName("Workflow")!;
      const invocation = spanByName("Invocation")!;
      // The execution does NOT join the uncorroborated ambient trace.
      expect(workflow.spanContext().traceId).not.toBe(ambientCtx.traceId);
      expect(workflow.parentSpanContext?.spanId).not.toBe(ambientCtx.spanId);
      // Workflow and Invocation share the deterministic execution trace and its
      // synthetic root.
      expect(workflow.spanContext().traceId).toBe(
        invocation.spanContext().traceId,
      );
      expect(workflow.parentSpanContext?.spanId).toBe(
        invocation.parentSpanContext?.spanId,
      );
    });

    it("rejects an ambient span from another trace and uses a synthetic root", async () => {
      // A remote parent is propagated on trace A while an ambient span from an
      // unrelated trace B is active. The plugin must not adopt trace B; it uses
      // the propagated remote parent on trace A.
      const remoteTraceId = "a".repeat(32);
      const remoteParentId = "b".repeat(16);
      const plugin = makePlugin({
        contextExtractor: () => ({
          traceId: remoteTraceId,
          parentSpanId: remoteParentId,
          sampling: "SAMPLED",
        }),
      });
      // Ambient span from a DIFFERENT trace.
      const unrelated = provider.getTracer("other").startSpan("Unrelated");
      const unrelatedCtx = unrelated.spanContext();
      expect(unrelatedCtx.traceId).not.toBe(remoteTraceId);

      await context.with(trace.setSpan(ROOT_CONTEXT, unrelated), async () => {
        await plugin.onInvocationStart(makeInvocationInfo());
        await plugin.onInvocationEnd(makeInvocationEndInfo());
      });
      unrelated.end();

      const workflow = spanByName("Workflow")!;
      const invocation = spanByName("Invocation")!;
      // Everything joins the propagated remote trace, not the unrelated ambient.
      expect(workflow.spanContext().traceId).toBe(remoteTraceId);
      expect(invocation.spanContext().traceId).toBe(remoteTraceId);
      expect(workflow.spanContext().traceId).not.toBe(unrelatedCtx.traceId);
      // Workflow parents onto the remote parent.
      expect(workflow.parentSpanContext?.spanId).toBe(remoteParentId);
      // Invocation does not adopt the unrelated ambient span.
      expect(invocation.parentSpanContext?.spanId).not.toBe(
        unrelatedCtx.spanId,
      );
    });

    it("propagates an explicit Sampled=0 decision onto the execution trace", async () => {
      // With Sampled=0 propagated and a parent-based sampler, the execution
      // trace is dropped (not exported), confirming the decision is honored
      // rather than hard-coded to sampled.
      const dropExporter = new InMemorySpanExporter();
      const dropProvider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(dropExporter)],
      });
      const plugin = makePlugin({
        tracerProviderFactory: (createIdGenerator) => {
          const p = new NodeTracerProvider({
            spanProcessors: [new SimpleSpanProcessor(dropExporter)],
            idGenerator: createIdGenerator(),
          });
          return p;
        },
        contextExtractor: () => ({
          traceId: "c".repeat(32),
          parentSpanId: "d".repeat(16),
          sampling: "NOT_SAMPLED",
        }),
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(makeInvocationEndInfo());
      await dropProvider.shutdown();

      // A NodeTracerProvider defaults to a parent-based AlwaysOn sampler, so an
      // explicitly not-sampled remote parent drops the whole execution trace.
      expect(dropExporter.getFinishedSpans()).toHaveLength(0);
    });

    it("enforces explicit Sampled=1 even when a direct AlwaysOff sampler is configured", async () => {
      const forcedExporter = new InMemorySpanExporter();
      let forcedProvider: NodeTracerProvider | undefined;
      const plugin = makePlugin({
        tracerProviderFactory: (createIdGenerator) => {
          forcedProvider = new NodeTracerProvider({
            sampler: new AlwaysOffSampler(),
            spanProcessors: [new SimpleSpanProcessor(forcedExporter)],
            idGenerator: createIdGenerator(),
          });
          return forcedProvider;
        },
        contextExtractor: () => ({
          traceId: "e".repeat(32),
          parentSpanId: "f".repeat(16),
          sampling: "SAMPLED",
        }),
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      expect(forcedExporter.getFinishedSpans().length).toBeGreaterThan(0);
      await forcedProvider?.shutdown();
    });

    it("enforces explicit Sampled=0 even when a direct AlwaysOn sampler is configured", async () => {
      const forcedExporter = new InMemorySpanExporter();
      let forcedProvider: NodeTracerProvider | undefined;
      const plugin = makePlugin({
        tracerProviderFactory: (createIdGenerator) => {
          forcedProvider = new NodeTracerProvider({
            sampler: new AlwaysOnSampler(),
            spanProcessors: [new SimpleSpanProcessor(forcedExporter)],
            idGenerator: createIdGenerator(),
          });
          return forcedProvider;
        },
        contextExtractor: () => ({
          traceId: "1".repeat(32),
          parentSpanId: "2".repeat(16),
          sampling: "NOT_SAMPLED",
        }),
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      expect(forcedExporter.getFinishedSpans()).toHaveLength(0);
      await forcedProvider?.shutdown();
    });

    it("preserves normal tracing when an opaque forwarding tracer hides the sampler", async () => {
      const opaqueExporter = new InMemorySpanExporter();
      let opaqueProvider: NodeTracerProvider | undefined;
      const plugin = makePlugin({
        tracerProviderFactory: (createIdGenerator) => {
          opaqueProvider = new NodeTracerProvider({
            sampler: new AlwaysOnSampler(),
            spanProcessors: [new SimpleSpanProcessor(opaqueExporter)],
            idGenerator: createIdGenerator(),
          });
          return {
            getTracer: (
              ...args: Parameters<NodeTracerProvider["getTracer"]>
            ) => {
              const realTracer = opaqueProvider!.getTracer(...args);
              return {
                startSpan: realTracer.startSpan.bind(realTracer),
                startActiveSpan: realTracer.startActiveSpan.bind(realTracer),
              };
            },
            forceFlush: () => opaqueProvider!.forceFlush(),
          };
        },
        contextExtractor: () => ({
          traceId: "3".repeat(32),
          parentSpanId: "4".repeat(16),
          sampling: "NOT_SAMPLED",
        }),
      });

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      expect(opaqueExporter.getFinishedSpans().length).toBeGreaterThan(0);

      await opaqueProvider?.shutdown();
    });

    it("uses w3cClientContextExtractor as an execution-stable remote parent", async () => {
      const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const parentSpanId = "00f067aa0ba902b7";
      const plugin = makePlugin({
        contextExtractor: w3cClientContextExtractor,
      });
      const invocationInfo = makeInvocationInfo({
        context: {
          clientContext: {
            custom: {
              traceparent: `00-${traceId}-${parentSpanId}-01`,
            },
          },
        },
      } as any);

      await plugin.onInvocationStart(invocationInfo);
      await plugin.onInvocationEnd(makeInvocationEndInfo());

      const workflow = spanByName("Workflow")!;
      const invocation = spanByName("Invocation")!;
      expect(workflow).toBeDefined();
      expect(invocation).toBeDefined();
      expect(workflow.spanContext().traceId).toBe(traceId);
      expect(invocation.spanContext().traceId).toBe(traceId);
      expect(workflow.parentSpanContext?.spanId).toBe(parentSpanId);
    });
  });
});

describe("Cross-invocation operation link stitching", () => {
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

  it("stitches a wait continuation back to its initial operation span across invocations (InvocationOtelPlugin)", async () => {
    const plugin = new InvocationOtelPlugin({
      contextExtractor: () => undefined,
    });

    // Invocation 1: the wait operation starts (initial logical span) and the
    // invocation suspends (PENDING) — the initial operation span is ended so it
    // exports.
    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart({
      id: "op-wait",
      type: "WAIT",
      name: "pause",
      isReplay: false,
    });
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "PENDING" as any }),
    );

    const initialWaitSpan = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pause");
    expect(initialWaitSpan).toBeDefined();
    const executionTraceId = initialWaitSpan!.spanContext().traceId;
    // Its span ID is the deterministic operation span ID on the execution trace.
    expect(initialWaitSpan!.spanContext().spanId).toBe(
      deriveSpanIdFromOperationId("op-wait", TEST_ARN),
    );

    exporter.reset();

    // Invocation 2: the wait completes; a continuation span is emitted that
    // links back to the initial operation span on the same execution trace.
    await plugin.onInvocationStart(
      makeInvocationInfo({ isFirstInvocation: false }),
    );
    await plugin.onOperationEnd({
      id: "op-wait",
      type: "WAIT",
      name: "pause",
      isReplay: false,
      status: "SUCCEEDED" as any,
    });
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const continuation = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pause");
    const workflow = exporter
      .getFinishedSpans()
      .find((s) => s.name === "Workflow");
    expect(continuation).toBeDefined();
    expect(workflow).toBeDefined();
    // Same execution trace across both invocations.
    expect(continuation!.spanContext().traceId).toBe(executionTraceId);
    // Links are ordered [initial operation span, Workflow span]: links[0] is the
    // deterministic operation span on the execution trace, links[1] the Workflow.
    expect(continuation!.links).toHaveLength(2);
    expect(continuation!.links[0].context.spanId).toBe(
      deriveSpanIdFromOperationId("op-wait", TEST_ARN),
    );
    expect(continuation!.links[0].context.traceId).toBe(executionTraceId);
    expect(continuation!.links[1].context.spanId).toBe(
      workflow!.spanContext().spanId,
    );
  });

  it("keeps continuation links on the extracted trace when a stable custom extractor is used across invocations", async () => {
    // A valid extracted trace ID is adopted as the canonical execution trace.
    // A well-behaved extractor returns the same execution context on every
    // invocation, so the continuation segment stays on that adopted trace and
    // its initial-operation link is anchored on it.
    const extractedTraceId = "5".repeat(32);
    const plugin = new InvocationOtelPlugin({
      contextExtractor: () => ({
        traceId: extractedTraceId,
        parentSpanId: "6".repeat(16),
        sampling: "SAMPLED" as const,
      }),
    });

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart({
      id: "op-stable-extractor",
      type: "WAIT",
      name: "pause-stable-extractor",
      isReplay: false,
    });
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "PENDING" as any }),
    );

    const initialWaitSpan = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pause-stable-extractor");
    expect(initialWaitSpan).toBeDefined();
    const executionTraceId = initialWaitSpan!.spanContext().traceId;
    // The valid extracted trace ID is adopted as the execution trace.
    expect(executionTraceId).toBe(extractedTraceId);

    exporter.reset();

    await plugin.onInvocationStart(
      makeInvocationInfo({ isFirstInvocation: false }),
    );
    await plugin.onOperationEnd({
      id: "op-stable-extractor",
      type: "WAIT",
      name: "pause-stable-extractor",
      isReplay: false,
      status: "SUCCEEDED" as any,
    });
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const continuation = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pause-stable-extractor");
    expect(continuation).toBeDefined();
    expect(continuation!.spanContext().traceId).toBe(executionTraceId);
    expect(continuation!.links[0].context.traceId).toBe(executionTraceId);
    expect(continuation!.links[0].context.spanId).toBe(
      deriveSpanIdFromOperationId("op-stable-extractor", TEST_ARN),
    );
  });
});
