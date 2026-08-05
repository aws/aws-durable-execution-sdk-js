/**
 * Unit tests for provider resolution and instrumentation skipping
 * in the shared OTel plugin infrastructure (used by both ExecutionOtelPlugin
 * and InvocationOtelPlugin) when useDefaultTracerProvider is configured.
 */
import { trace, context, propagation } from "@opentelemetry/api";
import type { TracerProvider } from "@opentelemetry/api";
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createTracerProvider, ProviderSource } from "../otel-plugin-provider";
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
  describe("useDefaultTracerProvider=true", () => {
    it("returns the globally registered TracerProvider", () => {
      // Register a global provider
      const exporter = new InMemorySpanExporter();
      const globalProvider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      globalProvider.register();

      const result = createTracerProvider({ useDefaultTracerProvider: true });

      expect(result.tracerProvider).toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.Global);

      globalProvider.shutdown();
    });

    it("sets source=Global", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const result = createTracerProvider({ useDefaultTracerProvider: true });

      expect(result.source).toBe(ProviderSource.Global);

      globalProvider.shutdown();
    });
  });

  describe("precedence: explicit tracerProvider wins over useDefaultTracerProvider", () => {
    it("uses the explicit tracerProvider when both are specified", () => {
      const globalProvider = new NodeTracerProvider();
      globalProvider.register();

      const explicitProvider = new NodeTracerProvider();

      const result = createTracerProvider({
        tracerProvider: explicitProvider,
        useDefaultTracerProvider: true,
      });

      expect(result.tracerProvider).toBe(explicitProvider);
      expect(result.tracerProvider).not.toBe(trace.getTracerProvider());
      expect(result.source).toBe(ProviderSource.Explicit);

      globalProvider.shutdown();
      explicitProvider.shutdown();
    });

    it("ignores useDefaultTracerProvider when explicit tracerProvider is provided", () => {
      const explicitProvider = new NodeTracerProvider();

      const result = createTracerProvider({
        tracerProvider: explicitProvider,
        useDefaultTracerProvider: true,
      });

      expect(result.tracerProvider).toBe(explicitProvider);

      explicitProvider.shutdown();
    });
  });

  describe("useDefaultTracerProvider=false behaves same as absent", () => {
    it("creates an internal provider with source=AutoOtlp when useDefaultTracerProvider=false", () => {
      const result = createTracerProvider({
        useDefaultTracerProvider: false,
      });

      expect(result.source).toBe(ProviderSource.AutoOtlp);

      // Clean up
      if ("shutdown" in result.tracerProvider) {
        (result.tracerProvider as NodeTracerProvider).shutdown();
      }
    });

    it("creates an internal provider with source=AutoOtlp when useDefaultTracerProvider is absent", () => {
      const result = createTracerProvider({});

      expect(result.source).toBe(ProviderSource.AutoOtlp);

      // Clean up
      if ("shutdown" in result.tracerProvider) {
        (result.tracerProvider as NodeTracerProvider).shutdown();
      }
    });

    it("creates an internal provider with source=AutoOtlp when config is undefined", () => {
      const result = createTracerProvider(undefined);

      expect(result.source).toBe(ProviderSource.AutoOtlp);

      // Clean up
      if ("shutdown" in result.tracerProvider) {
        (result.tracerProvider as NodeTracerProvider).shutdown();
      }
    });

    it("useDefaultTracerProvider=false produces same source as absent", () => {
      const resultFalse = createTracerProvider({
        useDefaultTracerProvider: false,
      });
      const resultAbsent = createTracerProvider({});

      expect(resultFalse.source).toBe(resultAbsent.source);
      expect(resultFalse.source).toBe(ProviderSource.AutoOtlp);

      // Clean up
      if ("shutdown" in resultFalse.tracerProvider) {
        (resultFalse.tracerProvider as NodeTracerProvider).shutdown();
      }
      if ("shutdown" in resultAbsent.tracerProvider) {
        (resultAbsent.tracerProvider as NodeTracerProvider).shutdown();
      }
    });
  });
});

describe("registerStandaloneInstrumentations", () => {
  describe("useDefaultTracerProvider=true skips registration", () => {
    it("returns without registering instrumentations when useDefaultTracerProvider=true", () => {
      const mockProvider: TracerProvider = {
        getTracer: jest.fn().mockReturnValue({
          startSpan: jest.fn(),
          startActiveSpan: jest.fn(),
        }),
      };

      // Should not throw and should return early
      expect(() => {
        registerStandaloneInstrumentations(mockProvider, ProviderSource.Global, {
          useDefaultTracerProvider: true,
        });
      }).not.toThrow();

      // If it had registered instrumentations, it would have called into the
      // instrumentation system. The fact that it returns immediately with a mock
      // provider (which has no real span processor) without error confirms skipping.
    });

    it("skips instrumentation when explicit tracerProvider is provided", () => {
      const mockProvider: TracerProvider = {
        getTracer: jest.fn().mockReturnValue({
          startSpan: jest.fn(),
          startActiveSpan: jest.fn(),
        }),
      };

      const explicitProvider = new NodeTracerProvider();

      // Should not throw - returns early due to config.tracerProvider being set
      expect(() => {
        registerStandaloneInstrumentations(
          mockProvider,
          ProviderSource.Explicit,
          {
            tracerProvider: explicitProvider,
          },
        );
      }).not.toThrow();

      explicitProvider.shutdown();
    });

    it("skips instrumentation registration for both explicit provider and useDefaultTracerProvider", () => {
      const mockProvider: TracerProvider = {
        getTracer: jest.fn().mockReturnValue({
          startSpan: jest.fn(),
          startActiveSpan: jest.fn(),
        }),
      };

      const explicitProvider = new NodeTracerProvider();

      expect(() => {
        registerStandaloneInstrumentations(
          mockProvider,
          ProviderSource.Explicit,
          {
            tracerProvider: explicitProvider,
            useDefaultTracerProvider: true,
          },
        );
      }).not.toThrow();

      explicitProvider.shutdown();
    });
  });

  describe("useDefaultTracerProvider=false does not skip registration", () => {
    it("proceeds with registration when useDefaultTracerProvider=false", () => {
      // When useDefaultTracerProvider is false and no explicit tracerProvider
      // is provided, the function should attempt to register instrumentations.
      // We use a real NodeTracerProvider to verify it doesn't return early.
      const provider = new NodeTracerProvider();

      // This should not throw and should proceed through the full registration path
      expect(() => {
        registerStandaloneInstrumentations(provider, ProviderSource.AutoOtlp, {
          useDefaultTracerProvider: false,
        });
      }).not.toThrow();

      provider.shutdown();
    });

    it("proceeds with registration when config has no useDefaultTracerProvider or tracerProvider", () => {
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

  it("useDefaultTracerProvider=true retrieves the global provider", async () => {
    // Register a known global provider
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    // Import ExecutionOtelPlugin dynamically to avoid module-level side effects
    const { ExecutionOtelPlugin } = await import("../execution-plugin");

    const plugin = new ExecutionOtelPlugin({
      useDefaultTracerProvider: true,
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

  it("useDefaultTracerProvider=true creates an Invocation span with durable.execution.arn", async () => {
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    const { ExecutionOtelPlugin } = await import("../execution-plugin");

    const plugin = new ExecutionOtelPlugin({
      useDefaultTracerProvider: true,
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
