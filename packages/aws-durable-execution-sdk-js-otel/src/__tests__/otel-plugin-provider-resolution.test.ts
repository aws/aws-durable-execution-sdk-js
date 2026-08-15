import { context, propagation, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { DeterministicIdGenerator } from "../deterministic-id-generator";
import { createTracerProvider } from "../otel-plugin-provider";

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

  it("passes the deterministic ID generator to the provider factory", () => {
    const idGenerator = new DeterministicIdGenerator();
    const tracerProviderFactory = jest.fn(
      (providerIdGenerator) =>
        new NodeTracerProvider({ idGenerator: providerIdGenerator }),
    );

    const result = createTracerProvider({ tracerProviderFactory }, idGenerator);

    expect(tracerProviderFactory).toHaveBeenCalledTimes(1);
    expect(tracerProviderFactory).toHaveBeenCalledWith(idGenerator);
    expect(result.usesGlobalProvider).toBe(false);

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
