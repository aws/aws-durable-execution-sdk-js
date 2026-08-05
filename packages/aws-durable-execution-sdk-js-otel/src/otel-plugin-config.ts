import type { TracerProvider } from "@opentelemetry/api";
import type { TextMapPropagator } from "@opentelemetry/api";
import type { ContextExtractor } from "./context-extractors";

/**
 * The three tracer-provider resolution tiers a config can select.
 *
 * This is the single vocabulary for "which provider mode are we in", consumed
 * by the provider factory (to build/accept the provider) and by the plugins
 * (to shape spans). Derive it from a config with {@link resolveProviderSource}.
 */
export enum ProviderSource {
  /** Caller supplied `config.tracerProvider`. */
  Explicit = "explicit",
  /** `useDefaultTracerProvider` -> `trace.getTracerProvider()`. */
  Global = "global",
  /** Default: the plugin builds and owns an OTLP provider. */
  AutoOtlp = "auto_otlp",
}

/**
 * Shared configuration options for both ExecutionOtelPlugin and InvocationOtelPlugin.
 *
 * All fields are optional. When no configuration is provided, the plugin
 * auto-configures a fully working TracerProvider with OTLP export to
 * `http://localhost:4318/v1/traces`, HTTP + AWS SDK instrumentation,
 * and AWSXRay + W3C TraceContext propagators.
 */
export interface OtelPluginConfig {
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

  /**
   * When true, the plugin fetches the globally registered TracerProvider
   * via trace.getTracerProvider() instead of creating its own.
   *
   * This skips all auto-setup (exporter, propagators, instrumentations).
   * The caller is responsible for configuring the global provider.
   *
   * Precedence is resolved centrally by {@link resolveProviderSource}:
   * explicit `tracerProvider` > `useDefaultTracerProvider` > auto-created.
   * If both `tracerProvider` and `useDefaultTracerProvider` are set,
   * `tracerProvider` wins.
   *
   * Defaults to false.
   */
  useDefaultTracerProvider?: boolean;

  /**
   * Custom name for the root Workflow span.
   * Defaults to `"Workflow"`.
   */
  workflowSpanName?: string;

  /**
   * Whether `enrichLogContext()` contributes the active OTel trace context
   * (`traceId`, `spanId`, `otelTraceSampled`) to each durable log record.
   *
   * When `true` (default), every log line emitted through the durable logger is
   * stamped with the current span context for log/trace correlation. Set to
   * `false` to disable the extra fields (e.g. to avoid duplicating context that
   * a separate log-instrumentation layer already injects, or to keep log output
   * minimal). Mirrors Python's `enrich_logger` and Java's `enableMdc`.
   */
  enrichLogger?: boolean;
}

/**
 * @deprecated Use `OtelPluginConfig` instead.
 */
export type ExecutionOtelPluginConfig = OtelPluginConfig;

/**
 * Resolves the {@link ProviderSource} for a config, applying the documented
 * precedence in one place:
 *
 *   explicit `tracerProvider` > `useDefaultTracerProvider` > auto-created OTLP.
 *
 * This is the single source of truth for provider-mode selection. Both the
 * provider factory and the plugins derive their behavior from the returned
 * `ProviderSource` rather than re-interpreting the raw config booleans.
 */
export function resolveProviderSource(
  config?: OtelPluginConfig,
): ProviderSource {
  if (config?.tracerProvider) {
    return ProviderSource.Explicit;
  }
  if (config?.useDefaultTracerProvider) {
    return ProviderSource.Global;
  }
  return ProviderSource.AutoOtlp;
}
