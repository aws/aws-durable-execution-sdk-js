import {
  withDurableExecution,
  type InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";
import { context, propagation, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";
import { DeterministicIdGenerator } from "../deterministic-id-generator";
import {
  createTracerProvider,
  flushTracerProvider,
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

describe("createExecutionOtelPluginFactory provider resolution", () => {
  it("uses the global provider by default", async () => {
    const exporter = new InMemorySpanExporter();
    const globalProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    globalProvider.register();

    const { createExecutionOtelPluginFactory } = await import(
      "../execution-plugin"
    );
    // The factory the SDK calls once per invocation, with that invocation's info.
    const info: InvocationInfo = {
      requestId: "req-1",
      executionArn: "arn:aws:states:us-east-1:123456789012:execution:sm:exec-1",
      isFirstInvocation: true,
      executionInput: {},
      operations: {},
      updatedOperations: {},
    };
    const plugin = createExecutionOtelPluginFactory().createPlugin(info);

    await plugin.onInvocationStart(info);
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

    const { createExecutionOtelPluginFactory } = await import(
      "../execution-plugin"
    );
    const executionArn =
      "arn:aws:states:us-east-1:123456789012:execution:sm:exec-2";
    const info: InvocationInfo = {
      requestId: "req-2",
      executionArn,
      isFirstInvocation: true,
      executionInput: {},
      operations: {},
      updatedOperations: {},
    };
    const plugin = createExecutionOtelPluginFactory().createPlugin(info);

    await plugin.onInvocationStart(info);
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

describe.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s global provider batch export", (_view, Plugin) => {
  beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  it("flushes the registered SDK provider before each public invocation returns", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [
        new BatchSpanProcessor(exporter, { scheduledDelayMillis: 60_000 }),
      ],
    });
    provider.register();
    const flush = jest.spyOn(provider, "forceFlush");
    const shutdown = jest.spyOn(provider, "shutdown");
    const plugin = Plugin({ contextExtractor: () => undefined });
    const starts: InvocationInfo[] = [];
    const savedBody = jest.fn(async () => "saved");
    const handler = withDurableExecution(
      async (_, ctx) => {
        const saved = await ctx.step("saved", savedBody);
        const [external] = await ctx.createCallback("external");
        await external;
        const [later] = await ctx.createCallback("later");
        await later;
        return saved;
      },
      {
        plugins: [
          plugin,
          {
            createPlugin: () => ({
              async onInvocationStart(info) {
                starts.push(info);
              },
            }),
          },
        ],
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const terminalCount = () =>
      exporter
        .getFinishedSpans()
        .filter(
          (span) =>
            span.name === "external" &&
            span.attributes["durable.operation.status"] === "SUCCEEDED",
        ).length;
    const counts: number[] = [];
    try {
      const execution = runner.run();
      const external = runner.getOperation("external");
      await external.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      counts.push(terminalCount());
      const savedAtFirstReturn = exporter
        .getFinishedSpans()
        .filter((span) => span.name === "saved").length;
      await external.sendCallbackSuccess("external result");
      await runner.resumeExecution();
      const later = runner.getOperation("later");
      await later.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      counts.push(terminalCount());
      await later.sendCallbackSuccess("continue");
      await runner.resumeExecution();
      const result = await execution;
      counts.push(terminalCount());
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("saved");
      expect(starts).toHaveLength(3);
      expect(savedBody).toHaveBeenCalledTimes(1);
      expect(savedAtFirstReturn).toBe(1);
      expect(counts).toEqual([0, 1, 1]);
      expect(flush).toHaveBeenCalledTimes(3);
      expect(shutdown).not.toHaveBeenCalled();
    } finally {
      await provider.shutdown();
    }
  }, 30000);
});

describe("provider boundary flushing", () => {
  it("flushes a batch through the global API proxy and leaves provider lifetime owned by the caller", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [
        new BatchSpanProcessor(exporter, { scheduledDelayMillis: 60_000 }),
      ],
    });
    provider.register();
    const shutdown = jest.spyOn(provider, "shutdown");
    try {
      trace.getTracer("unit").startSpan("queued").end();
      expect(exporter.getFinishedSpans()).toHaveLength(0);
      await flushTracerProvider(trace.getTracerProvider(), true);
      expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
        "queued",
      ]);
      expect(shutdown).not.toHaveBeenCalled();
    } finally {
      await provider.shutdown();
    }
  });

  it("honors an explicit factory provider's own flush without traversing its delegate", async () => {
    const provider = new NodeTracerProvider();
    const getDelegate = jest.fn(() => provider);
    let receiver: unknown;
    const factoryProvider = {
      getTracer: provider.getTracer.bind(provider),
      getDelegate,
      async forceFlush() {
        receiver = this;
        await provider.forceFlush();
      },
    };
    try {
      await flushTracerProvider(factoryProvider, false);
      expect(receiver).toBe(factoryProvider);
      expect(getDelegate).not.toHaveBeenCalled();
      const opaque = {
        getTracer: provider.getTracer.bind(provider),
        getDelegate,
      };
      await flushTracerProvider(opaque, false);
      expect(getDelegate).not.toHaveBeenCalled();
    } finally {
      await provider.shutdown();
    }
  });
});
