import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";
import type {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationEndInfo,
  InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  deriveSpanIdFromOperationId,
  deriveTraceIdFromArn,
  deriveWorkflowSpanId,
} from "../deterministic-id-generator";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";
import {
  type OtelPluginConfig,
  type TracerProviderFactory,
} from "../otel-plugin-config";

const INSTRUMENTATION_NAME = "aws-durable-execution-sdk-js";
const EXECUTION_ARN_A =
  "arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST:execution-a";
const EXECUTION_ARN_B =
  "arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST:execution-b";
const EXECUTION_START = new Date("2024-01-01T00:00:00.000Z");

function invocationInfo(executionArn: string): InvocationInfo {
  return {
    requestId: `request-${executionArn}`,
    executionArn,
    executionStartTimestamp: EXECUTION_START,
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
  };
}

function invocationEndInfo(executionArn: string): InvocationEndInfo {
  return {
    requestId: `request-${executionArn}`,
    executionArn,
    executionStartTimestamp: EXECUTION_START,
    executionInput: {},
    operations: {},
    status: "SUCCEEDED",
  };
}

function currentWorkflowSpan(
  plugin: DurableInstrumentationPlugin,
): Span | undefined {
  return (plugin as unknown as { workflowSpan: Span | undefined }).workflowSpan;
}

function workflowSpan(plugin: DurableInstrumentationPlugin): Span {
  const span = currentWorkflowSpan(plugin);
  if (!span) {
    throw new Error("Expected plugin to create a Workflow span");
  }
  return span;
}

/**
 * The plugin instance the SDK would build for one invocation: the factory called
 * with that invocation's own info, which is then the info its hooks receive. A
 * test that drives two invocations calls the same factory twice, so the two
 * instances share one environment — which is where the "have we installed the ID
 * generator yet?" state lives.
 */
function pluginFor(
  factory: DurableInstrumentationPluginFactory,
  info: InvocationInfo,
): DurableInstrumentationPlugin {
  return factory(info);
}

describe.each([
  ["ExecutionOtelPlugin", createExecutionOtelPluginFactory],
  ["InvocationOtelPlugin", createInvocationOtelPluginFactory],
] as const)("%s ID generation isolation", (pluginName, createFactory) => {
  afterEach(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it.each(["global", "explicit"] as const)(
    "does not change unrelated roots for %s providers",
    async (providerOwnership) => {
      let provider: NodeTracerProvider | undefined;
      let config: OtelPluginConfig;
      if (providerOwnership === "global") {
        provider = new NodeTracerProvider();
        provider.register();
        config = {};
      } else {
        config = {
          tracerProviderFactory: (createIdGenerator) => {
            provider = new NodeTracerProvider({
              idGenerator: createIdGenerator(),
            });
            return provider;
          },
        };
      }

      const info = invocationInfo(EXECUTION_ARN_A);
      const plugin = pluginFor(createFactory(config), info);
      if (!provider) {
        throw new Error("TracerProvider factory was not called");
      }
      const resolvedProvider = provider;
      const unrelatedTracer = resolvedProvider.getTracer(INSTRUMENTATION_NAME);
      const before = unrelatedTracer.startSpan(
        "before",
        undefined,
        ROOT_CONTEXT,
      );

      await plugin.onInvocationStart!(info);
      const workflow = workflowSpan(plugin);
      const during = unrelatedTracer.startSpan(
        "during",
        undefined,
        ROOT_CONTEXT,
      );
      await plugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_A));
      const after = unrelatedTracer.startSpan("after", undefined, ROOT_CONTEXT);

      expect(
        new Set([
          before.spanContext().traceId,
          workflow.spanContext().traceId,
          during.spanContext().traceId,
          after.spanContext().traceId,
        ]),
      ).toHaveProperty("size", 4);

      before.end();
      during.end();
      after.end();
      await resolvedProvider.shutdown();
    },
  );

  it.each(["global", "explicit"] as const)(
    "delegates unrelated %s-provider IDs to the provider fallback",
    async (providerOwnership) => {
      let traceIdCounter = 0;
      let spanIdCounter = 0;
      const fallbackIdGenerator: IdGenerator = {
        generateTraceId: jest.fn(() =>
          (++traceIdCounter).toString(16).padStart(32, "0"),
        ),
        generateSpanId: jest.fn(() =>
          (++spanIdCounter).toString(16).padStart(16, "0"),
        ),
      };
      let provider: NodeTracerProvider | undefined;
      let config: OtelPluginConfig;
      if (providerOwnership === "global") {
        provider = new NodeTracerProvider({
          idGenerator: fallbackIdGenerator,
        });
        provider.register();
        config = {};
      } else {
        config = {
          tracerProviderFactory: (createIdGenerator) => {
            provider = new NodeTracerProvider({
              idGenerator: createIdGenerator(fallbackIdGenerator),
            });
            return provider;
          },
        };
      }
      const info = invocationInfo(EXECUTION_ARN_A);
      const plugin = pluginFor(createFactory(config), info);
      if (!provider) {
        throw new Error("TracerProvider factory was not called");
      }

      const unrelatedSpan = provider
        .getTracer(INSTRUMENTATION_NAME)
        .startSpan("unrelated", undefined, ROOT_CONTEXT);
      expect(unrelatedSpan.spanContext()).toMatchObject({
        traceId: "0".repeat(31) + "1",
        spanId: "0".repeat(15) + "1",
      });

      await plugin.onInvocationStart!(info);
      expect(workflowSpan(plugin).spanContext()).toMatchObject({
        traceId: deriveTraceIdFromArn(EXECUTION_ARN_A, EXECUTION_START),
        spanId: deriveWorkflowSpanId(EXECUTION_ARN_A),
      });
      await plugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_A));

      expect(fallbackIdGenerator.generateTraceId).toHaveBeenCalled();
      expect(fallbackIdGenerator.generateSpanId).toHaveBeenCalled();
      unrelatedSpan.end();
      await provider.shutdown();
    },
  );

  it("retries global installation after the provider registers", async () => {
    // Building the instance resolves the environment against a global provider
    // that is not registered yet, so the retry at invocation start is what has
    // to succeed.
    const info = invocationInfo(EXECUTION_ARN_A);
    const plugin = pluginFor(createFactory(), info);
    const provider = new NodeTracerProvider();
    provider.register();

    await plugin.onInvocationStart!(info);

    expect(workflowSpan(plugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_A, EXECUTION_START),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_A),
    });

    await plugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_A));
    await provider.shutdown();
  });

  it("disables the current invocation and recovers when the global provider registers later", async () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    // Two invocations, so two instances from one factory: the disabled-then-
    // recovered state belongs to the environment they share, not to an instance.
    const factory = createFactory();
    const firstInfo = invocationInfo(EXECUTION_ARN_A);
    const firstPlugin = pluginFor(factory, firstInfo);

    await firstPlugin.onInvocationStart!(firstInfo);
    expect(currentWorkflowSpan(firstPlugin)).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    await firstPlugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_A));

    const provider = new NodeTracerProvider();
    provider.register();

    const secondInfo = invocationInfo(EXECUTION_ARN_B);
    const secondPlugin = pluginFor(factory, secondInfo);
    await secondPlugin.onInvocationStart!(secondInfo);
    expect(workflowSpan(secondPlugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_B, EXECUTION_START),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_B),
    });
    await secondPlugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_B));

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
    await provider.shutdown();
  });

  it("disables and warns for every invocation while global installation keeps failing", async () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    // One factory, one environment, one instance per invocation: installation
    // keeps failing, so each invocation is disabled and warns for itself.
    const factory = createFactory();
    const firstInfo = invocationInfo(EXECUTION_ARN_A);
    const firstPlugin = pluginFor(factory, firstInfo);

    await firstPlugin.onInvocationStart!(firstInfo);
    await firstPlugin.onOperationStart!({
      id: "disabled-operation-a",
      type: "STEP",
      isReplay: false,
    });
    expect(currentWorkflowSpan(firstPlugin)).toBeUndefined();
    expect(firstPlugin.enrichLogContext?.()).toBeUndefined();
    await firstPlugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_A));

    const secondInfo = invocationInfo(EXECUTION_ARN_B);
    const secondPlugin = pluginFor(factory, secondInfo);
    await secondPlugin.onInvocationStart!(secondInfo);
    await secondPlugin.onOperationStart!({
      id: "disabled-operation-b",
      type: "STEP",
      isReplay: false,
    });
    expect(currentWorkflowSpan(secondPlugin)).toBeUndefined();
    await secondPlugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_B));

    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenNthCalledWith(
      1,
      `[${pluginName}] Expected a compatible OpenTelemetry SDK tracer at invocation start; telemetry is disabled for this invocation. Ensure the OpenTelemetry SDK is configured before invocation start.`,
    );
    expect(consoleWarnSpy).toHaveBeenNthCalledWith(
      2,
      `[${pluginName}] Expected a compatible OpenTelemetry SDK tracer at invocation start; telemetry is disabled for this invocation. Ensure the OpenTelemetry SDK is configured before invocation start.`,
    );

    consoleWarnSpy.mockRestore();
  });

  it("does not emit spans through an incompatible registered global tracer", async () => {
    const startSpan = jest.fn();
    const incompatibleTracer = { startSpan };
    const incompatibleProvider = {
      getTracer: jest.fn(() => incompatibleTracer),
    };
    trace.setGlobalTracerProvider(incompatibleProvider as never);
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const info = invocationInfo(EXECUTION_ARN_A);
    const plugin = pluginFor(createFactory(), info);

    await plugin.onInvocationStart!(info);
    await plugin.onOperationStart!({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
    });
    await plugin.onOperationAttemptStart!({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
      attempt: 1,
    });
    await plugin.onOperationAttemptEnd!({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
      attempt: 1,
      outcome: "SUCCEEDED",
    });
    await plugin.onOperationEnd!({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
      status: "SUCCEEDED",
    });
    await plugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_A));

    expect(startSpan).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
  });

  it("keeps interleaved plugin instances scoped to their executions", async () => {
    let provider: NodeTracerProvider | undefined;
    const tracerProviderFactory: TracerProviderFactory = (
      createIdGenerator,
    ) => {
      provider ??= new NodeTracerProvider({
        idGenerator: createIdGenerator(),
      });
      return provider;
    };
    // Two interleaved invocations out of one factory, so they share the
    // environment the tracerProviderFactory built.
    const factory = createFactory({ tracerProviderFactory });
    const firstInfo = invocationInfo(EXECUTION_ARN_A);
    const secondInfo = invocationInfo(EXECUTION_ARN_B);
    const firstPlugin = pluginFor(factory, firstInfo);
    const secondPlugin = pluginFor(factory, secondInfo);

    await firstPlugin.onInvocationStart!(firstInfo);
    await secondPlugin.onInvocationStart!(secondInfo);

    expect(workflowSpan(firstPlugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_A, EXECUTION_START),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_A),
    });
    expect(workflowSpan(secondPlugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_B, EXECUTION_START),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_B),
    });

    await firstPlugin.onOperationStart!({
      id: "operation",
      type: "STEP",
      isReplay: false,
    });
    await secondPlugin.onOperationStart!({
      id: "operation",
      type: "STEP",
      isReplay: false,
    });

    // The deterministic operation span ID is scoped per execution ARN. Where it
    // lives after onOperationStart differs by plugin: InvocationOtelPlugin
    // creates the recording operation span immediately (held in spanMap), while
    // ExecutionOtelPlugin defers the span to onOperationEnd and holds a
    // non-recording placeholder context (operationContexts) in the meantime.
    const operationSpanId = (
      plugin: DurableInstrumentationPlugin,
    ): string | undefined => {
      if (pluginName === "ExecutionOtelPlugin") {
        return (
          plugin as unknown as { operationContexts: Map<string, SpanContext> }
        ).operationContexts.get("operation")?.spanId;
      }
      return (plugin as unknown as { spanMap: Map<string, Span> }).spanMap
        .get("operation")
        ?.spanContext().spanId;
    };

    expect(operationSpanId(firstPlugin)).toBe(
      deriveSpanIdFromOperationId("operation", EXECUTION_ARN_A),
    );
    expect(operationSpanId(secondPlugin)).toBe(
      deriveSpanIdFromOperationId("operation", EXECUTION_ARN_B),
    );

    await firstPlugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_A));
    await secondPlugin.onInvocationEnd!(invocationEndInfo(EXECUTION_ARN_B));
    expect(provider).toBeDefined();
    await provider!.shutdown();
  });
});
