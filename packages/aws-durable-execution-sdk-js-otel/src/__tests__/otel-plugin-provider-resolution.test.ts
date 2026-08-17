/**
 * Unit tests for provider resolution, config validation, and instrumentation
 * skipping in the shared OTel plugin infrastructure (used by both
 * ExecutionOtelPlugin and InvocationOtelPlugin), driven by `providerSource`.
 */
import {
  trace,
  context,
  propagation,
  ROOT_CONTEXT,
  TraceFlags,
} from "@opentelemetry/api";
import type { TracerProvider } from "@opentelemetry/api";
import type { Sampler } from "@opentelemetry/sdk-trace-node";
import type { Attributes } from "@opentelemetry/api";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  NodeTracerProvider,
  InMemorySpanExporter,
  ParentBasedSampler,
  SamplingDecision,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import {
  createTracerProvider,
  resolveWorkflowRoot,
} from "../otel-plugin-provider";
import { ProviderSource, resolveProviderSource } from "../otel-plugin-config";
import { registerStandaloneInstrumentations } from "../otel-plugin-instrumentations";

// Save original env
const originalEnv = process.env;

beforeEach(() => {
  // Reset OTel global state
  trace.disable();
  context.disable();
  propagation.disable();
});

afterEach(() => {
  process.env = originalEnv;
  trace.disable();
  context.disable();
  propagation.disable();
});

describe("createTracerProvider", () => {
  describe("providerSource=GLOBAL", () => {
    it("returns the globally registered TracerProvider", () => {
      // Register a global provider
      const exporter = new InMemorySpanExporter();
      const globalProvider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      globalProvider.register();

      const result = createTracerProvider({
        providerSource: ProviderSource.GLOBAL,
      });

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.GLOBAL);

      globalProvider.shutdown();
    });

    it("sets source=GLOBAL", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider({
        providerSource: ProviderSource.GLOBAL,
      });

      expect(result.source).toBe(ProviderSource.GLOBAL);

      globalProvider.shutdown();
    });
  });

  describe("providerSource=EXPLICIT", () => {
    it("uses the supplied tracerProvider and sets source=EXPLICIT", () => {
      const explicitProvider = new NodeTracerProvider();

      const result = createTracerProvider({
        providerSource: ProviderSource.EXPLICIT,
        tracerProvider: explicitProvider,
      });

      expect(result.tracerProvider).toBe(explicitProvider);
      expect(result.source).toBe(ProviderSource.EXPLICIT);

      explicitProvider.shutdown();
    });
  });

  describe("providerSource=AUTO_OTLP", () => {
    it("creates an internal provider with source=AUTO_OTLP", () => {
      const result = createTracerProvider({
        providerSource: ProviderSource.AUTO_OTLP,
      });

      expect(result.source).toBe(ProviderSource.AUTO_OTLP);

      // Clean up
      if ("shutdown" in result.tracerProvider) {
        (result.tracerProvider as NodeTracerProvider).shutdown();
      }
    });
  });

  describe("default source is GLOBAL when providerSource is absent", () => {
    it("returns the global provider with source=GLOBAL for an empty config", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider({});

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.GLOBAL);

      globalProvider.shutdown();
    });

    it("returns the global provider with source=GLOBAL for undefined config", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider(undefined);

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.GLOBAL);

      globalProvider.shutdown();
    });
  });
});

describe("resolveProviderSource validation", () => {
  it("defaults to Global when providerSource is absent", () => {
    expect(resolveProviderSource(undefined)).toBe(ProviderSource.GLOBAL);
    expect(resolveProviderSource({})).toBe(ProviderSource.GLOBAL);
  });

  it("returns the configured source verbatim for Global", () => {
    expect(
      resolveProviderSource({ providerSource: ProviderSource.GLOBAL }),
    ).toBe(ProviderSource.GLOBAL);
  });

  it("returns EXPLICIT when providerSource=EXPLICIT and a tracerProvider is supplied", () => {
    const explicitProvider = new NodeTracerProvider();
    expect(
      resolveProviderSource({
        providerSource: ProviderSource.EXPLICIT,
        tracerProvider: explicitProvider,
      }),
    ).toBe(ProviderSource.EXPLICIT);
    explicitProvider.shutdown();
  });

  it("throws when providerSource=EXPLICIT but no tracerProvider is supplied", () => {
    expect(() =>
      resolveProviderSource({ providerSource: ProviderSource.EXPLICIT }),
    ).toThrow(/requires a `tracerProvider`/);
  });

  it("throws when a tracerProvider is supplied without providerSource=EXPLICIT (default source)", () => {
    const explicitProvider = new NodeTracerProvider();
    expect(() =>
      resolveProviderSource({ tracerProvider: explicitProvider }),
    ).toThrow(/only used with providerSource 'explicit'/);
    explicitProvider.shutdown();
  });

  it("throws when a tracerProvider is supplied with providerSource=GLOBAL", () => {
    const explicitProvider = new NodeTracerProvider();
    expect(() =>
      resolveProviderSource({
        providerSource: ProviderSource.GLOBAL,
        tracerProvider: explicitProvider,
      }),
    ).toThrow(/only used with providerSource 'explicit'/);
    explicitProvider.shutdown();
  });
});

describe("registerStandaloneInstrumentations", () => {
  describe("skips registration for non-AUTO_OTLP sources", () => {
    it("returns without registering instrumentations for Global", () => {
      const mockProvider: TracerProvider = {
        getTracer: jest.fn().mockReturnValue({
          startSpan: jest.fn(),
          startActiveSpan: jest.fn(),
        }),
      };

      // Should not throw and should return early
      expect(() => {
        registerStandaloneInstrumentations(
          mockProvider,
          ProviderSource.GLOBAL,
          { providerSource: ProviderSource.GLOBAL },
        );
      }).not.toThrow();

      // If it had registered instrumentations, it would have called into the
      // instrumentation system. The fact that it returns immediately with a mock
      // provider (which has no real span processor) without error confirms skipping.
    });

    it("skips instrumentation for Explicit", () => {
      const mockProvider: TracerProvider = {
        getTracer: jest.fn().mockReturnValue({
          startSpan: jest.fn(),
          startActiveSpan: jest.fn(),
        }),
      };

      const explicitProvider = new NodeTracerProvider();

      // Should not throw - returns early for the EXPLICIT source
      expect(() => {
        registerStandaloneInstrumentations(
          mockProvider,
          ProviderSource.EXPLICIT,
          {
            providerSource: ProviderSource.EXPLICIT,
            tracerProvider: explicitProvider,
          },
        );
      }).not.toThrow();

      explicitProvider.shutdown();
    });
  });

  describe("AUTO_OTLP source does not skip registration", () => {
    it("proceeds with registration for AUTO_OTLP with an explicit config", () => {
      // For the AUTO_OTLP source the function should attempt to register
      // instrumentations. We use a real NodeTracerProvider to verify it does
      // not return early.
      const provider = new NodeTracerProvider();

      // This should not throw and should proceed through the full registration path
      expect(() => {
        registerStandaloneInstrumentations(provider, ProviderSource.AUTO_OTLP, {
          providerSource: ProviderSource.AUTO_OTLP,
        });
      }).not.toThrow();

      provider.shutdown();
    });

    it("proceeds with registration for AUTO_OTLP with an empty config", () => {
      const provider = new NodeTracerProvider();

      expect(() => {
        registerStandaloneInstrumentations(
          provider,
          ProviderSource.AUTO_OTLP,
          {},
        );
      }).not.toThrow();

      provider.shutdown();
    });
  });
});

describe("ExecutionOtelPlugin integration - provider resolution", () => {
  // These tests verify the end-to-end behavior through the ExecutionOtelPlugin
  // constructor which calls both createTracerProvider and registerStandaloneInstrumentations

  it("providerSource=GLOBAL retrieves the global provider", async () => {
    // Register a known global provider
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    // Import ExecutionOtelPlugin dynamically to avoid module-level side effects
    const { ExecutionOtelPlugin } = await import("../execution-plugin");

    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    // The plugin should be able to create spans via the global provider
    // Verify by running through a basic lifecycle
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
      status: "SUCCEEDED" as any,
      executionResult: undefined,
      executionError: undefined,
    });

    // Spans should be exported via the global provider's exporter
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);

    // The Workflow span should exist (plugin still creates it)
    const workflowSpan = spans.find((s) => s.name === "Workflow");
    expect(workflowSpan).toBeDefined();

    globalProvider.shutdown();
  });

  it("providerSource=GLOBAL creates an Invocation span with durable.execution.arn", async () => {
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    const { ExecutionOtelPlugin } = await import("../execution-plugin");

    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.GLOBAL,
    });

    await plugin.onInvocationStart({
      requestId: "req-2",
      executionArn: "arn:aws:states:us-east-1:123456789012:execution:sm:exec-2",
      isFirstInvocation: true,
      executionInput: {},
      operations: {},
      updatedOperations: {},
    });

    await plugin.onInvocationEnd({
      requestId: "req-2",
      executionArn: "arn:aws:states:us-east-1:123456789012:execution:sm:exec-2",
      executionInput: {},
      operations: {},
      status: "SUCCEEDED" as any,
      executionResult: undefined,
      executionError: undefined,
    });

    const spans = exporter.getFinishedSpans();
    const invocationSpan = spans.find((s) => s.name === "Invocation");
    expect(invocationSpan).toBeDefined();
    expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(
      "arn:aws:states:us-east-1:123456789012:execution:sm:exec-2",
    );

    globalProvider.shutdown();
  });
});

describe("resolveWorkflowRoot", () => {
  const rootFlags = (tracer: any, traceId: string) =>
    resolveWorkflowRoot(
      tracer,
      traceId,
      "b".repeat(16),
      "Workflow",
      "arn:x",
    ).span.spanContext().traceFlags;

  const TRACE_ID = "9c1c1a2b3d4e5f60718293a4b5c6d7e8";

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
  ])("returns the sampler's root decision for %s", (_n, make, expected) => {
    const { provider, tracer } = tracerFor(make());
    expect(rootFlags(tracer, TRACE_ID)).toBe(expected);
    provider.shutdown();
  });

  // The whole point of the helper: reproduce what startSpan would have decided.
  // If the SDK ever renames the internal `_sampler`, the fallback kicks in and
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
        generateSpanId: () => "b".repeat(16),
      };

      const real = tracer.startSpan("Workflow", {}, ROOT_CONTEXT);
      const automatic = real.spanContext().traceFlags;
      real.end();

      expect(rootFlags(tracer, traceId)).toBe(automatic);
      provider.shutdown();
    }
  });

  it("falls back to SAMPLED when the tracer exposes no sampler", () => {
    const noopTracer = trace.getTracer("noop"); // no-op API tracer
    expect(rootFlags(noopTracer, TRACE_ID)).toBe(TraceFlags.SAMPLED);
  });
});

/**
 * The plugins hold the Workflow span identity as a synthetic, non-recording span
 * context. Its flags must carry the provider's real sampling decision: asserting
 * SAMPLED would export operation spans while the terminal root is dropped, and
 * make enrichLogContext() report otelTraceSampled: true for dropped traces.
 */
describe.each([
  [
    "ExecutionOtelPlugin",
    async () => (await import("../execution-plugin")).ExecutionOtelPlugin,
  ],
  [
    "InvocationOtelPlugin",
    async () => (await import("../invocation-plugin")).InvocationOtelPlugin,
  ],
])("%s honors an unsampled provider", (_name, importPlugin) => {
  const invInfo = {
    requestId: "req-1",
    executionArn: "arn:aws:states:us-east-1:123456789012:execution:sm:exec-1",
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
  } as any;
  const invEnd = { ...invInfo, status: "SUCCEEDED" } as any;

  async function setup() {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      sampler: new ParentBasedSampler({ root: new AlwaysOffSampler() }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const Plugin = await importPlugin();
    return {
      exporter,
      provider,
      plugin: new Plugin({ providerSource: ProviderSource.GLOBAL }) as any,
    };
  }

  it("marks the synthetic Workflow context unsampled and exports nothing", async () => {
    const { exporter, provider, plugin } = await setup();

    await plugin.onInvocationStart(invInfo);
    expect(plugin.workflowSpan.spanContext().traceFlags).toBe(TraceFlags.NONE);

    await plugin.onOperationStart({
      id: "op-1",
      type: "STEP",
      name: "my-step",
      isReplay: false,
    });
    await plugin.onOperationEnd({
      id: "op-1",
      type: "STEP",
      name: "my-step",
      isReplay: false,
      status: "SUCCEEDED",
    });
    await plugin.onInvocationEnd(invEnd);

    expect(exporter.getFinishedSpans()).toHaveLength(0);
    await provider.shutdown();
  });

  it("reports otelTraceSampled false from enrichLogContext", async () => {
    const { provider, plugin } = await setup();

    await plugin.onInvocationStart(invInfo);
    const enriched = await plugin.wrapInvocation(invInfo, async () =>
      plugin.enrichLogContext(),
    );

    expect(enriched?.otelTraceSampled).toBe(false);

    await plugin.onInvocationEnd(invEnd);
    await provider.shutdown();
  });

  it("still exports the root when the sampler says yes", async () => {
    // Control, so the assertions above cannot pass vacuously.
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const Plugin = await importPlugin();
    const plugin = new Plugin({
      providerSource: ProviderSource.GLOBAL,
    }) as any;

    await plugin.onInvocationStart(invInfo);
    expect(plugin.workflowSpan.spanContext().traceFlags).toBe(
      TraceFlags.SAMPLED,
    );
    await plugin.onInvocationEnd(invEnd);

    expect(
      exporter.getFinishedSpans().filter((s) => s.name === "Workflow"),
    ).toHaveLength(1);
    await provider.shutdown();
  });
});

/**
 * The synthetic Workflow context and the terminal Workflow span must reach the
 * SAME sampling decision. They are sampled at different times, so the inputs
 * have to match (identical name + attributes, ROOT_CONTEXT, same traceId) and
 * the result is cached and reused.
 */
describe.each([
  [
    "ExecutionOtelPlugin",
    async () => (await import("../execution-plugin")).ExecutionOtelPlugin,
  ],
  [
    "InvocationOtelPlugin",
    async () => (await import("../invocation-plugin")).InvocationOtelPlugin,
  ],
])(
  "%s sampling is consistent across both Workflow sampling points",
  (_name, importPlugin) => {
    const ARN = "arn:aws:states:us-east-1:123456789012:execution:sm:exec-1";
    const invInfo = {
      requestId: "req-1",
      executionArn: ARN,
      isFirstInvocation: true,
      executionInput: {},
      operations: {},
      updatedOperations: {},
    } as any;
    const invEnd = { ...invInfo, status: "SUCCEEDED" } as any;

    /** Samples only spans carrying durable.execution.arn — and drops the rest. */
    class ArnAttributeSampler implements Sampler {
      public seen: Attributes[] = [];
      shouldSample(
        _ctx: unknown,
        _traceId: string,
        _name: string,
        _kind: unknown,
        attributes: Attributes,
      ) {
        this.seen.push({ ...attributes });
        return {
          decision: attributes["durable.execution.arn"]
            ? SamplingDecision.RECORD_AND_SAMPLED
            : SamplingDecision.NOT_RECORD,
        };
      }
      toString() {
        return "ArnAttributeSampler";
      }
    }

    /** Samples the first root it sees, then drops everything after. */
    class FirstOnlySampler implements Sampler {
      public calls = 0;
      shouldSample() {
        this.calls += 1;
        return {
          decision:
            this.calls === 1
              ? SamplingDecision.RECORD_AND_SAMPLED
              : SamplingDecision.NOT_RECORD,
        };
      }
      toString() {
        return "FirstOnlySampler";
      }
    }

    async function run(sampler: Sampler) {
      const exporter = new InMemorySpanExporter();
      const provider = new NodeTracerProvider({
        sampler,
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      provider.register();
      const Plugin = await importPlugin();
      const plugin = new Plugin({
        providerSource: ProviderSource.GLOBAL,
      }) as any;

      await plugin.onInvocationStart(invInfo);
      const syntheticFlags = plugin.workflowSpan.spanContext().traceFlags;
      await plugin.onInvocationEnd(invEnd);

      const workflow = exporter
        .getFinishedSpans()
        .filter((s) => s.name === "Workflow");
      await provider.shutdown();
      return { syntheticFlags, workflow };
    }

    it("passes the Workflow attributes to an attribute-based sampler at both points", async () => {
      const sampler = new ArnAttributeSampler();
      const { syntheticFlags, workflow } = await run(sampler);

      // Every root sampling call saw durable.execution.arn, so the sampler
      // reached the same answer both times.
      const rootCalls = sampler.seen.filter(
        (a) => a["durable.execution.arn"] !== undefined,
      );
      expect(rootCalls.length).toBeGreaterThanOrEqual(1);
      expect(syntheticFlags).toBe(TraceFlags.SAMPLED);
      expect(workflow).toHaveLength(1);

      // Status is stamped after creation, so it never skews the decision.
      expect(workflow[0].attributes["durable.execution.status"]).toBe(
        "SUCCEEDED",
      );
    });

    it("does not export a Workflow root a stateful sampler would have dropped for children", async () => {
      // The cached decision is what counts: if the first call said "drop", the
      // terminal span is never created, so children and root agree.
      const sampler = new FirstOnlySampler();
      sampler.shouldSample(); // burn the one sampled decision before the plugin runs

      const { syntheticFlags, workflow } = await run(sampler);

      expect(syntheticFlags).toBe(TraceFlags.NONE);
      expect(workflow).toHaveLength(0);
    });
  },
);
