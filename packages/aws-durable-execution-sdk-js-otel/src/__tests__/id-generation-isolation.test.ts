import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  type Span,
  type TracerProvider,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type {
  DurableInstrumentationPlugin,
  InvocationEndInfo,
  InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  DeterministicIdGenerator,
  deriveSpanIdFromOperationId,
  deriveTraceIdFromArn,
  deriveWorkflowSpanId,
} from "../deterministic-id-generator";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import {
  ProviderSource,
  type OtelPluginConfig,
  type TracerProviderFactory,
} from "../otel-plugin-config";
import { createTracerProvider } from "../otel-plugin-provider";

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

function workflowSpan(plugin: DurableInstrumentationPlugin): Span {
  return (plugin as unknown as { workflowSpan: Span }).workflowSpan;
}

function pluginProvider(plugin: DurableInstrumentationPlugin): TracerProvider {
  return (plugin as unknown as { tracerProvider: TracerProvider })
    .tracerProvider;
}

describe.each([
  ["ExecutionOtelPlugin", ExecutionOtelPlugin],
  ["InvocationOtelPlugin", InvocationOtelPlugin],
] as const)("%s ID generation isolation", (_name, Plugin) => {
  afterEach(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it.each([ProviderSource.GLOBAL, ProviderSource.EXPLICIT] as const)(
    "does not change unrelated roots for %s providers",
    async (source) => {
      let provider: NodeTracerProvider | undefined;
      let config: OtelPluginConfig;
      if (source === ProviderSource.GLOBAL) {
        provider = new NodeTracerProvider();
        provider.register();
        config = { providerSource: source };
      } else {
        config = {
          providerSource: source,
          tracerProviderFactory: (idGenerator) => {
            provider = new NodeTracerProvider({ idGenerator });
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

  it("does not change unrelated roots for the plugin-owned provider", async () => {
    const plugin = new Plugin({
      providerSource: ProviderSource.AUTO_OTLP,
      exporterConfig: { endpoint: "http://127.0.0.1:1/v1/traces" },
    });
    const provider = pluginProvider(plugin);
    const unrelatedTracer = provider.getTracer(INSTRUMENTATION_NAME);
    const before = unrelatedTracer.startSpan("before", undefined, ROOT_CONTEXT);

    await plugin.onInvocationStart(invocationInfo(EXECUTION_ARN_A));
    const workflow = workflowSpan(plugin);
    const during = unrelatedTracer.startSpan("during", undefined, ROOT_CONTEXT);
    const after = unrelatedTracer.startSpan("after", undefined, ROOT_CONTEXT);

    expect(
      new Set([
        before.spanContext().traceId,
        workflow.spanContext().traceId,
        during.spanContext().traceId,
        after.spanContext().traceId,
      ]),
    ).toHaveProperty("size", 4);
    expect(workflow.spanContext()).toMatchObject({
      traceId: deriveTraceIdFromArn(EXECUTION_ARN_A),
      spanId: deriveWorkflowSpanId(EXECUTION_ARN_A),
    });

    const ownedProvider = provider as NodeTracerProvider;
    await ownedProvider.shutdown();
  });

  it("keeps interleaved plugin instances scoped to their executions", async () => {
    let provider: NodeTracerProvider | undefined;
    const tracerProviderFactory: TracerProviderFactory = (idGenerator) => {
      provider ??= new NodeTracerProvider({ idGenerator });
      return provider;
    };
    const firstPlugin = new Plugin({
      providerSource: ProviderSource.EXPLICIT,
      tracerProviderFactory,
    });
    const secondPlugin = new Plugin({
      providerSource: ProviderSource.EXPLICIT,
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

describe("plugin-owned provider ID generator", () => {
  it("uses scoped deterministic IDs and random fallback IDs", async () => {
    const generator = new DeterministicIdGenerator();
    const { tracerProvider } = createTracerProvider(
      {
        providerSource: ProviderSource.AUTO_OTLP,
        exporterConfig: { endpoint: "http://127.0.0.1:1/v1/traces" },
      },
      generator,
    );
    const tracer = tracerProvider.getTracer(INSTRUMENTATION_NAME);
    const before = tracer.startSpan("before", undefined, ROOT_CONTEXT);
    const durable = generator.withIds(
      { traceId: "a".repeat(32), spanId: "1".repeat(16) },
      () => tracer.startSpan("durable", undefined, ROOT_CONTEXT),
    );
    const after = tracer.startSpan("after", undefined, ROOT_CONTEXT);

    expect(durable.spanContext()).toMatchObject({
      traceId: "a".repeat(32),
      spanId: "1".repeat(16),
    });
    expect(before.spanContext().traceId).not.toBe(
      durable.spanContext().traceId,
    );
    expect(after.spanContext().traceId).not.toBe(durable.spanContext().traceId);
    expect(after.spanContext().traceId).not.toBe(before.spanContext().traceId);

    await (tracerProvider as NodeTracerProvider).shutdown();
  });
});
