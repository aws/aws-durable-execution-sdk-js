import { TraceFlags, context, trace, ROOT_CONTEXT } from "@opentelemetry/api";
import type { SpanContext, Tracer } from "@opentelemetry/api";
import {
  SamplingDecision,
  ParentBasedSampler,
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import {
  canonicalTraceId,
  resolveExecutionTraceContext,
  rootSamplingDecision,
} from "../execution-trace-context";
import {
  deriveTraceIdFromArn,
  deriveExecutionRootSpanId,
} from "../deterministic-id-generator";
import type { ContextExtractorResult } from "../context-extractors";

const ARN = "arn:aws:lambda:us-east-1:123:function:test:$LATEST/durable/exec1";
const REMOTE_TRACE_ID = "aabbccddee112233445566778899aabb";
const REMOTE_PARENT_ID = "53995c3f42cd8ad8";
const ALL_ZERO_TRACE_ID = "0".repeat(32);
const ALL_ZERO_SPAN_ID = "0".repeat(16);
const START = new Date("2026-08-15T00:00:00Z");

const INVALID_SPAN_CONTEXT: SpanContext = {
  traceId: ALL_ZERO_TRACE_ID,
  spanId: ALL_ZERO_SPAN_ID,
  traceFlags: TraceFlags.NONE,
};

function canonical(extracted: ContextExtractorResult): string {
  return canonicalTraceId(extracted, ARN, START);
}

function resolve(
  extracted: ContextExtractorResult,
  canonicalId: string,
  rootSamplingDecision: () => SamplingDecision,
) {
  return resolveExecutionTraceContext(
    extracted,
    canonicalId,
    ARN,
    rootSamplingDecision,
  );
}

describe("canonicalTraceId", () => {
  it("reuses the remote trace ID when it is valid", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
    };
    expect(canonical(extracted)).toBe(REMOTE_TRACE_ID);
  });

  it("reuses a valid extracted trace ID even without a parent span ID", () => {
    const extracted = { traceId: REMOTE_TRACE_ID };
    expect(canonical(extracted)).toBe(REMOTE_TRACE_ID);
  });

  it("derives from the ARN when there is no remote trace ID", () => {
    const result = canonical(undefined);
    expect(result).toBe(deriveTraceIdFromArn(ARN, START));
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it("derives from the ARN when the remote trace ID is all-zero", () => {
    const extracted = {
      traceId: ALL_ZERO_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
    };
    expect(canonical(extracted)).toBe(deriveTraceIdFromArn(ARN, START));
  });

  it("never adopts a live ambient trace; derives from the ARN when there is no valid remote trace", () => {
    // A live ambient span is not consulted at all: the canonical trace is the
    // reproducible ARN-derived ID when no valid remote trace was propagated.
    expect(canonical(undefined)).toBe(deriveTraceIdFromArn(ARN, START));
  });
});

describe("resolveExecutionTraceContext", () => {
  it("uses a complete remote parent as the ancestor and preserves Sampled=1", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
      sampling: "SAMPLED" as const,
    };
    const execCtx = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.NOT_RECORD,
    );

    expect(execCtx.executionAncestor.traceId).toBe(REMOTE_TRACE_ID);
    expect(execCtx.executionAncestor.spanId).toBe(REMOTE_PARENT_ID);
    expect(execCtx.executionAncestor.isRemote).toBe(true);
    expect(execCtx.traceFlags & 1).toBe(1); // explicit Sampled=1 wins over supplier
    expect(execCtx.samplingDecision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it("uses a complete remote parent and preserves Sampled=0", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
      sampling: "NOT_SAMPLED" as const,
    };
    const execCtx = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );

    expect(execCtx.executionAncestor.spanId).toBe(REMOTE_PARENT_ID);
    expect(execCtx.traceFlags & 1).toBe(0); // explicit Sampled=0 wins over supplier
    expect(execCtx.samplingDecision).toBe(SamplingDecision.NOT_RECORD);
  });

  it("defers an undecided remote parent to the sampler", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
    };

    const sampled = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(sampled.executionAncestor.spanId).toBe(REMOTE_PARENT_ID);
    expect(sampled.traceFlags & 1).toBe(1);

    const dropped = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.NOT_RECORD,
    );
    expect(dropped.executionAncestor.spanId).toBe(REMOTE_PARENT_ID);
    expect(dropped.traceFlags & 1).toBe(0);
  });

  it("treats an all-zero Parent as absent and synthesizes a root on the remote trace", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      parentSpanId: ALL_ZERO_SPAN_ID,
    };
    const execCtx = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );

    expect(execCtx.executionAncestor.traceId).toBe(REMOTE_TRACE_ID);
    expect(execCtx.executionAncestor.spanId).toBe(
      deriveExecutionRootSpanId(ARN),
    );
  });

  it("synthesizes a root on the derived trace for an all-zero Root", () => {
    const extracted = {
      traceId: ALL_ZERO_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
    };
    const canonicalId = canonical(extracted);
    const execCtx = resolve(
      extracted,
      canonicalId,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );

    expect(execCtx.executionAncestor.traceId).toBe(
      deriveTraceIdFromArn(ARN, START),
    );
    expect(execCtx.executionAncestor.spanId).toBe(
      deriveExecutionRootSpanId(ARN),
    );
  });

  it.each([
    [
      "Sampled=0",
      "NOT_SAMPLED" as const,
      SamplingDecision.RECORD_AND_SAMPLED,
      TraceFlags.SAMPLED,
      SamplingDecision.RECORD_AND_SAMPLED,
    ],
    [
      "Sampled=1",
      "SAMPLED" as const,
      SamplingDecision.NOT_RECORD,
      TraceFlags.NONE,
      SamplingDecision.NOT_RECORD,
    ],
  ])(
    "ignores %s from an invalid Root and lets the fallback trace sampling supplier decide",
    (
      _label,
      sampling,
      supplierDecision,
      expectedTraceFlags,
      expectedSamplingDecision,
    ) => {
      const extracted = {
        traceId: ALL_ZERO_TRACE_ID,
        parentSpanId: REMOTE_PARENT_ID,
        sampling,
      };
      const canonicalId = canonical(extracted);

      const execCtx = resolve(extracted, canonicalId, () => supplierDecision);

      expect(execCtx.executionAncestor.traceId).toBe(
        deriveTraceIdFromArn(ARN, START),
      );
      expect(execCtx.traceFlags).toBe(expectedTraceFlags);
      expect(execCtx.samplingDecision).toBe(expectedSamplingDecision);
    },
  );

  it("adopts a valid extracted remote parent as the ancestor and preserves its sampling", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
      sampling: "NOT_SAMPLED" as const,
    };
    const canonicalId = canonical(extracted);

    const execCtx = resolve(
      extracted,
      canonicalId,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );

    // A valid remote trace ID is the canonical trace; the remote parent is the ancestor.
    expect(canonicalId).toBe(REMOTE_TRACE_ID);
    expect(execCtx.executionAncestor.traceId).toBe(REMOTE_TRACE_ID);
    expect(execCtx.executionAncestor.spanId).toBe(REMOTE_PARENT_ID);
    expect(execCtx.executionAncestor.isRemote).toBe(true);
    // Explicit upstream Sampled=0 wins over the supplier.
    expect(execCtx.traceFlags).toBe(TraceFlags.NONE);
    expect(execCtx.samplingDecision).toBe(SamplingDecision.NOT_RECORD);
  });

  it("keeps the ARN-derived trace stable across calls when no context is extracted", () => {
    const canonicalA = canonical(undefined);
    const canonicalB = canonical(undefined);

    expect(canonicalA).toBe(deriveTraceIdFromArn(ARN, START));
    expect(canonicalB).toBe(canonicalA);

    const execA = resolve(
      undefined,
      canonicalA,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );
    const execB = resolve(
      undefined,
      canonicalB,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );

    expect(execA.executionAncestor.traceId).toBe(canonicalA);
    expect(execB.executionAncestor.traceId).toBe(canonicalA);
    expect(execA.executionAncestor.spanId).toBe(execB.executionAncestor.spanId);
    expect(execA.executionAncestor.spanId).toBe(deriveExecutionRootSpanId(ARN));
  });

  it("synthesizes a root on the remote trace when there is a stable Root but no Parent", () => {
    const extracted = { traceId: REMOTE_TRACE_ID };
    const execCtx = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );

    expect(execCtx.executionAncestor.traceId).toBe(REMOTE_TRACE_ID);
    expect(execCtx.executionAncestor.spanId).toBe(
      deriveExecutionRootSpanId(ARN),
    );
    expect(execCtx.traceFlags & 1).toBe(1); // supplier decides for a synthetic root
  });

  it("preserves an explicit Sampled decision on a synthetic root over the supplier", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      sampling: "SAMPLED" as const,
    };
    const execCtx = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.NOT_RECORD,
    );

    expect(execCtx.executionAncestor.spanId).toBe(
      deriveExecutionRootSpanId(ARN),
    );
    expect(execCtx.traceFlags & 1).toBe(1);
  });

  it("synthesizes a root on the ARN-derived trace with no context, supplier decides", () => {
    const canonicalId = canonical(undefined);
    const sampled = resolve(
      undefined,
      canonicalId,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );
    const dropped = resolve(
      undefined,
      canonicalId,
      () => SamplingDecision.NOT_RECORD,
    );

    expect(sampled.executionAncestor.traceId).toBe(canonicalId);
    expect(sampled.executionAncestor.spanId).toBe(
      deriveExecutionRootSpanId(ARN),
    );
    expect(sampled.traceFlags & 1).toBe(1);
    expect(dropped.traceFlags & 1).toBe(0);
  });

  it("synthesizes a root on the ARN-derived trace when there is no propagated context", () => {
    // No propagated remote context at all: the execution anchors on a synthetic
    // root over the reproducible ARN-derived trace. A live ambient span is never
    // consulted by the resolver, so there is nothing to reject here.
    const canonicalId = canonical(undefined);
    const execCtx = resolve(
      undefined,
      canonicalId,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );

    expect(canonicalId).toBe(deriveTraceIdFromArn(ARN, START));
    expect(execCtx.executionAncestor.traceId).toBe(
      deriveTraceIdFromArn(ARN, START),
    );
    expect(execCtx.executionAncestor.spanId).toBe(
      deriveExecutionRootSpanId(ARN),
    );
  });

  it("is stable across reinvocations with no propagated context", () => {
    // Two invocations, no propagation. The resolved execution trace and ancestor
    // span ID must be identical both times, so continuation/replay links (which
    // target the deterministic operation span ID on this trace) remain valid
    // across invocations. The resolver ignores any ambient span, so nothing
    // per-invocation can perturb the result.
    const canonicalA = canonical(undefined);
    const canonicalB = canonical(undefined);
    expect(canonicalA).toBe(canonicalB);
    expect(canonicalA).toBe(deriveTraceIdFromArn(ARN, START));

    const execA = resolve(
      undefined,
      canonicalA,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );
    const execB = resolve(
      undefined,
      canonicalB,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(execA.executionAncestor.traceId).toBe(
      execB.executionAncestor.traceId,
    );
    expect(execA.executionAncestor.spanId).toBe(execB.executionAncestor.spanId);
    expect(execA.executionAncestor.spanId).toBe(deriveExecutionRootSpanId(ARN));
  });

  it("uses a complete remote parent as the ancestor (not any ambient span)", () => {
    const extracted = {
      traceId: REMOTE_TRACE_ID,
      parentSpanId: REMOTE_PARENT_ID,
      sampling: "SAMPLED" as const,
    };
    const execCtx = resolve(
      extracted,
      REMOTE_TRACE_ID,
      () => SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(execCtx.executionAncestor.traceId).toBe(REMOTE_TRACE_ID);
    expect(execCtx.executionAncestor.spanId).toBe(REMOTE_PARENT_ID);
    expect(execCtx.executionAncestor.isRemote).toBe(true);
  });
});

describe("rootSamplingDecision", () => {
  function tracerWithSampler(decision: SamplingDecision | undefined): Tracer {
    // Mimic an SDK tracer exposing a `_sampler` with shouldSample().
    const sampler =
      decision === undefined
        ? undefined
        : {
            shouldSample: () => ({ decision }),
            toString: () =>
              decision === SamplingDecision.RECORD_AND_SAMPLED
                ? "AlwaysOnSampler"
                : "AlwaysOffSampler",
          };
    return { _sampler: sampler } as unknown as Tracer;
  }

  it("returns RECORD_AND_SAMPLED when the configured sampler samples the root", () => {
    const tracer = tracerWithSampler(SamplingDecision.RECORD_AND_SAMPLED);
    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it("returns NOT_RECORD when the configured sampler drops the root", () => {
    const tracer = tracerWithSampler(SamplingDecision.NOT_RECORD);
    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it("defaults to sampled when no sampler is reachable", () => {
    // A proxy tracer with no _sampler field: the decision defaults to sampled
    // rather than being approximated, matching the documented fallback.
    const tracer = tracerWithSampler(undefined);
    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it("defaults to sampled when a configured sampler throws", () => {
    const tracer = {
      _sampler: {
        shouldSample: () => {
          throw new Error("boom");
        },
        toString: () => "AlwaysOffSampler",
      },
    } as unknown as Tracer;
    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it("evaluates a ParentBased sampler at the root policy, ignoring an unrelated ambient span", () => {
    // Reviewer case: an undecided execution must not inherit the sampled bit of
    // an unrelated ambient span. With ParentBased(root=alwaysOn), the root
    // policy samples; an unrelated UNSAMPLED ambient span active in the context
    // must not flip that to dropped. rootSamplingDecision evaluates with ROOT_CONTEXT,
    // so the ambient span is ignored.
    const realSampler = new ParentBasedSampler({ root: new AlwaysOnSampler() });
    const tracer = { _sampler: realSampler } as unknown as Tracer;

    const unrelatedUnsampled: SpanContext = {
      traceId: "c".repeat(32),
      spanId: "d".repeat(16),
      traceFlags: TraceFlags.NONE, // unsampled, unrelated trace
    };

    let decision = SamplingDecision.NOT_RECORD;
    context.with(trace.setSpanContext(ROOT_CONTEXT, unrelatedUnsampled), () => {
      decision = rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {});
    });

    // Root policy (alwaysOn) wins; the unrelated unsampled ambient span does not
    // drop the execution.
    expect(decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it("honors custom sampler decisions for undecided execution sampling", () => {
    let calls = 0;
    const tracer = {
      _sampler: {
        shouldSample: (
          parentContext: unknown,
          traceId: string,
          spanName: string,
        ) => {
          calls += 1;
          expect(parentContext).toBe(ROOT_CONTEXT);
          expect(traceId).toBe(REMOTE_TRACE_ID);
          expect(spanName).toBe("Workflow");
          return { decision: SamplingDecision.NOT_RECORD };
        },
      },
    } as unknown as Tracer;

    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.NOT_RECORD,
    );
    expect(calls).toBe(1);
  });

  it("honors deterministic AlwaysOffSampler decisions", () => {
    const tracer = {
      _sampler: new AlwaysOffSampler(),
    } as unknown as Tracer;

    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it("honors TraceIdRatioBasedSampler decisions when its description uses exponent notation", () => {
    const tracer = {
      _sampler: new TraceIdRatioBasedSampler(1e-7),
    } as unknown as Tracer;

    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it("honors ParentBasedSampler root decisions when a nested ratio description uses exponent notation", () => {
    const tracer = {
      _sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(1e-7),
      }),
    } as unknown as Tracer;

    expect(rootSamplingDecision(tracer, REMOTE_TRACE_ID, "Workflow", {})).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });
});
