import { afterEach, describe, expect, it, vi } from "vitest";
import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type Sampler,
} from "@opentelemetry/sdk-trace-node";
import type { InvocationInfo } from "@aws/durable-execution-sdk-js";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";
import { getConfiguredSampler } from "../global-sampler";
import { parseXRayTraceHeader } from "../context-extractors";
import { DeterministicIdGenerator } from "../deterministic-id-generator";

const traceId = "00000001000000000000000000000000";
const parentId = "1234567890abcdef";
const root = `Root=${traceId}`;
const info: InvocationInfo = {
  requestId: "request",
  executionArn:
    "arn:aws:lambda:us-east-1:123:function:test:1/durable/sampling/1",
  executionInput: {},
  executionStartTimestamp: new Date("2026-01-01T00:00:00Z"),
  operations: {},
  updatedOperations: {},
  isFirstInvocation: true,
};

// The last three columns have no usable parent, even when Sampled is present.
const parents = [
  { name: "sampled", header: `${root};Parent=${parentId};Sampled=1` },
  { name: "not sampled", header: `${root};Parent=${parentId};Sampled=0` },
  { name: "unset bit", header: `${root};Parent=${parentId}` },
  { name: "root only", header: `${root};Sampled=0` },
  {
    name: "invalid parent",
    header: `${root};Parent=0000000000000000;Sampled=0`,
  },
  { name: "absent", header: undefined },
] as const;

const policies = [
  { name: "always_on", expected: [true, true, true, true, true, true] },
  { name: "always_off", expected: [false, false, false, false, false, false] },
  {
    name: "traceidratio",
    ratio: "0",
    expected: [false, false, false, false, false, false],
  },
  {
    name: "traceidratio",
    ratio: "1",
    expected: [true, true, true, true, true, true],
  },
  {
    name: "parentbased_always_on",
    expected: [true, false, false, true, true, true],
  },
  {
    name: "parentbased_always_off",
    expected: [true, false, false, false, false, false],
  },
  {
    name: "parentbased_traceidratio",
    ratio: "0",
    expected: [true, false, false, false, false, false],
  },
  {
    name: "parentbased_traceidratio",
    ratio: "1",
    expected: [true, false, false, true, true, true],
  },
  { name: undefined, expected: [true, false, false, true, true, true] },
  { name: "invalid-policy", expected: [true, false, false, true, true, true] },
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  trace.disable();
  context.disable();
  propagation.disable();
});

describe.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s configured sampling", (_view, createFactory) => {
  async function run(
    header: string | undefined,
    global: boolean,
    sampler?: Sampler,
  ) {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      idGenerator: new DeterministicIdGenerator(),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
      ...(sampler ? { sampler } : {}),
    });
    const shutdown = vi.spyOn(provider, "shutdown");
    if (global) provider.register();
    const plugin = createFactory({
      ...(!global ? { tracerProviderFactory: () => provider } : {}),
    }).createPlugin(info);
    try {
      const invocation = { ...info, xRayTraceId: header ?? "" };
      await plugin.onInvocationStart(invocation);
      const operation = {
        id: "step",
        name: "work",
        type: "STEP",
        isReplay: false,
      };
      await plugin.onOperationStart(operation);
      await plugin.onOperationAttemptStart({ ...operation, attempt: 1 });
      await plugin.onOperationAttemptEnd({
        ...operation,
        attempt: 1,
        outcome: "SUCCEEDED",
      });
      await plugin.onOperationEnd({ ...operation, status: "SUCCEEDED" });
      await plugin.onInvocationEnd({ ...invocation, status: "SUCCEEDED" });
      expect(shutdown).not.toHaveBeenCalled();
      if (sampler) {
        expect(getConfiguredSampler(provider.getTracer("application"))).toBe(
          sampler,
        );
      }
      return exporter.getFinishedSpans();
    } finally {
      await provider.shutdown();
    }
  }

  describe.each([false, true])("global provider=%s", (global) => {
    it.each(
      policies.flatMap((policy) =>
        parents.map((parent, index) => ({
          policy: policy.name,
          ratio: "ratio" in policy ? policy.ratio : undefined,
          parent: parent.name,
          header: parent.header,
          sampled: policy.expected[index],
        })),
      ),
    )(
      "$policy ratio=$ratio parent=$parent",
      async ({ policy, ratio, header, sampled }) => {
        vi.stubEnv("OTEL_TRACES_SAMPLER", policy);
        vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", ratio);
        const spans = await run(header, global);
        if (!sampled) {
          expect(spans).toHaveLength(0);
          return;
        }
        expect(spans.map((span) => span.name)).toEqual(
          expect.arrayContaining([
            "Workflow",
            "Invocation",
            "work",
            "work attempt 1",
          ]),
        );
        expect(
          spans.every((span) => (span.spanContext().traceFlags & 1) === 1),
        ).toBe(true);
        if (header)
          expect(
            spans.every((span) => span.spanContext().traceId === traceId),
          ).toBe(true);
        const extracted = parseXRayTraceHeader(header);
        expect(spans.some((span) => span.name === "DurableExecutionRoot")).toBe(
          !extracted?.parentSpanId,
        );
      },
    );

    it.each([undefined, "", "invalid", "-1", "2"])(
      "uses provider ratio validation for %s",
      async (ratio) => {
        vi.stubEnv("OTEL_TRACES_SAMPLER", "traceidratio");
        vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", ratio);
        const spans = await run(parents[1].header, global);
        // The supported SDK defaults a missing/invalid/out-of-range ratio to 1.
        expect(spans.map((span) => span.name)).toContain("Workflow");
      },
    );

    it.each([
      {
        env: "always_off",
        sampler: new AlwaysOnSampler(),
        parent: parents[1],
        sampled: true,
      },
      {
        env: "always_on",
        sampler: new AlwaysOffSampler(),
        parent: parents[0],
        sampled: false,
      },
    ])(
      "explicit $sampler overrides $env",
      async ({ env, sampler, parent, sampled }) => {
        vi.stubEnv("OTEL_TRACES_SAMPLER", env);
        const spans = await run(parent.header, global, sampler);
        expect(spans.some((span) => span.name === "Workflow")).toBe(sampled);
      },
    );
  });

  it("rejects a dropped same-trace handler and retains the complete propagated parent", async () => {
    vi.stubEnv("OTEL_TRACES_SAMPLER", "always_on");
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const droppedProvider = new NodeTracerProvider({
      sampler: new AlwaysOffSampler(),
    });
    provider.register();
    const remote = { traceId, spanId: parentId, traceFlags: 0, isRemote: true };
    const dropped = droppedProvider
      .getTracer("adot")
      .startSpan("handler", {}, trace.setSpanContext(ROOT_CONTEXT, remote));
    const plugin = createFactory().createPlugin(info);
    try {
      expect(dropped.isRecording()).toBe(false);
      await context.with(trace.setSpan(ROOT_CONTEXT, dropped), async () => {
        await plugin.onInvocationStart({
          ...info,
          xRayTraceId: parents[1].header,
        });
        await plugin.onInvocationEnd({ ...info, status: "SUCCEEDED" });
      });
      const spans = exporter.getFinishedSpans();
      expect(spans.map((span) => span.name).sort()).toEqual([
        "Invocation",
        "Workflow",
      ]);
      for (const span of spans) {
        expect(span.parentSpanContext?.spanId).toBe(parentId);
        expect(span.parentSpanContext?.spanId).not.toBe(
          dropped.spanContext().spanId,
        );
      }
      expect(trace.getSpan(context.active())).toBeUndefined();
    } finally {
      dropped.end();
      await droppedProvider.shutdown();
      await provider.shutdown();
    }
  });
});
