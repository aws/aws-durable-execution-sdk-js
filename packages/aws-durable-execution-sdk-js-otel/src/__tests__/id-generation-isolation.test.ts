import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  type Span,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";
import type {
  DurableInstrumentationPlugin,
  InvocationEndInfo,
  InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  deriveSpanIdFromOperationId,
  deriveTraceIdFromArn,
  deriveWorkflowSpanId,
} from "../deterministic-id-generator";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import {
  type OtelPluginConfig,
  type TracerProviderFactory,
} from "../otel-plugin-config";

const INSTRUMENTATION_NAME = "aws-durable-execution-sdk-js";
const EXECUTION_ARN_A =
  "arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST:execution-a";
const EXECUTION_ARN_B =
  "arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST:execution-b";

type PluginConstructor = new (
  config?: OtelPluginConfig,
) => DurableInstrumentationPlugin;

function invocationInfo(executionArn: string): InvocationInfo {
  return {
    requestId: `request-${executionArn}`,
    executionArn,
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

describe.each([
  ["ExecutionOtelPlugin", ExecutionOtelPlugin],
  ["InvocationOtelPlugin", InvocationOtelPlugin],
] as const)("%s ID generation isolation", (pluginName, Plugin) => {
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

      const plugin = new Plugin(config);
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

      await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));
      const workflow = workflowSpan(plugin);
      const during = unrelatedTracer.startSpan(
        "during",
        undefined,
        ROOT_CONTEXT,
      );
      await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_A));
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
      const plugin = new Plugin(config);
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

      await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));
      expect(workflowSpan(plugin).spanContext()).toMatchObject({
        traceId: deriveTraceIdFromArn(EXECUTION_ARN_A),
        spanId: deriveWorkflowSpanId(EXECUTION_ARN_A),
      });
      await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_A));

      expect(fallbackIdGenerator.generateTraceId).toHaveBeenCalled();
      expect(fallbackIdGenerator.generateSpanId).toHaveBeenCalled();
      unrelatedSpan.end();
      await provider.shutdown();
    },
  );

  it("retries global installation after the provider registers", async () => {
    const plugin = new Plugin();
    const provider = new NodeTracerProvider();
    provider.register();

    await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));

    expect(workflowSpan(plugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_A),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_A),
    });

    await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_A));
    await provider.shutdown();
  });

  it("disables the current invocation and recovers when the global provider registers later", async () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const plugin = new Plugin();

    await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));
    expect(currentWorkflowSpan(plugin)).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_A));

    const provider = new NodeTracerProvider();
    provider.register();

    await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_B));
    expect(workflowSpan(plugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_B),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_B),
    });
    await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_B));

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
    await provider.shutdown();
  });

  it("disables and warns for every invocation while global installation keeps failing", async () => {
    const consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const plugin = new Plugin();

    await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));
    await plugin.onOperationStart({
      id: "disabled-operation-a",
      type: "STEP",
      isReplay: false,
    });
    expect(currentWorkflowSpan(plugin)).toBeUndefined();
    expect(plugin.enrichLogContext?.()).toBeUndefined();
    await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_A));

    await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_B));
    await plugin.onOperationStart({
      id: "disabled-operation-b",
      type: "STEP",
      isReplay: false,
    });
    expect(currentWorkflowSpan(plugin)).toBeUndefined();
    await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_B));

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
    const plugin = new Plugin();

    await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));
    await plugin.onOperationStart({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
    });
    await plugin.onOperationAttemptStart({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
      attempt: 1,
    });
    await plugin.onOperationAttemptEnd({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
      attempt: 1,
      outcome: "SUCCEEDED",
    });
    await plugin.onOperationEnd({
      id: "disabled-operation",
      type: "STEP",
      isReplay: false,
      status: "SUCCEEDED",
    });
    await plugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_A));

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
    const firstPlugin = new Plugin({
      tracerProviderFactory,
    });
    const secondPlugin = new Plugin({
      tracerProviderFactory,
    });

    await firstPlugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));
    await secondPlugin.onInvocationStart(invocationInfo(EXECUTION_ARN_B));

    expect(workflowSpan(firstPlugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_A),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_A),
    });
    expect(workflowSpan(secondPlugin).spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_B),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_B),
    });

    await firstPlugin.onOperationStart({
      id: "operation",
      type: "STEP",
      isReplay: false,
    });
    await secondPlugin.onOperationStart({
      id: "operation",
      type: "STEP",
      isReplay: false,
    });

    const firstOperation = (
      firstPlugin as unknown as { spanMap: Map<string, Span> }
    ).spanMap.get("operation");
    const secondOperation = (
      secondPlugin as unknown as { spanMap: Map<string, Span> }
    ).spanMap.get("operation");

    expect(firstOperation?.spanContext().spanId).toBe(
      deriveSpanIdFromOperationId("operation", EXECUTION_ARN_A),
    );
    expect(secondOperation?.spanContext().spanId).toBe(
      deriveSpanIdFromOperationId("operation", EXECUTION_ARN_B),
    );

    await firstPlugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_A));
    await secondPlugin.onInvocationEnd(invocationEndInfo(EXECUTION_ARN_B));
    expect(provider).toBeDefined();
    await provider!.shutdown();
  });
});
