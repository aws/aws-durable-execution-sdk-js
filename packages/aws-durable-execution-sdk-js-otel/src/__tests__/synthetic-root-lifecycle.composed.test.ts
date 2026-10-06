import type {
  InvocationInfo,
  InvocationEndInfo,
} from "@aws/durable-execution-sdk-js";
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
  SamplingDecision,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan, Sampler } from "@opentelemetry/sdk-trace-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import { deriveExecutionRootSpanId } from "../deterministic-id-generator";
import type { ContextExtractor } from "../context-extractors";

const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:anchor:1/durable-execution/test/id";
const START = new Date("2026-09-29T00:00:00.123Z");
const TRACE = "12345678901234567890123456789012";
const start = (overrides: Partial<InvocationInfo> = {}): InvocationInfo => ({
  executionArn: ARN,
  requestId: "first",
  isFirstInvocation: true,
  executionStartTimestamp: new Date(START),
  executionInput: {},
  operations: {},
  updatedOperations: {},
  ...overrides,
});
const end = (
  info: InvocationInfo,
  status: InvocationEndInfo["status"],
): InvocationEndInfo => ({
  ...info,
  status,
  ...(status === "FAILED" && { executionError: new Error("terminal failure") }),
});
const roots = (exporter: InMemorySpanExporter) =>
  exporter.getFinishedSpans().filter((s) => s.name === "DurableExecutionRoot");
const workflows = (exporter: InMemorySpanExporter) =>
  exporter.getFinishedSpans().filter((s) => s.name === "Workflow");
const expectedTime = [
  Math.floor(START.getTime() / 1000),
  (START.getTime() % 1000) * 1_000_000,
];

// Every public span-content field, excluding the provider-owned resource envelope.
// Resources may describe different execution environments even for identical anchors.
function contents(span: ReadableSpan) {
  return {
    name: span.name,
    kind: span.kind,
    spanContext: span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    status: span.status,
    attributes: span.attributes,
    links: span.links,
    events: span.events,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    ended: span.ended,
    instrumentationScope: span.instrumentationScope,
  };
}

function assertAnchor(span: ReadableSpan) {
  expect(span.spanContext().spanId).toBe(deriveExecutionRootSpanId(ARN));
  expect(span.parentSpanContext).toBeUndefined();
  expect(span.startTime).toEqual(expectedTime);
  expect(span.endTime).toEqual(expectedTime);
  expect(span.duration).toEqual([0, 0]);
  expect(span.status).toEqual({ code: SpanStatusCode.UNSET });
  expect(span.attributes).toEqual({ "durable.execution.synthetic_root": true });
}

describe.each(
  [ExecutionOtelPlugin, InvocationOtelPlugin].map((Plugin) => ({
    name: Plugin.name,
    Plugin,
  })),
)("$name stable synthetic anchors", ({ Plugin }) => {
  const providers: NodeTracerProvider[] = [];
  function session(
    options: {
      batch?: boolean;
      sampler?: Sampler;
      extractor?: ContextExtractor;
      instance?: string;
    } = {},
  ) {
    const exporter = new InMemorySpanExporter();
    let provider!: NodeTracerProvider;
    const plugin = new Plugin({
      contextExtractor: options.extractor ?? (() => undefined),
      tracerProviderFactory: (createIdGenerator) => {
        provider = new NodeTracerProvider({
          idGenerator: createIdGenerator(),
          sampler: options.sampler ?? new AlwaysOnSampler(),
          resource: resourceFromAttributes({
            "faas.instance": options.instance ?? "default",
          }),
          spanProcessors: [
            options.batch
              ? new BatchSpanProcessor(exporter, {
                  scheduledDelayMillis: 60_000,
                })
              : new SimpleSpanProcessor(exporter),
          ],
        });
        providers.push(provider);
        return provider;
      },
    });
    return { exporter, provider, plugin };
  }
  afterEach(async () => {
    for (const provider of providers.splice(0)) await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it.each(["PENDING", "RETRYING"] as const)(
    "exports the first anchor before %s returns, with no Workflow",
    async (status) => {
      const { plugin, exporter } = session({ batch: true });
      const info = start();
      await plugin.onInvocationStart(info);
      expect(exporter.getFinishedSpans()).toHaveLength(0); // Batch timer has not run.
      await plugin.onInvocationEnd(end(info, status)); // Must flush without help from this test.
      expect(roots(exporter)).toHaveLength(1);
      assertAnchor(roots(exporter)[0]);
      expect(workflows(exporter)).toHaveLength(0);
      expect(
        exporter.getFinishedSpans().find((s) => s.name === "Invocation")
          ?.parentSpanContext?.spanId,
      ).toBe(roots(exporter)[0].spanContext().spanId);
      // A backend stop/timeout after suspension invokes no further SDK hook.
      // This already-exported ancestor remains available despite that missing terminal call.
    },
  );

  it.each(["SUCCEEDED", "FAILED"] as const)(
    "does not double-export when the first invocation ends %s",
    async (status) => {
      const { plugin, exporter } = session();
      const info = start();
      await plugin.onInvocationStart(info);
      expect(roots(exporter)).toHaveLength(1); // Ended before customer code can execute.
      await plugin.onInvocationEnd(end(info, status));
      expect(roots(exporter)).toHaveLength(1);
      assertAnchor(roots(exporter)[0]);
      expect(workflows(exporter)).toHaveLength(1);
      expect(
        workflows(exporter)[0].attributes["durable.execution.status"],
      ).toBe(status);
      expect(workflows(exporter)[0].status.code).toBe(
        status === "FAILED" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      );
    },
  );

  it("retries and terminal completion export identical SDK span content across execution environments", async () => {
    const copies: ReadableSpan[] = [];
    const stages = [
      { first: true, status: "RETRYING", instance: "one" },
      { first: true, status: "PENDING", instance: "two" },
      { first: false, status: "PENDING", instance: "three" },
      { first: false, status: "FAILED", instance: "four" },
    ] as const;
    for (const [index, stage] of stages.entries()) {
      const { plugin, exporter } = session({ instance: stage.instance });
      const info = start({
        isFirstInvocation: stage.first,
        requestId: `request-${index}`,
      });
      await plugin.onInvocationStart(info);
      await plugin.onInvocationEnd(end(info, stage.status));
      expect(roots(exporter)).toHaveLength(
        stage.first || stage.status === "FAILED" ? 1 : 0,
      );
      copies.push(...roots(exporter));
      if (stage.status === "FAILED") {
        expect(workflows(exporter)[0].parentSpanContext?.spanId).toBe(
          copies[0].spanContext().spanId,
        );
        expect(workflows(exporter)[0].status.code).toBe(SpanStatusCode.ERROR);
      }
    }
    expect(copies).toHaveLength(3);
    for (const span of copies) {
      assertAnchor(span);
      expect(contents(span)).toEqual(contents(copies[0]));
    }
    expect(
      copies.map((span) => span.resource.attributes["faas.instance"]),
    ).toEqual(["one", "two", "four"]);
  });

  it("uses a terminal backup when the first invocation never reached its flush", async () => {
    const first = session({ batch: true });
    await first.plugin.onInvocationStart(start());
    expect(first.exporter.getFinishedSpans()).toHaveLength(0);
    // No onInvocationEnd on the first instance, as with a killed invocation.
    const last = session({ batch: true });
    const info = start({ isFirstInvocation: false, requestId: "last" });
    await last.plugin.onInvocationStart(info);
    await last.plugin.onInvocationEnd(end(info, "SUCCEEDED"));
    expect(first.exporter.getFinishedSpans()).toHaveLength(0);
    expect(roots(last.exporter)).toHaveLength(1);
    assertAnchor(roots(last.exporter)[0]);
    expect(workflows(last.exporter)).toHaveLength(1);
  });

  it("retains terminal-only materialization when the backend start timestamp is absent", async () => {
    const { plugin, exporter } = session();
    const first = start({ executionStartTimestamp: undefined });
    await plugin.onInvocationStart(first);
    expect(roots(exporter)).toHaveLength(0);
    await plugin.onInvocationEnd(end(first, "PENDING"));
    expect(roots(exporter)).toHaveLength(0);
    const last = start({
      isFirstInvocation: false,
      requestId: "last",
      executionStartTimestamp: undefined,
    });
    await plugin.onInvocationStart(last);
    expect(roots(exporter)).toHaveLength(0);
    await plugin.onInvocationEnd(end(last, "SUCCEEDED"));
    expect(roots(exporter)).toHaveLength(1);
    expect(roots(exporter)[0].startTime).toEqual(
      workflows(exporter)[0].startTime,
    );
    expect(workflows(exporter)[0].parentSpanContext?.spanId).toBe(
      roots(exporter)[0].spanContext().spanId,
    );
  });

  it("snapshots the backend Date so input mutation cannot retime the anchor or Workflow", async () => {
    const { plugin, exporter } = session();
    const info = start();
    await plugin.onInvocationStart(info);
    info.executionStartTimestamp!.setTime(START.getTime() + 86_400_000);
    await plugin.onInvocationEnd(end(info, "SUCCEEDED"));
    assertAnchor(roots(exporter)[0]);
    expect(workflows(exporter)[0].startTime).toEqual(expectedTime);
  });

  it("keeps first anchors ARN-scoped when different executions share a propagated Root", async () => {
    const { plugin, exporter } = session({
      extractor: () => ({ traceId: TRACE, sampling: "SAMPLED" }),
    });
    for (const executionArn of [ARN, ARN + "-other"]) {
      const info = start({ executionArn });
      await plugin.onInvocationStart(info);
      await plugin.onInvocationEnd(end(info, "PENDING"));
    }
    expect(roots(exporter).map((span) => span.spanContext().spanId)).toEqual(
      [ARN, ARN + "-other"].map(deriveExecutionRootSpanId),
    );
    expect(
      new Set(roots(exporter).map((span) => span.spanContext().traceId)),
    ).toEqual(new Set([TRACE]));
  });

  it("never materializes a complete propagated remote parent", async () => {
    const parent = "1234567890123456";
    const { plugin, exporter } = session({
      extractor: () => ({
        traceId: TRACE,
        parentSpanId: parent,
        sampling: "SAMPLED",
      }),
    });
    const first = start();
    await plugin.onInvocationStart(first);
    await plugin.onInvocationEnd(end(first, "PENDING"));
    const last = start({ isFirstInvocation: false, requestId: "last" });
    await plugin.onInvocationStart(last);
    await plugin.onInvocationEnd(end(last, "SUCCEEDED"));
    expect(roots(exporter)).toHaveLength(0);
    expect(workflows(exporter)[0].parentSpanContext?.spanId).toBe(parent);
  });

  it.each(["SAMPLED", "NOT_SAMPLED"] as const)(
    "preserves upstream %s without an extra sampler query",
    async (sampling) => {
      const shouldSample = jest.fn(() => ({
        decision:
          sampling === "SAMPLED"
            ? SamplingDecision.NOT_RECORD
            : SamplingDecision.RECORD_AND_SAMPLED,
      }));
      const { plugin, exporter } = session({
        extractor: () => ({ traceId: TRACE, sampling }),
        sampler: { shouldSample, toString: () => "opposite policy" },
      });
      for (const [isFirstInvocation, status] of [
        [true, "PENDING"],
        [false, "SUCCEEDED"],
      ] as const) {
        const info = start({ isFirstInvocation });
        await plugin.onInvocationStart(info);
        await plugin.onInvocationEnd(end(info, status));
      }
      expect(shouldSample).not.toHaveBeenCalled();
      expect(roots(exporter)).toHaveLength(sampling === "SAMPLED" ? 2 : 0);
      expect(workflows(exporter)).toHaveLength(sampling === "SAMPLED" ? 1 : 0);
      if (sampling === "NOT_SAMPLED")
        expect(exporter.getFinishedSpans()).toHaveLength(0);
    },
  );

  it.each([0, 1])(
    "keeps a deterministic ratio policy (%s) consistent across boundaries",
    async (ratio) => {
      const policy = new TraceIdRatioBasedSampler(ratio);
      const shouldSample = jest.spyOn(policy, "shouldSample");
      const { plugin, exporter } = session({ sampler: policy });
      for (const [isFirstInvocation, status] of [
        [true, "PENDING"],
        [false, "SUCCEEDED"],
      ] as const) {
        const info = start({ isFirstInvocation });
        await plugin.onInvocationStart(info);
        await plugin.onInvocationEnd(end(info, status));
      }
      expect(shouldSample).toHaveBeenCalledTimes(2);
      expect(roots(exporter)).toHaveLength(ratio === 1 ? 2 : 0);
      if (ratio === 1)
        expect(contents(roots(exporter)[0])).toEqual(
          contents(roots(exporter)[1]),
        );
    },
  );

  it.each([false, true])(
    "does not persist or independently resample a changing root policy (first sampled=%s)",
    async (sampledFirst) => {
      let calls = 0;
      const shouldSample = jest.fn(() => ({
        decision:
          (++calls === 1) === sampledFirst
            ? SamplingDecision.RECORD_AND_SAMPLED
            : SamplingDecision.NOT_RECORD,
      }));
      const { plugin, exporter } = session({
        sampler: { shouldSample, toString: () => "alternating policy" },
      });
      for (const [isFirstInvocation, status] of [
        [true, "PENDING"],
        [false, "SUCCEEDED"],
      ] as const) {
        const info = start({ isFirstInvocation });
        await plugin.onInvocationStart(info);
        await plugin.onInvocationEnd(end(info, status));
      }
      expect(shouldSample).toHaveBeenCalledTimes(2);
      expect(roots(exporter)).toHaveLength(1);
      assertAnchor(roots(exporter)[0]);
      expect(workflows(exporter)).toHaveLength(sampledFirst ? 0 : 1);
    },
  );

  it("does not export an anchor for a RECORD_ONLY execution", async () => {
    const { plugin, exporter } = session({
      sampler: {
        shouldSample: () => ({ decision: SamplingDecision.RECORD }),
        toString: () => "record only",
      },
    });
    const info = start();
    await plugin.onInvocationStart(info);
    await plugin.onInvocationEnd(end(info, "PENDING"));
    expect(roots(exporter)).toHaveLength(0);
  });

  it("ends the same stable anchor through a globally registered provider", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    providers.push(provider);
    provider.register();
    const plugin = new Plugin({ contextExtractor: () => undefined });
    const info = start();
    await plugin.onInvocationStart(info);
    expect(roots(exporter)).toHaveLength(1);
    await plugin.onInvocationEnd(end(info, "PENDING"));
    expect(roots(exporter)).toHaveLength(1);
    assertAnchor(roots(exporter)[0]);
    expect(workflows(exporter)).toHaveLength(0);
  });
});
