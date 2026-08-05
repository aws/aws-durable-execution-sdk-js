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
  /** Caller supplied `config.tracerProvider`; the plugin uses it as-is. */
  Explicit = "explicit",
  /** Use the globally registered provider via `trace.getTracerProvider()`. */
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
   * Custom TracerProvider, used only when `providerSource` is
   * `ProviderSource.Explicit`. When selected, the plugin uses this provider
   * as-is and skips all auto-setup (no exporter, no propagators, no
   * instrumentations are registered). The caller owns the provider.
   *
   * Required when `providerSource === ProviderSource.Explicit`, and ignored
   * (rejected) for any other source — see {@link resolveProviderSource}.
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
   * Selects how the plugin obtains its `TracerProvider`:
   *
   * - `ProviderSource.AutoOtlp` (default) — the plugin builds and owns an
   *   internal `NodeTracerProvider` with OTLP export, propagators, sampler,
   *   and HTTP + AWS SDK instrumentation.
   * - `ProviderSource.Global` — the plugin uses the globally registered
   *   provider via `trace.getTracerProvider()` and skips all auto-setup.
   *   The caller owns the global provider (e.g. the ADOT Lambda layer).
   * - `ProviderSource.Explicit` — the plugin uses `tracerProvider` as-is and
   *   skips all auto-setup. `tracerProvider` is then required.
   *
   * Defaults to `ProviderSource.AutoOtlp`.
   */
  providerSource?: ProviderSource;

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
 * Resolves and validates the {@link ProviderSource} for a config.
 *
 * `providerSource` is the sole selector (defaulting to
 * `ProviderSource.AutoOtlp`). `tracerProvider` is a companion input consumed
 * only by the `Explicit` source. This function enforces that coupling:
 *
 * - `Explicit` requires `tracerProvider` — throws if it is missing.
 * - `tracerProvider` may only be supplied with `Explicit` — throws otherwise,
 *   rather than silently ignoring a provider the caller expected to be used.
 *
 * It is the single source of truth for provider-mode selection: both the
 * provider factory and the plugins derive their behavior from the returned
 * `ProviderSource`.
 */
export function resolveProviderSource(
  config?: OtelPluginConfig,
): ProviderSource {
  const source = config?.providerSource ?? ProviderSource.AutoOtlp;

  if (source === ProviderSource.Explicit && !config?.tracerProvider) {
    throw new Error(
      "OtelPluginConfig: providerSource 'explicit' requires a `tracerProvider` to be set.",
    );
  }

  if (config?.tracerProvider && source !== ProviderSource.Explicit) {
    throw new Error(
      "OtelPluginConfig: `tracerProvider` is only used with providerSource 'explicit'. " +
        "Set providerSource: ProviderSource.Explicit, or remove tracerProvider.",
    );
  }

  return source;
}
