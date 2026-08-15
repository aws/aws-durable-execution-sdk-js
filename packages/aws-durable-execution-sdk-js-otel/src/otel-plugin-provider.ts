import type { TracerProvider } from "@opentelemetry/api";
import { trace } from "@opentelemetry/api";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";
import type { OtelPluginConfig } from "./otel-plugin-config";

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
  idGenerator: IdGenerator,
): ProviderResult {
  if (config?.tracerProviderFactory) {
    return {
      tracerProvider: config.tracerProviderFactory(idGenerator),
      usesGlobalProvider: false,
    };
  }

  return {
    tracerProvider: trace.getTracerProvider(),
    usesGlobalProvider: true,
  };
}
