import { context, propagation, trace, ROOT_CONTEXT } from "@opentelemetry/api";
import { TraceFlags } from "@opentelemetry/api";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  InMemorySpanExporter,
  NodeTracerProvider,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import type { IdGenerator, Sampler } from "@opentelemetry/sdk-trace-node";
import { DeterministicIdGenerator } from "../deterministic-id-generator";
import {
  createTracerProvider,
  resolveWorkflowRoot,
} from "../otel-plugin-provider";

beforeEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

afterEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

describe("createTracerProvider", () => {
  it.each([undefined, {}])(
    "uses the global provider when no factory is configured",
    (config) => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider(
        config,
        new DeterministicIdGenerator(),
      );

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.usesGlobalProvider).toBe(true);

      void globalProvider.shutdown();
    },
  );

  it("passes a deterministic ID generator factory to the provider factory", () => {
    const idGenerator = new DeterministicIdGenerator();
    const tracerProviderFactory = jest.fn(
      (createIdGenerator) =>
        new NodeTracerProvider({ idGenerator: createIdGenerator() }),
    );

    const result = createTracerProvider({ tracerProviderFactory }, idGenerator);

    expect(tracerProviderFactory).toHaveBeenCalledTimes(1);
    const createIdGenerator = tracerProviderFactory.mock.calls[0][0];
    expect(createIdGenerator()).toBe(idGenerator);
    expect(result.usesGlobalProvider).toBe(false);

    void (result.tracerProvider as NodeTracerProvider).shutdown();
  });

  it("chains deterministic IDs to an application fallback generator", () => {
    const fallbackTraceId = "f".repeat(32);
    const fallbackSpanId = "e".repeat(16);
    const fallbackIdGenerator = {
      generateTraceId: jest.fn(() => fallbackTraceId),
      generateSpanId: jest.fn(() => fallbackSpanId),
    };
    const pluginIdGenerator = new DeterministicIdGenerator();
    let providerIdGenerator: IdGenerator | undefined;
    const tracerProviderFactory = jest.fn((createIdGenerator) => {
      providerIdGenerator = createIdGenerator(fallbackIdGenerator);
      return new NodeTracerProvider({ idGenerator: providerIdGenerator });
    });

    const result = createTracerProvider(
      { tracerProviderFactory },
      pluginIdGenerator,
    );

    expect(providerIdGenerator?.generateTraceId()).toBe(fallbackTraceId);
    expect(providerIdGenerator?.generateSpanId()).toBe(fallbackSpanId);
    pluginIdGenerator.withIds(
      { traceId: "a".repeat(32), spanId: "1".repeat(16) },
      () => {
        expect(providerIdGenerator?.generateTraceId()).toBe("a".repeat(32));
        expect(providerIdGenerator?.generateSpanId()).toBe("1".repeat(16));
      },
    );

    expect(fallbackIdGenerator.generateTraceId).toHaveBeenCalledTimes(1);
    expect(fallbackIdGenerator.generateSpanId).toHaveBeenCalledTimes(1);
    void (result.tracerProvider as NodeTracerProvider).shutdown();
  });

  it("treats a factory result as explicit even when it is globally registered", () => {
    const provider = new NodeTracerProvider();
    provider.register();

    const result = createTracerProvider(
      { tracerProviderFactory: () => provider },
      new DeterministicIdGenerator(),
    );

    expect(result.tracerProvider).toBe(provider);
    expect(result.usesGlobalProvider).toBe(false);

    void provider.shutdown();
  });
});

describe("ExecutionOtelPlugin provider resolution", () => {
  it("uses the global provider by default", async () => {
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    const { ExecutionOtelPlugin } = await import("../execution-plugin");
    const plugin = new ExecutionOtelPlugin();

    await plugin.onInvocationStart({
      requestId: "req-1",
      executionArn: "arn:aws:states:us-east-1:123456789012:execution:sm:exec-1",
      isFirstInvocation: true,
      executionInput: {},
      operations: {},
      updatedOperations: {},
    });
    await plugin.onInvocationEnd({
      requestId: "req-1",
      executionArn: "arn:aws:states:us-east-1:123456789012:execution:sm:exec-1",
      executionInput: {},
      operations: {},
      status: "SUCCEEDED",
    });

    expect(
      exporter.getFinishedSpans().some((span) => span.name === "Workflow"),
    ).toBe(true);

    await globalProvider.shutdown();
  });

  it("creates a global-provider Invocation span with the execution ARN", async () => {
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    const { ExecutionOtelPlugin } = await import("../execution-plugin");
    const plugin = new ExecutionOtelPlugin();
    const executionArn =
      "arn:aws:states:us-east-1:123456789012:execution:sm:exec-2";

    await plugin.onInvocationStart({
      requestId: "req-2",
      executionArn,
      isFirstInvocation: true,
      executionInput: {},
      operations: {},
      updatedOperations: {},
    });
    await plugin.onInvocationEnd({
      requestId: "req-2",
      executionArn,
      executionInput: {},
      operations: {},
      status: "SUCCEEDED",
    });

    const invocationSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === "Invocation");
    expect(invocationSpan?.attributes["durable.execution.arn"]).toBe(
      executionArn,
    );

    await globalProvider.shutdown();
  });
});

describe("resolveWorkflowRoot", () => {
  const TRACE_ID = "9c1c1a2b3d4e5f60718293a4b5c6d7e8";
  const SPAN_ID = "b1b2b3b4b5b6b7b8";
  const ARN = "arn:aws:states:us-east-1:123456789012:execution:sm:exec-1";

  function tracerFor(sampler: Sampler) {
    const provider = new NodeTracerProvider({
      sampler,
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    });
    return { provider, tracer: provider.getTracer("t") };
  }

  it.each([
    ["AlwaysOn", () => new AlwaysOnSampler(), TraceFlags.SAMPLED],
    ["AlwaysOff", () => new AlwaysOffSampler(), TraceFlags.NONE],
    ["ratio 1.0", () => new TraceIdRatioBasedSampler(1), TraceFlags.SAMPLED],
    ["ratio 0.0", () => new TraceIdRatioBasedSampler(0), TraceFlags.NONE],
    [
      "ParentBased(AlwaysOff) — parentless root",
      () => new ParentBasedSampler({ root: new AlwaysOffSampler() }),
      TraceFlags.NONE,
    ],
  ])("carries the sampler's root decision for %s", (_n, make, expected) => {
    const { provider, tracer } = tracerFor(make());
    const root = resolveWorkflowRoot(
      tracer,
      TRACE_ID,
      SPAN_ID,
      "Workflow",
      ARN,
    );
    expect(root.span.spanContext().traceFlags).toBe(expected);
    expect(root.sampled).toBe(expected === TraceFlags.SAMPLED);
    expect(root.attributes).toEqual({ "durable.execution.arn": ARN });
    void provider.shutdown();
  });

  // The whole point: reproduce what a real root startSpan would have decided.
  // If the SDK ever renames the internal `_sampler`, the fallback engages and
  // this equivalence breaks — which is exactly what we want to be told about.
  it.each([
    ["AlwaysOn", () => new AlwaysOnSampler()],
    ["AlwaysOff", () => new AlwaysOffSampler()],
    ["ratio 0.01", () => new TraceIdRatioBasedSampler(0.01)],
    [
      "ParentBased(ratio 0.5)",
      () => new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.5) }),
    ],
  ])("matches the flags a real root span gets from %s", (_n, make) => {
    for (const traceId of [
      TRACE_ID,
      "1111111111111111aaaaaaaaaaaaaaaa",
      "ffffffffffffffff0000000000000000",
    ]) {
      const { provider, tracer } = tracerFor(make());
      (tracer as unknown as { _idGenerator: unknown })._idGenerator = {
        generateTraceId: () => traceId,
        generateSpanId: () => SPAN_ID,
      };
      const real = tracer.startSpan("Workflow", {}, ROOT_CONTEXT);
      const automatic = real.spanContext().traceFlags;
      real.end();

      const root = resolveWorkflowRoot(
        tracer,
        traceId,
        SPAN_ID,
        "Workflow",
        ARN,
      );
      expect(root.span.spanContext().traceFlags).toBe(automatic);
      void provider.shutdown();
    }
  });

  it("falls back to sampled when the tracer exposes no sampler", () => {
    const noopTracer = trace.getTracer("noop"); // no-op API tracer
    const root = resolveWorkflowRoot(
      noopTracer,
      TRACE_ID,
      SPAN_ID,
      "Workflow",
      ARN,
    );
    expect(root.span.spanContext().traceFlags).toBe(TraceFlags.SAMPLED);
    expect(root.sampled).toBe(true);
  });
});
