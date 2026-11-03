import type { Context, SpanContext, Tracer } from "@opentelemetry/api";
import { trace, TraceFlags, SpanKind, ROOT_CONTEXT } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import {
  deriveTraceIdFromArn,
  deriveExecutionRootSpanId,
} from "./deterministic-id-generator";
import {
  hasCompleteRemoteParent,
  hasValidTraceId,
  parseXRayTraceHeader,
  selectXRayTraceHeader,
  resolveSampling,
} from "./context-extractors";
import type { ContextExtractorResult } from "./context-extractors";
import { getConfiguredSampler } from "./global-sampler";

/**
 * Environment values used to resolve the default X-Ray execution trace ID.
 *
 * `process.env` remains supported and only `_X_AMZN_TRACE_ID` is interpreted.
 * Invocation-local context is passed separately to avoid treating arbitrary
 * environment variables as invocation metadata.
 */
export interface ExecutionTraceEnvironment {
  readonly _X_AMZN_TRACE_ID?: string;
}

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
 * Sampling: the configured provider sampler receives the original complete
 * remote parent, or no parent when none is usable. Its decision is applied to
 * every SDK-created span; only the sampler decides whether to inherit upstream
 * flags. An unset sampled bit on a valid parent is unsampled, not a root.
 *
 * The ancestor is a non-recording context used to force deterministic
 * parenting. It is either the external backend server span or an SDK-owned
 * synthetic root whose recording counterpart is materialized by the plugins
 * for sampled fallback traces.
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
 * Derives the trace ID used by the OpenTelemetry plugins for a durable
 * execution with the default X-Ray context extractor.
 *
 * The invocation-local `xRayTraceId` takes precedence over `_X_AMZN_TRACE_ID`.
 * A present but invalid local header suppresses the environment carrier. When
 * the selected header is missing or malformed, derive from the execution ARN
 * and stable start timestamp using the same resolver as the plugins.
 *
 * Pass the same execution start timestamp supplied to the plugin when no valid
 * X-Ray Root is available. If the timestamp is unavailable to both callers,
 * omit it to use the deterministic ARN-only fallback.
 *
 * @param environment - Environment containing the optional X-Ray trace header
 * @param executionArn - The durable execution ARN
 * @param executionStartTimestamp - Stable start time of the durable execution
 * @param invocation - Optional invocation-local runtime carrier
 * @returns The 32-character lowercase hexadecimal execution trace ID
 */
export function deriveExecutionTraceId(
  environment: ExecutionTraceEnvironment,
  executionArn: string,
  executionStartTimestamp?: Date,
  invocation?: { readonly xRayTraceId?: string | null | undefined },
): string {
  return canonicalTraceId(
    parseXRayTraceHeader(selectXRayTraceHeader(invocation ?? {}, environment)),
    executionArn,
    executionStartTimestamp,
  );
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
 * @param sample evaluates the configured sampler on the canonical trace with
 *   the original propagated parent context, before creating synthetic ancestors
 */
export function resolveExecutionTraceContext(
  extracted: ContextExtractorResult,
  canonical: string,
  executionArn: string,
  sample: (parentContext: Context) => SamplingDecision,
): ExecutionTraceContext {
  const remoteParent: SpanContext | undefined = hasCompleteRemoteParent(
    extracted,
  )
    ? {
        traceId: extracted.traceId,
        spanId: extracted.parentSpanId,
        traceFlags:
          resolveSampling(extracted) === "SAMPLED"
            ? TraceFlags.SAMPLED
            : TraceFlags.NONE,
        isRemote: true,
      }
    : undefined;
  // Never let an ambient span or a synthesized sampled ancestor choose the
  // execution's policy. A valid parent with no sampled bit remains a parent.
  const decision = sample(
    remoteParent
      ? trace.setSpanContext(ROOT_CONTEXT, remoteParent)
      : ROOT_CONTEXT,
  );
  const flags = traceFlagsFromDecision(decision);
  return {
    executionAncestor: remoteParent
      ? { ...remoteParent, traceFlags: flags }
      : {
          traceId: canonical,
          // Several executions can share a trace; each owns its fallback root.
          spanId: deriveExecutionRootSpanId(executionArn),
          traceFlags: flags,
          isRemote: false,
        },
    traceId: canonical,
    traceFlags: flags,
    samplingDecision: decision,
  };
}

/**
 * Evaluates the provider's resolved sampler with the canonical trace ID and
 * original propagated parent (or ROOT_CONTEXT). The existing DurableSampler
 * bridge then enforces this decision only while creating SDK-owned spans.
 */
export function configuredSamplingDecision(
  tracer: Tracer,
  traceId: string,
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  parentContext: Context = ROOT_CONTEXT,
): SamplingDecision {
  const sampler = getConfiguredSampler(tracer);
  if (!sampler) {
    return SamplingDecision.RECORD_AND_SAMPLED;
  }
  try {
    const result = sampler.shouldSample(
      parentContext,
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
