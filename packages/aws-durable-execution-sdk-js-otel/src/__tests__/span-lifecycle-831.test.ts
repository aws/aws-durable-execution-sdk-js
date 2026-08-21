/**
 * Regression coverage for issue #831: every recording span must be ended
 * exactly once, including on non-terminal (PENDING/RETRYING) invocations, and
 * no two exported spans may share a `(traceId, spanId)`.
 *
 * These run against BOTH plugins through the globally-registered provider,
 * matching the integration-test harness.
 */
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  InMemorySpanExporter,
  NodeTracerProvider,
  ParentBasedSampler,
  SamplingDecision,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { ReadableSpan, Sampler } from "@opentelemetry/sdk-trace-node";
import { context, propagation, trace, TraceFlags } from "@opentelemetry/api";
import type { Attributes, Span } from "@opentelemetry/api";
import type {
  InvocationInfo,
  InvocationEndInfo,
  OperationInfo,
  OperationEndInfo,
  AttemptInfo,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

const ARN = "arn:aws:states:us-east-1:123456789012:execution:sm:exec-1";

function makeInvocationInfo(o?: Partial<InvocationInfo>): InvocationInfo {
  return {
    requestId: "req-1",
    executionArn: ARN,
    isFirstInvocation: true,
    executionInput: {},
    operations: {},
    updatedOperations: {},
    ...o,
  };
}

function makeInvocationEndInfo(
  o?: Partial<InvocationEndInfo>,
): InvocationEndInfo {
  return {
    requestId: "req-1",
    executionArn: ARN,
    executionInput: {},
    operations: {},
    status: "SUCCEEDED" as any,
    ...o,
  };
}

function makeOperationInfo(o?: Partial<OperationInfo>): OperationInfo {
  return { id: "op-1", type: "STEP" as any, isReplay: false, ...o };
}

function makeOperationEndInfo(o?: Partial<OperationEndInfo>): OperationEndInfo {
  return { id: "op-1", type: "STEP" as any, isReplay: false, ...o };
}

function makeAttemptInfo(o?: Partial<AttemptInfo>): AttemptInfo {
  return { id: "op-1", type: "STEP" as any, isReplay: false, attempt: 1, ...o };
}

/** Exported identities appearing more than once, as `traceId:spanId`. */
function duplicateIdentities(exporter: InMemorySpanExporter): string[] {
  const counts = new Map<string, number>();
  for (const s of exporter.getFinishedSpans()) {
    const k = `${s.spanContext().traceId}:${s.spanContext().spanId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

function named(exporter: InMemorySpanExporter, name: string): ReadableSpan[] {
  return exporter.getFinishedSpans().filter((s) => s.name === name);
}

const PLUGINS = [
  ["ExecutionOtelPlugin", () => new ExecutionOtelPlugin({})],
  ["InvocationOtelPlugin", () => new InvocationOtelPlugin({})],
] as const;

describe.each(PLUGINS)("%s span lifecycle (#831)", (_name, makePlugin) => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  function register(sampler?: Sampler) {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      ...(sampler ? { sampler } : {}),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  }

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it.each(["PENDING", "RETRYING"])(
    "leaves no recording Workflow span on non-terminal status %s",
    async (status) => {
      register();
      const plugin: any = makePlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      const workflowRef = plugin.workflowSpan as Span;
      expect(workflowRef.isRecording()).toBe(false); // non-recording identity

      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: status as any }),
      );

      expect(workflowRef.isRecording()).toBe(false);
      expect(named(exporter, "Workflow")).toHaveLength(0);
    },
  );

  it("exports exactly one Workflow span across a suspend/resume pair", async () => {
    register();
    const plugin: any = makePlugin();

    // Invocation 1 suspends.
    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "PENDING" as any }),
    );

    // Invocation 2 (same ARN) completes.
    await plugin.onInvocationStart(
      makeInvocationInfo({ isFirstInvocation: false }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    const workflow = named(exporter, "Workflow");
    expect(workflow).toHaveLength(1);
    expect(workflow[0].attributes["durable.execution.status"]).toBe(
      "SUCCEEDED",
    );
    expect(duplicateIdentities(exporter)).toEqual([]);
  });

  it("ends an in-flight attempt span left open by a non-terminal invocation", async () => {
    register();
    const plugin: any = makePlugin();

    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(makeOperationInfo({ name: "retry-step" }));
    await plugin.onOperationAttemptStart(
      makeAttemptInfo({ name: "retry-step", attempt: 1 }),
    );

    // Retain the attempt span reference before spanMap is cleared.
    const spanMap = plugin.spanMap as Map<string, Span>;
    const attemptRef = [...spanMap.entries()].find(([k]) =>
      k.includes("attempt"),
    )?.[1];
    expect(attemptRef?.isRecording()).toBe(true);

    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "PENDING" as any }),
    );

    expect(attemptRef?.isRecording()).toBe(false);
    const attempt = named(exporter, "retry-step attempt 1");
    expect(attempt).toHaveLength(1);
    // No outcome: the attempt never completed this invocation.
    expect(attempt[0].attributes["durable.attempt.outcome"]).toBeUndefined();
  });

  it("gives a suspended WAIT and its later completion distinct identities", async () => {
    register();
    const plugin: any = makePlugin();

    // Invocation 1: WAIT starts, then the invocation suspends.
    await plugin.onInvocationStart(makeInvocationInfo());
    await plugin.onOperationStart(
      makeOperationInfo({ id: "w1", type: "WAIT" as any, name: "my-wait" }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "PENDING" as any }),
    );

    // Invocation 2: WAIT resolves (cross-invocation completion).
    await plugin.onInvocationStart(
      makeInvocationInfo({ isFirstInvocation: false }),
    );
    await plugin.onOperationEnd(
      makeOperationEndInfo({
        id: "w1",
        type: "WAIT" as any,
        name: "my-wait",
        status: "SUCCEEDED" as any,
      }),
    );
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
    );

    expect(duplicateIdentities(exporter)).toEqual([]);
    expect(
      named(exporter, "my-wait").some(
        (s) => s.attributes["durable.operation.status"] === "SUCCEEDED",
      ),
    ).toBe(true);
  });

  it("keeps identities unique for a STEP retried across three invocations", async () => {
    register();
    const plugin: any = makePlugin();

    for (let i = 1; i <= 3; i++) {
      const base = {
        id: "s1",
        type: "STEP" as any,
        name: "retry-step",
        isReplay: i > 1,
      };
      await plugin.onInvocationStart(
        makeInvocationInfo({ isFirstInvocation: i === 1 }),
      );
      await plugin.onOperationStart(makeOperationInfo(base));
      await plugin.onOperationAttemptStart(
        makeAttemptInfo({ ...base, attempt: i }),
      );
      await plugin.onOperationAttemptEnd({
        ...base,
        attempt: i,
        outcome: (i === 3 ? "SUCCEEDED" : "FAILED") as any,
      });
      if (i === 3) {
        await plugin.onOperationEnd(
          makeOperationEndInfo({
            ...base,
            isReplay: false,
            status: "SUCCEEDED" as any,
            attempt: 3,
          }),
        );
      }
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({
          status: (i === 3 ? "SUCCEEDED" : "RETRYING") as any,
        }),
      );
    }

    expect(duplicateIdentities(exporter)).toEqual([]);
  });

  it("keeps a non-negative Workflow duration when executionStartTimestamp is omitted", async () => {
    register();
    const plugin: any = makePlugin();

    await plugin.onInvocationStart(
      makeInvocationInfo({ executionStartTimestamp: undefined }),
    );
    // A real gap so a late fallback would be measurable (Date is ms-truncated).
    await new Promise((r) => setTimeout(r, 15));
    await plugin.onInvocationEnd(
      makeInvocationEndInfo({
        status: "SUCCEEDED" as any,
        executionStartTimestamp: undefined,
      }),
    );

    const workflow = named(exporter, "Workflow")[0];
    const invocation = named(exporter, "Invocation")[0];
    expect(workflow).toBeDefined();
    expect(invocation).toBeDefined();
    // The Workflow span must contain the invocation it covers; a late fallback
    // would start it after the invocation span began.
    const cmp = (a: ReadableSpan["startTime"], b: ReadableSpan["startTime"]) =>
      a[0] - b[0] || a[1] - b[1];
    expect(cmp(workflow.startTime, invocation.startTime)).toBeLessThanOrEqual(
      0,
    );
    expect(cmp(workflow.endTime, workflow.startTime)).toBeGreaterThanOrEqual(0);
  });

  describe("sampling", () => {
    it("marks the Workflow context unsampled and exports nothing under an unsampled provider", async () => {
      register(new ParentBasedSampler({ root: new AlwaysOffSampler() }));
      const plugin: any = makePlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      expect(plugin.workflowSpan.spanContext().traceFlags).toBe(
        TraceFlags.NONE,
      );

      await plugin.onOperationStart(makeOperationInfo());
      await plugin.onOperationEnd(
        makeOperationEndInfo({ status: "SUCCEEDED" as any }),
      );
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it("reports otelTraceSampled false from enrichLogContext under an unsampled provider", async () => {
      register(new ParentBasedSampler({ root: new AlwaysOffSampler() }));
      const plugin: any = makePlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      const enriched = await plugin.wrapInvocation(
        makeInvocationInfo(),
        async () => plugin.enrichLogContext(),
      );
      expect(enriched?.otelTraceSampled).toBe(false);
      await plugin.onInvocationEnd(makeInvocationEndInfo());
    });

    it("exports the Workflow root under a sampled provider (control)", async () => {
      register(new ParentBasedSampler({ root: new AlwaysOnSampler() }));
      const plugin: any = makePlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      expect(plugin.workflowSpan.spanContext().traceFlags).toBe(
        TraceFlags.SAMPLED,
      );
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );
      expect(named(exporter, "Workflow")).toHaveLength(1);
    });

    it("passes the Workflow attributes to an attribute-based sampler", async () => {
      const seen: Attributes[] = [];
      const sampler: Sampler = {
        shouldSample: (_c, _t, _n, _k, attributes) => {
          seen.push({ ...attributes });
          return {
            decision: attributes["durable.execution.arn"]
              ? SamplingDecision.RECORD_AND_SAMPLED
              : SamplingDecision.NOT_RECORD,
          };
        },
        toString: () => "ArnAttributeSampler",
      };
      register(sampler);
      const plugin: any = makePlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );

      // Every root sampling call saw durable.execution.arn, so the synthetic
      // context and the real span reach the same decision.
      const rootCalls = seen.filter(
        (a) => a["durable.execution.arn"] !== undefined,
      );
      expect(rootCalls.length).toBeGreaterThanOrEqual(1);
      expect(named(exporter, "Workflow")).toHaveLength(1);
    });

    it("does not export a Workflow root a stateful sampler dropped for children", async () => {
      let calls = 0;
      const sampler: Sampler = {
        // Samples the first root it sees, drops everything after.
        shouldSample: () => {
          calls += 1;
          return {
            decision:
              calls === 1
                ? SamplingDecision.RECORD_AND_SAMPLED
                : SamplingDecision.NOT_RECORD,
          };
        },
        toString: () => "FirstOnlySampler",
      };
      sampler.shouldSample(null as any, "", "", 0 as any, {}, []); // burn the one sampled decision before the plugin runs
      register(sampler);
      const plugin: any = makePlugin();

      await plugin.onInvocationStart(makeInvocationInfo());
      expect(plugin.workflowSpan.spanContext().traceFlags).toBe(
        TraceFlags.NONE,
      );
      await plugin.onInvocationEnd(
        makeInvocationEndInfo({ status: "SUCCEEDED" as any }),
      );
      expect(named(exporter, "Workflow")).toHaveLength(0);
    });
  });
});
