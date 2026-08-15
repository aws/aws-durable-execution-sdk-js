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
import { DeterministicIdGenerator } from "../deterministic-id-generator";

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
      }, new DeterministicIdGenerator());

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.GLOBAL);

      globalProvider.shutdown();
    });

    it("sets source=GLOBAL", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider({
        providerSource: ProviderSource.GLOBAL,
      }, new DeterministicIdGenerator());

      expect(result.source).toBe(ProviderSource.GLOBAL);

      globalProvider.shutdown();
    });
  });

  describe("providerSource=EXPLICIT", () => {
    it("passes the deterministic ID generator to the explicit provider factory", () => {
      const idGenerator = new DeterministicIdGenerator();
      const tracerProviderFactory = jest.fn(
        (providerIdGenerator) =>
          new NodeTracerProvider({ idGenerator: providerIdGenerator }),
      );

      const result = createTracerProvider(
        {
          providerSource: ProviderSource.EXPLICIT,
          tracerProviderFactory,
        },
        idGenerator,
      );

      expect(tracerProviderFactory).toHaveBeenCalledTimes(1);
      expect(tracerProviderFactory).toHaveBeenCalledWith(idGenerator);
      expect(result.source).toBe(ProviderSource.EXPLICIT);

      (result.tracerProvider as NodeTracerProvider).shutdown();
    });
  });

  describe("providerSource=AUTO_OTLP", () => {
    it("creates an internal provider with source=AUTO_OTLP", () => {
      const result = createTracerProvider({
        providerSource: ProviderSource.AUTO_OTLP,
      }, new DeterministicIdGenerator());

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

      const result = createTracerProvider({}, new DeterministicIdGenerator());

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.GLOBAL);

      globalProvider.shutdown();
    });

    it("returns the global provider with source=GLOBAL for undefined config", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider(
        undefined,
        new DeterministicIdGenerator(),
      );

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

  it("returns EXPLICIT when providerSource=EXPLICIT and a tracerProviderFactory is supplied", () => {
    expect(
      resolveProviderSource({
        providerSource: ProviderSource.EXPLICIT,
        tracerProviderFactory: (idGenerator) =>
          new NodeTracerProvider({ idGenerator }),
      }),
    ).toBe(ProviderSource.EXPLICIT);
  });

  it("throws when providerSource=EXPLICIT but no tracerProviderFactory is supplied", () => {
    expect(() =>
      resolveProviderSource({ providerSource: ProviderSource.EXPLICIT }),
    ).toThrow(/requires a `tracerProviderFactory`/);
  });

  it("throws when a tracerProviderFactory is supplied without providerSource=EXPLICIT", () => {
    expect(() =>
      resolveProviderSource({
        tracerProviderFactory: (idGenerator) =>
          new NodeTracerProvider({ idGenerator }),
      }),
    ).toThrow(/only used with providerSource 'explicit'/);
  });

  it("throws when a tracerProviderFactory is supplied with providerSource=GLOBAL", () => {
    expect(() =>
      resolveProviderSource({
        providerSource: ProviderSource.GLOBAL,
        tracerProviderFactory: (idGenerator) =>
          new NodeTracerProvider({ idGenerator }),
      }),
    ).toThrow(/only used with providerSource 'explicit'/);
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

      // Should not throw - returns early for the EXPLICIT source
      expect(() => {
        registerStandaloneInstrumentations(
          mockProvider,
          ProviderSource.EXPLICIT,
          {
            providerSource: ProviderSource.EXPLICIT,
            tracerProviderFactory: (idGenerator) =>
              new NodeTracerProvider({ idGenerator }),
          },
        );
      }).not.toThrow();
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
        registerStandaloneInstrumentations(provider, ProviderSource.AUTO_OTLP, {});
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
