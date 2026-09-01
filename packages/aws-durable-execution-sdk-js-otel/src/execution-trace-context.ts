import type { SpanContext, Tracer } from "@opentelemetry/api";
import { TraceFlags, SpanKind, ROOT_CONTEXT } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import {
  deriveTraceIdFromArn,
  deriveExecutionRootSpanId,
} from "./deterministic-id-generator";
import {
  hasCompleteRemoteParent,
  hasValidTraceId,
  resolveSampling,
} from "./context-extractors";
import type { ContextExtractorResult } from "./context-extractors";
import { getConfiguredSampler } from "./global-sampler";

/**
 * The per-execution trace context resolved once at invocation start, shared by
 * both plugins.
 *
 * It selects the common execution ancestor that the Workflow and Invocation
 * spans parent onto, so they share one trace. The ancestor is chosen by
 * precedence:
 *
 * 1. a complete remote backend context (valid trace ID + valid parent span ID)
 *    is the authoritative ancestor, used directly whether or not the upstream
 *    carries an explicit sampling decision;
 * 2. otherwise a synthetic execution root anchors the execution, with a
 *    deterministic span ID in its own namespace, on the canonical trace.
 *
 * A live ambient span is deliberately never used as the ancestor: its trace ID
 * is not guaranteed stable across Lambda reinvocations, so anchoring the
 * multi-invocation execution on it could change the execution trace on replay
 * and break the cross-invocation continuation/replay links.
 *
 * The canonical trace ID follows the same precedence: the remote trace ID when
 * valid, else one derived from the ARN and start time.
 *
 * Sampling: an explicit upstream decision is preserved only when it belongs to
 * a valid extracted trace; when it is absent, the configured root decision
 * (`whenUndecided`) is applied to both a remote parent and a synthetic root.
 * Trace flags carry a single sampled bit with no "unset" state, so a
 * remote parent left unsampled would make a parent-based sampler drop every
 * child span.
 *
 * The ancestor is a non-recording context: it is either the external backend
 * server span or a synthetic root the SDK does not export.
 */
export interface ExecutionTraceContext {
  /** The common parent context for the Workflow and Invocation spans. */
  executionAncestor: SpanContext;
  /** The trace ID of the execution trace (equals `executionAncestor.traceId`). */
  traceId: string;
  /** The trace flags of the execution trace. */
  traceFlags: number;
  /** The sampling decision enforced for SDK-created spans in this execution. */
  samplingDecision: SamplingDecision;
}

/**
 * The canonical trace ID: the propagated remote trace ID when valid, else one
 * derived from the ARN and start time.
 *
 * Only these two anchors are used, and both are stable across Lambda
 * reinvocations: the propagated `Root` is kept identical for every invocation by
 * the durable backend, and the ARN-derived ID is a pure hash of the ARN. A live
 * ambient span's trace ID is deliberately NOT used — it is not guaranteed stable
 * across invocations, so anchoring on one could change the execution trace on
 * replay and break the continuation/replay links (which target
 * `deriveSpanIdFromOperationId` on the canonical trace).
 *
 * An all-zero or malformed remote trace ID is not usable, so it falls through to
 * the ARN-derived ID rather than anchoring the execution on an unstable trace.
 */
export function canonicalTraceId(
  extracted: ContextExtractorResult,
  executionArn: string,
  executionStartTimestamp: Date | undefined,
): string {
  if (hasValidTraceId(extracted)) {
    return extracted.traceId;
  }
  return deriveTraceIdFromArn(executionArn, executionStartTimestamp);
}

/**
 * Flags for an explicit upstream decision, or the sampler's decision
 * (`whenUndecided`) when the upstream did not decide. The supplier is consulted
 * lazily, only for the `UNDECIDED` case, so an explicit decision never triggers
 * a (discarded) sampler query.
 */
function explicitDecision(
  extracted: ContextExtractorResult,
  whenUndecided: () => SamplingDecision,
): SamplingDecision {
  const sampling = extracted ? resolveSampling(extracted) : "UNDECIDED";
  switch (sampling) {
    case "SAMPLED":
      return SamplingDecision.RECORD_AND_SAMPLED;
    case "NOT_SAMPLED":
      return SamplingDecision.NOT_RECORD;
    case "UNDECIDED":
    default:
      return whenUndecided();
  }
}

function traceFlagsFromDecision(decision: SamplingDecision): number {
  return decision === SamplingDecision.RECORD_AND_SAMPLED
    ? TraceFlags.SAMPLED
    : TraceFlags.NONE;
}

/**
 * Resolves the execution ancestor: a complete propagated remote parent when
 * present, otherwise a synthetic execution root on the canonical trace.
 *
 * A live ambient span is never used as the ancestor. Its trace ID is not
 * guaranteed stable across Lambda reinvocations, so anchoring the multi-
 * invocation execution on it could change the execution trace on replay and
 * break cross-invocation links. The two anchors used here are both stable: a
 * propagated remote parent (the backend keeps `Root` identical every invocation)
 * and the ARN-derived synthetic root (a pure hash of the ARN).
 *
 * @param extracted the context parsed from the backend header, or undefined
 * @param canonical the trace ID the ancestor is anchored on
 * @param executionArn the durable execution ARN
 * @param rootSamplingDecision the configured root decision for this trace, applied
 *   to a remote parent or synthetic root when the header carries no explicit
 *   Sampled value
 */
export function resolveExecutionTraceContext(
  extracted: ContextExtractorResult,
  canonical: string,
  executionArn: string,
  rootSamplingDecision: () => SamplingDecision,
): ExecutionTraceContext {
  // A valid remote backend parent is the authoritative ancestor, regardless of
  // whether Sampled is present.
  if (hasCompleteRemoteParent(extracted)) {
    const decision = explicitDecision(extracted, rootSamplingDecision);
    const flags = traceFlagsFromDecision(decision);
    const remoteParent: SpanContext = {
      traceId: extracted.traceId,
      spanId: extracted.parentSpanId,
      traceFlags: flags,
      isRemote: true,
    };
    return {
      executionAncestor: remoteParent,
      traceId: remoteParent.traceId,
      traceFlags: flags,
      samplingDecision: decision,
    };
  }

  // No complete remote parent: synthesize an execution root on the canonical
  // trace (the stable remote Root if one was provided, else the ARN-derived ID).
  const samplingContext = hasValidTraceId(extracted) ? extracted : undefined;
  const decision = explicitDecision(samplingContext, rootSamplingDecision);
  const flags = traceFlagsFromDecision(decision);
  const syntheticRoot: SpanContext = {
    traceId: canonical,
    spanId: deriveExecutionRootSpanId(executionArn),
    traceFlags: flags,
    isRemote: false,
  };
  return {
    executionAncestor: syntheticRoot,
    traceId: canonical,
    traceFlags: flags,
    samplingDecision: decision,
  };
}

/**
 * Decides how a root span on the given trace should be sampled, used only
 * when the propagated context carries no explicit decision.
 *
 * Sampling precedence, highest first:
 *
 * 1. the backend's explicit `Sampled` on the propagated header — handled by the
 *    caller before reaching here;
 * 2. the configured sampler is evaluated at its root policy (`ROOT_CONTEXT`, no
 *    parent) with the real trace ID. This honors custom samplers and avoids
 *    inheriting an unrelated ambient span's decision.
 *
 * The resolved decision is then enforced through DurableSampler for every
 * SDK-created span, so direct samplers that ignore parent flags cannot override
 * an explicit backend decision or the configured root decision.
 *
 * @param tracer the resolved SDK tracer
 * @param traceId the canonical trace ID to evaluate
 * @param spanName the span name passed to the sampler
 * @param attributes the attributes the span is started with
 */
export function rootSamplingDecision(
  tracer: Tracer,
  traceId: string,
  spanName: string,
  attributes: Record<string, string | number | boolean>,
): SamplingDecision {
  const sampler = getConfiguredSampler(tracer);
  if (!sampler) {
    return SamplingDecision.RECORD_AND_SAMPLED;
  }
  try {
    // Evaluate with ROOT_CONTEXT (no parent), not the active context: a
    // ParentBasedSampler must decide the execution root on its own root policy,
    // not inherit the sampled bit of an unrelated ambient span that the resolver
    // already rejected. Otherwise an unrelated unsampled ambient span could drop
    // an execution whose root policy would sample it.
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      spanName,
      SpanKind.INTERNAL,
      attributes,
      [],
    );
    return result.decision;
  } catch {
    return SamplingDecision.RECORD_AND_SAMPLED;
  }
}
