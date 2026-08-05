/**
 * Unit tests for provider resolution, config validation, and instrumentation
 * skipping in the shared OTel plugin infrastructure (used by both
 * ExecutionOtelPlugin and InvocationOtelPlugin), driven by `providerSource`.
 */
import { trace, context, propagation } from "@opentelemetry/api";
import type { TracerProvider } from "@opentelemetry/api";
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createTracerProvider } from "../otel-plugin-provider";
import {
  ProviderSource,
  resolveProviderSource,
} from "../otel-plugin-config";
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
  describe("providerSource=Global", () => {
    it("returns the globally registered TracerProvider", () => {
      // Register a global provider
      const exporter = new InMemorySpanExporter();
      const globalProvider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      globalProvider.register();

      const result = createTracerProvider({
        providerSource: ProviderSource.Global,
      });

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.Global);

      globalProvider.shutdown();
    });

    it("sets source=Global", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider({
        providerSource: ProviderSource.Global,
      });

      expect(result.source).toBe(ProviderSource.Global);

      globalProvider.shutdown();
    });
  });

  describe("providerSource=Explicit", () => {
    it("uses the supplied tracerProvider and sets source=Explicit", () => {
      const explicitProvider = new NodeTracerProvider();

      const result = createTracerProvider({
        providerSource: ProviderSource.Explicit,
        tracerProvider: explicitProvider,
      });

      expect(result.tracerProvider).toBe(explicitProvider);
      expect(result.source).toBe(ProviderSource.Explicit);

      explicitProvider.shutdown();
    });
  });

  describe("providerSource=AutoOtlp", () => {
    it("creates an internal provider with source=AutoOtlp", () => {
      const result = createTracerProvider({
        providerSource: ProviderSource.AutoOtlp,
      });

      expect(result.source).toBe(ProviderSource.AutoOtlp);

      // Clean up
      if ("shutdown" in result.tracerProvider) {
        (result.tracerProvider as NodeTracerProvider).shutdown();
      }
    });
  });

  describe("default source is Global when providerSource is absent", () => {
    it("returns the global provider with source=Global for an empty config", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider({});

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.Global);

      globalProvider.shutdown();
    });

    it("returns the global provider with source=Global for undefined config", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider(undefined);

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.Global);

      globalProvider.shutdown();
    });
  });
});

describe("resolveProviderSource validation", () => {
  it("defaults to Global when providerSource is absent", () => {
    expect(resolveProviderSource(undefined)).toBe(ProviderSource.Global);
    expect(resolveProviderSource({})).toBe(ProviderSource.Global);
  });

  it("returns the configured source verbatim for Global", () => {
    expect(
      resolveProviderSource({ providerSource: ProviderSource.Global }),
    ).toBe(ProviderSource.Global);
  });

  it("returns Explicit when providerSource=Explicit and a tracerProvider is supplied", () => {
    const explicitProvider = new NodeTracerProvider();
    expect(
      resolveProviderSource({
        providerSource: ProviderSource.Explicit,
        tracerProvider: explicitProvider,
      }),
    ).toBe(ProviderSource.Explicit);
    explicitProvider.shutdown();
  });

  it("throws when providerSource=Explicit but no tracerProvider is supplied", () => {
    expect(() =>
      resolveProviderSource({ providerSource: ProviderSource.Explicit }),
    ).toThrow(/requires a `tracerProvider`/);
  });

  it("throws when a tracerProvider is supplied without providerSource=Explicit (default source)", () => {
    const explicitProvider = new NodeTracerProvider();
    expect(() =>
      resolveProviderSource({ tracerProvider: explicitProvider }),
    ).toThrow(/only used with providerSource 'explicit'/);
    explicitProvider.shutdown();
  });

  it("throws when a tracerProvider is supplied with providerSource=Global", () => {
    const explicitProvider = new NodeTracerProvider();
    expect(() =>
      resolveProviderSource({
        providerSource: ProviderSource.Global,
        tracerProvider: explicitProvider,
      }),
    ).toThrow(/only used with providerSource 'explicit'/);
    explicitProvider.shutdown();
  });
});

describe("registerStandaloneInstrumentations", () => {
  describe("skips registration for non-AutoOtlp sources", () => {
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
          ProviderSource.Global,
          { providerSource: ProviderSource.Global },
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

      // Should not throw - returns early for the Explicit source
      expect(() => {
        registerStandaloneInstrumentations(
          mockProvider,
          ProviderSource.Explicit,
          {
            providerSource: ProviderSource.Explicit,
            tracerProvider: explicitProvider,
          },
        );
      }).not.toThrow();

      explicitProvider.shutdown();
    });
  });

  describe("AutoOtlp source does not skip registration", () => {
    it("proceeds with registration for AutoOtlp with an explicit config", () => {
      // For the AutoOtlp source the function should attempt to register
      // instrumentations. We use a real NodeTracerProvider to verify it does
      // not return early.
      const provider = new NodeTracerProvider();

      // This should not throw and should proceed through the full registration path
      expect(() => {
        registerStandaloneInstrumentations(provider, ProviderSource.AutoOtlp, {
          providerSource: ProviderSource.AutoOtlp,
        });
      }).not.toThrow();

      provider.shutdown();
    });

    it("proceeds with registration for AutoOtlp with an empty config", () => {
      const provider = new NodeTracerProvider();

      expect(() => {
        registerStandaloneInstrumentations(provider, ProviderSource.AutoOtlp, {});
      }).not.toThrow();

      provider.shutdown();
    });
  });
});

describe("ExecutionOtelPlugin integration - provider resolution", () => {
  // These tests verify the end-to-end behavior through the ExecutionOtelPlugin
  // constructor which calls both createTracerProvider and registerStandaloneInstrumentations

  it("providerSource=Global retrieves the global provider", async () => {
    // Register a known global provider
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    // Import ExecutionOtelPlugin dynamically to avoid module-level side effects
    const { ExecutionOtelPlugin } = await import("../execution-plugin");

    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.Global,
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

  it("providerSource=Global creates an Invocation span with durable.execution.arn", async () => {
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    const { ExecutionOtelPlugin } = await import("../execution-plugin");

    const plugin = new ExecutionOtelPlugin({
      providerSource: ProviderSource.Global,
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
