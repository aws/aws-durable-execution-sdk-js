import type { TracerProvider } from "@opentelemetry/api";
import type { TextMapPropagator } from "@opentelemetry/api";
import type { ContextExtractor } from "./context-extractors";

/**
 * Configuration options for the StandaloneOtelPlugin.
 *
 * All fields are optional. When no configuration is provided, the plugin
 * auto-configures a fully working TracerProvider with OTLP export to
 * `http://localhost:4318/v1/traces`, HTTP + AWS SDK instrumentation,
 * and AWSXRay + W3C TraceContext propagators.
 */
export interface StandaloneOtelPluginConfig {
  /**
   * Custom TracerProvider. When provided, the plugin skips all auto-setup
   * (no exporter, no propagators, no instrumentations are registered).
   * The caller is responsible for configuring the provider.
   */
  tracerProvider?: TracerProvider;

  /**
   * Context extractor function used to extract upstream trace context
   * from the invocation environment. Defaults to `xRayContextExtractor`.
   */
  contextExtractor?: ContextExtractor;

  /**
   * Instrumentation scope name used when creating tracers.
   * Defaults to `"aws-durable-execution-sdk-js"`.
   */
  instrumentationName?: string;

  /**
   * Whether to register `@opentelemetry/instrumentation-http`.
   * Defaults to `true`. Set to `false` to skip HTTP instrumentation
   * (AWS SDK instrumentation is always registered unless a custom
   * `tracerProvider` is provided).
   */
  enableHttpInstrumentation?: boolean;

  /**
   * OTLP exporter configuration. Only used when no custom `tracerProvider`
   * is provided.
   */
  exporterConfig?: {
    /**
     * Exporter endpoint URL. Defaults to the value of the
     * `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable, or
     * `http://localhost:4318` if not set.
     */
    endpoint?: string;

    /**
     * Custom headers sent with each export request. Useful for
     * authentication with third-party OTLP endpoints.
     */
    headers?: Record<string, string>;
  };

  /**
   * Custom propagators. When provided, replaces the default composite
   * propagator (`[AWSXRayPropagator, W3CTraceContextPropagator]`).
   */
  propagators?: TextMapPropagator[];
}
