import type {
  TracerProvider,
  Tracer,
  Span,
  Attributes,
  TraceState,
} from "@opentelemetry/api";
import { trace, ROOT_CONTEXT, SpanKind, TraceFlags } from "@opentelemetry/api";
import type { Sampler } from "@opentelemetry/sdk-trace-node";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import { DeterministicIdGenerator } from "./deterministic-id-generator";
import type {
  IdGeneratorFactory,
  OtelPluginConfig,
} from "./otel-plugin-config";

export interface ProviderResult {
  /** The configured TracerProvider. */
  tracerProvider: TracerProvider;
  /**
   * Whether the provider came from OpenTelemetry's global registration.
   *
   * An explicit factory may return the same object that is globally registered,
   * but it still has application-owned initialization and span behavior.
   */
  usesGlobalProvider: boolean;
}

/**
 * Resolves an application-owned provider factory or the globally registered
 * provider. Exporters, sampling, resources, propagators, instrumentation, and
 * provider shutdown remain application or ADOT responsibilities.
 */
export function createTracerProvider(
  config: OtelPluginConfig | undefined,
  idGenerator: DeterministicIdGenerator,
): ProviderResult {
  if (config?.tracerProviderFactory) {
    const createIdGenerator: IdGeneratorFactory = (fallbackIdGenerator) =>
      fallbackIdGenerator
        ? new DeterministicIdGenerator(fallbackIdGenerator)
        : idGenerator;

    return {
      tracerProvider: config.tracerProviderFactory(createIdGenerator),
      usesGlobalProvider: false,
    };
  }

  return {
    tracerProvider: trace.getTracerProvider(),
    usesGlobalProvider: true,
  };
}

/**
 * The synthetic, non-recording stand-in for a durable execution's Workflow span,
 * plus everything needed to create the one real span later.
 *
 * The Workflow span covers a whole execution, so only the terminal invocation
 * can complete it. Until then its identity is carried by a non-recording
 * context: a real span would have to be either abandoned un-ended (never
 * exported) or ended every invocation (duplicate `(traceId, spanId)`).
 *
 * `attributes` is reused verbatim when the real span is created, so an
 * attribute-based sampler sees identical inputs at both points. `sampled` is the
 * decision reached here and is the only one honored, so a stateful sampler
 * cannot drop the children and then export the root.
 */
export interface WorkflowRoot {
  /** Non-recording span carrying the deterministic identity. */
  span: Span;
  /** Sampler inputs, reused when the real span is created. */
  attributes: Attributes;
  /** The provider's decision for this root. */
  sampled: boolean;
}

/**
 * Resolves the Workflow root identity and its sampling decision.
 *
 * The sampler is consulted through the SDK Tracer's internal `_sampler` (as this
 * package already does for `_idGenerator`); if it is unavailable — a no-op or
 * non-SDK Tracer — we fall back to sampled rather than dropping everything.
 */
export function resolveWorkflowRoot(
  tracer: Tracer,
  traceId: string,
  spanId: string,
  spanName: string,
  executionArn: string,
): WorkflowRoot {
  const attributes: Attributes = { "durable.execution.arn": executionArn };
  const sampler = (tracer as unknown as { _sampler?: Sampler })._sampler;

  let sampled = true;
  let traceState: TraceState | undefined;
  if (sampler?.shouldSample) {
    try {
      // ROOT_CONTEXT: the Workflow span is parentless, so a ParentBased sampler
      // correctly delegates to its root delegate.
      const result = sampler.shouldSample(
        ROOT_CONTEXT,
        traceId,
        spanName,
        SpanKind.INTERNAL,
        attributes,
        [],
      );
      sampled = result.decision === SamplingDecision.RECORD_AND_SAMPLED;
      traceState = result.traceState;
    } catch {
      sampled = true;
    }
  }

  return {
    span: trace.wrapSpanContext({
      traceId,
      spanId,
      traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
      traceState,
    }),
    attributes,
    sampled,
  };
}
