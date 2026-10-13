import type { TracerProvider } from "@opentelemetry/api";
import { trace } from "@opentelemetry/api";
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
 * Flushes an application-owned provider without shutting it down.
 * The API global provider is a proxy; use its one public delegate when it does
 * not itself expose forceFlush. Explicit factory providers are not unwrapped.
 */
export async function flushTracerProvider(
  provider: TracerProvider,
  usesGlobalProvider: boolean,
): Promise<void> {
  let target = provider;
  if (usesGlobalProvider && !("forceFlush" in target)) {
    const proxy = target as TracerProvider & {
      getDelegate?: () => TracerProvider;
    };
    if (typeof proxy.getDelegate === "function") {
      target = proxy.getDelegate();
    }
  }
  if ("forceFlush" in target) {
    await (
      target as TracerProvider & { forceFlush: () => Promise<void> }
    ).forceFlush();
  }
}
