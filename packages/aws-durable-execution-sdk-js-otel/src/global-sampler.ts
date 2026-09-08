import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Context,
  Attributes,
  Link,
  SpanKind,
  Tracer,
} from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import type { Sampler, SamplingResult } from "@opentelemetry/sdk-trace-node";

const SAMPLER_FIELD = "_sampler";

function isSampler(value: unknown): value is Sampler {
  return (
    typeof value === "object" &&
    value !== null &&
    "shouldSample" in value &&
    typeof (value as { shouldSample: unknown }).shouldSample === "function"
  );
}

/**
 * Sampler wrapper that preserves the application's sampler except while the
 * durable plugin is creating its own spans with a resolved execution decision.
 */
export class DurableSampler implements Sampler {
  private static readonly decisions = new AsyncLocalStorage<SamplingDecision>();

  constructor(private readonly delegate: Sampler) {}

  withDecision<T>(decision: SamplingDecision, fn: () => T): T {
    return DurableSampler.decisions.run(decision, fn);
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    const decision = DurableSampler.decisions.getStore();
    if (decision !== undefined) {
      return { decision };
    }
    return this.delegate.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links,
    );
  }

  toString(): string {
    return `DurableSampler{${this.delegate.toString()}}`;
  }
}

/**
 * Installs a durable-aware sampler on an OpenTelemetry SDK tracer.
 *
 * OpenTelemetry JavaScript does not expose the sampler through its public API.
 * SDK tracers have historically stored it in the TypeScript-private `_sampler`
 * field, which remains writable at runtime.
 */
export function tryInstallDurableSampler(
  tracer: Tracer,
): DurableSampler | undefined {
  try {
    const existingSampler = Reflect.get(tracer, SAMPLER_FIELD);
    if (!isSampler(existingSampler)) {
      return undefined;
    }
    if (existingSampler instanceof DurableSampler) {
      return existingSampler;
    }

    const durableSampler = new DurableSampler(existingSampler);
    if (
      !Reflect.set(tracer, SAMPLER_FIELD, durableSampler) ||
      Reflect.get(tracer, SAMPLER_FIELD) !== durableSampler
    ) {
      return undefined;
    }
    return durableSampler;
  } catch {
    return undefined;
  }
}

export function getConfiguredSampler(tracer: Tracer): Sampler | undefined {
  try {
    const sampler = Reflect.get(tracer, SAMPLER_FIELD);
    if (sampler instanceof DurableSampler) {
      return Reflect.get(sampler, "delegate") as Sampler;
    }
    return isSampler(sampler) ? sampler : undefined;
  } catch {
    return undefined;
  }
}
