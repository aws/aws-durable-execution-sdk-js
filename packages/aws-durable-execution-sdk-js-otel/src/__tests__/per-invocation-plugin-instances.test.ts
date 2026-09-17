/**
 * Two concurrent executions in one execution environment, driven through the
 * SDK's per-invocation plugin materialization.
 *
 * The plugins in this package hold the execution ARN, the execution trace
 * identity, the Workflow and Invocation spans, and maps keyed by operation ID —
 * and an operation ID is unique only within one execution. One instance serving
 * two executions at once therefore has the second overwrite the first, which
 * Lambda Managed Instances makes routine and which the plugin cannot fix on its
 * own (the operation hooks carry no execution identity). These tests pin the fix
 * from the plugin's side: the provider *is* a per-invocation factory, so the
 * state above is per-invocation by construction, while the tracer provider,
 * tracer, deterministic ID generator and sampler stay shared and are installed
 * once.
 *
 * The factory is called directly here rather than through the SDK's own
 * per-invocation materialization: the `@aws/durable-execution-sdk-js` build
 * resolvable from this package predates the factory contract, so driving it
 * would silently exercise an SDK that ignores the factory, and importing its
 * sources across the package boundary pulls that package's files into this
 * package's type program. That the SDK calls a configured factory exactly once
 * per invocation, and dispatches only that invocation's hooks to the instance it
 * returns, is covered in the SDK package itself; what is asserted here is what
 * the plugin does once it is given one instance per invocation. The provider's
 * declared type (`DurableInstrumentationPluginFactory`) is what ties the two
 * together at compile time.
 */
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { context, propagation, trace, TraceFlags } from "@opentelemetry/api";
import type {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationEndInfo,
  InvocationInfo,
  OperationEndInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  deriveSpanIdFromOperationId,
  deriveTraceIdFromArn,
  deriveWorkflowSpanId,
} from "../deterministic-id-generator";
import {
  createExecutionOtelPluginFactory,
  ExecutionOtelPlugin,
} from "../execution-plugin";
import {
  createInvocationOtelPluginFactory,
  InvocationOtelPlugin,
} from "../invocation-plugin";
import { durableExecutionPluginProvider as executionProvider } from "../execution-plugin-provider";
import { durableExecutionPluginProvider as invocationProvider } from "../invocation-plugin-provider";
import type { OtelPluginConfig } from "../otel-plugin-config";
import { OtelPluginEnvironment } from "../otel-plugin-environment";

const EXECUTION_START = new Date("2024-01-01T00:00:00.000Z");
const OPERATION_ID = "shared-operation-id";

const arnFor = (name: string): string =>
  `arn:aws:lambda:us-east-1:123456789012:function:my-func:$LATEST:${name}`;
const ARN_A = arnFor("execution-a");
const ARN_B = arnFor("execution-b");

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

function operationInfo(): OperationInfo {
  return {
    id: OPERATION_ID,
    name: "the-step",
    type: "STEP",
    isReplay: false,
    startTimestamp: EXECUTION_START,
  };
}

function operationEndInfo(): OperationEndInfo {
  return {
    ...operationInfo(),
    status: "SUCCEEDED",
    endTimestamp: new Date(EXECUTION_START.getTime() + 1_000),
  };
}

/** One durable invocation: everything the SDK dispatches between the two ends. */
interface Invocation {
  start(): Promise<void>;
  operation(): Promise<void>;
  end(): Promise<void>;
}

/**
 * Drives one invocation over `plugin`, passing the same {@link InvocationInfo}
 * object the plugin was built from — which is what the SDK does.
 */
function invocationOver(
  plugin: DurableInstrumentationPlugin,
  info: InvocationInfo,
): Invocation {
  return {
    start: async () => {
      await plugin.onInvocationStart?.(info);
    },
    operation: async () => {
      await plugin.onOperationStart?.(operationInfo());
      await plugin.onOperationEnd?.(operationEndInfo());
    },
    end: async () => {
      await plugin.onInvocationEnd?.(invocationEndInfo(info.executionArn));
    },
  };
}

/**
 * The invocation the SDK would run for one durable invocation: a fresh plugin
 * instance materialized from the configured factory, from that invocation's own
 * info, before the first hook.
 */
function sdkInvocation(
  factory: DurableInstrumentationPluginFactory,
  executionArn: string,
): Invocation {
  const info = invocationInfo(executionArn);
  return invocationOver(factory(info), info);
}

const spansNamed = (spans: readonly ReadableSpan[], name: string) =>
  spans.filter((span) => span.name === name);

const arnOf = (span: ReadableSpan) =>
  span.attributes["durable.execution.arn"] as string;

const soleSpanFor = (
  spans: readonly ReadableSpan[],
  name: string,
  executionArn: string,
): ReadableSpan => {
  const matching = spansNamed(spans, name).filter(
    (span) => arnOf(span) === executionArn,
  );
  expect(matching).toHaveLength(1);
  return matching[0];
};

describe.each([
  [
    "ExecutionOtelPlugin",
    executionProvider,
    createExecutionOtelPluginFactory,
    ExecutionOtelPlugin,
  ],
  [
    "InvocationOtelPlugin",
    invocationProvider,
    createInvocationOtelPluginFactory,
    InvocationOtelPlugin,
  ],
] as const)(
  "%s under two concurrent executions",
  (pluginName, provider, createFactory, Plugin) => {
    afterEach(() => {
      trace.disable();
      context.disable();
      propagation.disable();
    });

    it("keeps each execution's spans on its own trace when the SDK drives the provider", async () => {
      const exporter = new InMemorySpanExporter();
      const tracerProvider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      tracerProvider.register();

      // The provider is a valid plugin source exactly as the SDK's loader
      // classifies it: a callable the SDK invokes once per invocation, never a
      // shared instance.
      expect(typeof provider).toBe("function");
      const a = sdkInvocation(provider, ARN_A);
      const b = sdkInvocation(provider, ARN_B);

      // Interleaved: B starts while A is still in flight, and they finish in
      // start order. With one shared instance, A's identity is gone by the time
      // A ends and only B's spans are exported.
      await a.start();
      await b.start();
      await a.operation();
      await b.operation();
      await a.end();
      await b.end();

      const spans = exporter.getFinishedSpans();

      // Each execution gets its own Workflow and Invocation span...
      expect(spansNamed(spans, "Workflow")).toHaveLength(2);
      expect(spansNamed(spans, "Invocation")).toHaveLength(2);
      expect(new Set(spansNamed(spans, "Invocation").map(arnOf))).toEqual(
        new Set([ARN_A, ARN_B]),
      );

      // ...on its own trace, with the identity derived from its own ARN.
      for (const executionArn of [ARN_A, ARN_B]) {
        const expectedTraceId = deriveTraceIdFromArn(
          executionArn,
          EXECUTION_START,
        );
        const workflow = soleSpanFor(spans, "Workflow", executionArn);
        expect(workflow.spanContext()).toMatchObject({
          traceId: expectedTraceId,
          spanId: deriveWorkflowSpanId(executionArn),
        });
        expect(
          soleSpanFor(spans, "Invocation", executionArn).spanContext().traceId,
        ).toBe(expectedTraceId);
      }

      // Both executions ran the same operation ID. Its span must still be
      // scoped per execution: same key, different span, different trace.
      const operationSpans = spansNamed(spans, "the-step");
      expect(operationSpans).toHaveLength(2);
      for (const executionArn of [ARN_A, ARN_B]) {
        const operation = soleSpanFor(spans, "the-step", executionArn);
        expect(operation.attributes["durable.operation.id"]).toBe(OPERATION_ID);
        expect(operation.spanContext()).toMatchObject({
          traceId: deriveTraceIdFromArn(executionArn, EXECUTION_START),
          spanId: deriveSpanIdFromOperationId(OPERATION_ID, executionArn),
        });
      }
      const operationSpanIds = operationSpans.map(
        (span) => span.spanContext().spanId,
      );
      expect(new Set(operationSpanIds).size).toBe(2);

      // Nothing crossed over: every span carries one ARN and one trace ID.
      for (const span of spans) {
        expect(span.spanContext().traceId).toBe(
          deriveTraceIdFromArn(arnOf(span), EXECUTION_START),
        );
      }

      await tracerProvider.shutdown();
    });

    it("derives the same IDs and the same sampling decisions as one instance per execution", async () => {
      // A sampler whose decision depends only on the trace ID, which is itself
      // derived from the execution ARN. If per-invocation instances changed
      // either the derived IDs or which executions sample, the two phases below
      // would disagree.
      const exporter = new InMemorySpanExporter();
      let tracerProvider: NodeTracerProvider | undefined;
      const config: OtelPluginConfig = {
        tracerProviderFactory: (createIdGenerator) => {
          tracerProvider ??= new NodeTracerProvider({
            idGenerator: createIdGenerator(),
            sampler: new ParentBasedSampler({
              root: new TraceIdRatioBasedSampler(0.5),
            }),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          });
          return tracerProvider;
        },
      };
      const executionArns = Array.from({ length: 12 }, (_, index) =>
        arnFor(`sampling-${index}`),
      );

      // Per execution: which spans were exported, on which trace, with which
      // sampled bit, and — for the spans whose IDs are derived rather than
      // generated — which span ID. The Invocation span's ID has never been
      // deterministic (it comes from the tracer's ID generator), so only its
      // presence, trace and sampled bit are compared.
      const fingerprint = (
        spans: readonly ReadableSpan[],
      ): Record<string, string[]> => {
        const byArn: Record<string, string[]> = {};
        for (const executionArn of executionArns) {
          byArn[executionArn] = spans
            .filter((span) => arnOf(span) === executionArn)
            .map((span) => {
              const spanContext = span.spanContext();
              const deterministicSpanId =
                span.name === "Invocation" ? "<generated>" : spanContext.spanId;
              return [
                span.name,
                spanContext.traceId,
                deterministicSpanId,
                (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0,
              ].join("|");
            })
            .sort();
        }
        return byArn;
      };

      // Phase 1 — the baseline: one instance and one environment per execution,
      // run to completion before the next one starts. This is the only
      // arrangement in which a single instance is correct, so it is what the
      // shared-environment, interleaved path has to reproduce.
      for (const executionArn of executionArns) {
        const info = invocationInfo(executionArn);
        const invocation = invocationOver(
          new Plugin(new OtelPluginEnvironment(config), info),
          info,
        );
        await invocation.start();
        await invocation.operation();
        await invocation.end();
      }
      const baseline = fingerprint(exporter.getFinishedSpans());
      exporter.reset();

      // Phase 2 — the factory path, with every execution interleaved through one
      // shared environment.
      const factory = createFactory(config);
      const invocations = executionArns.map((executionArn) =>
        sdkInvocation(factory, executionArn),
      );
      await Promise.all(invocations.map((invocation) => invocation.start()));
      await Promise.all(
        invocations.map((invocation) => invocation.operation()),
      );
      await Promise.all(invocations.map((invocation) => invocation.end()));
      const perInvocation = fingerprint(exporter.getFinishedSpans());

      expect(perInvocation).toEqual(baseline);

      // The comparison is only meaningful if the sampler actually dropped some
      // executions and kept others.
      // A dropped execution exports nothing at all.
      const exported = executionArns.filter(
        (executionArn) => baseline[executionArn].length > 0,
      );
      expect(exported.length).toBeGreaterThan(0);
      expect(exported.length).toBeLessThan(executionArns.length);

      await tracerProvider?.shutdown();
    });

    it("resolves the tracer provider and installs the ID generator once for all invocations", async () => {
      const exporter = new InMemorySpanExporter();
      let tracerProvider: NodeTracerProvider | undefined;
      const tracerProviderFactory = jest.fn((createIdGenerator) => {
        tracerProvider ??= new NodeTracerProvider({
          idGenerator: createIdGenerator(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        return tracerProvider;
      });
      const factory = createFactory({
        tracerProviderFactory,
      } as OtelPluginConfig);

      const created: DurableInstrumentationPlugin[] = [];
      for (const executionArn of [ARN_A, ARN_B, arnFor("execution-c")]) {
        const info = invocationInfo(executionArn);
        const plugin = factory(info);
        created.push(plugin);
        const invocation = invocationOver(plugin, info);
        await invocation.start();
        await invocation.end();
      }

      // Expensive, install-once work happened once, in the factory closure...
      expect(tracerProviderFactory).toHaveBeenCalledTimes(1);
      // ...while the per-invocation state lives on three distinct instances.
      expect(new Set(created).size).toBe(3);
      for (const plugin of created) {
        expect(plugin.constructor.name).toBe(pluginName);
      }

      await tracerProvider?.shutdown();
    });

    it("hands out a new instance per invocation, with no instance path to share", async () => {
      // The provider itself is the factory: there is no createPlugin to call, so
      // an instance cannot be obtained and then reused for a second execution.
      // Only instance identity is asserted here — the provider's environment is
      // resolved once, on its first use, which is what makes it a poor subject
      // for span assertions and exactly why the spans are checked above through
      // the provider's first use and through fresh factories.
      expect(typeof provider).toBe("function");

      const infoA = invocationInfo(ARN_A);
      const infoB = invocationInfo(ARN_B);
      const pluginA = provider(infoA);
      const pluginB = provider(infoB);
      expect(pluginA).toBeInstanceOf(Plugin);
      expect(pluginB).toBeInstanceOf(Plugin);
      expect(pluginA).not.toBe(pluginB);

      // Calling the factory twice for the same execution is still two
      // instances: nothing is memoized, per execution ARN or otherwise.
      expect(provider(infoA)).not.toBe(pluginA);
    });
  },
);
