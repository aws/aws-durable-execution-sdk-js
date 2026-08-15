import type { TracerProvider } from "@opentelemetry/api";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";
import type { ContextExtractor } from "./context-extractors";

/**
 * Creates a caller-owned TracerProvider with the plugin's deterministic ID
 * generator installed during provider construction.
 */
export type TracerProviderFactory = (
  idGenerator: IdGenerator,
) => TracerProvider;

/**
 * Shared configuration options for both ExecutionOtelPlugin and InvocationOtelPlugin.
 *
 * All fields are optional. When no provider factory is supplied, the plugin
 * uses the globally registered TracerProvider.
 */
export interface OtelPluginConfig {
  /**
   * Factory for an application-owned TracerProvider. The plugin passes its
   * deterministic ID generator to the factory so it can be installed during
   * provider construction.
   *
   * When omitted, the globally registered provider is used. The application
   * owns initialization, instrumentation, exporters, and shutdown for providers
   * returned by this factory.
   */
  tracerProviderFactory?: TracerProviderFactory;

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
