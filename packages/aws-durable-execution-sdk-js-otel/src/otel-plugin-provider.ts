import type { TracerProvider } from "@opentelemetry/api";
import { propagation, trace } from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  NodeTracerProvider,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import type { OtelPluginConfig } from "./otel-plugin-config";
import { ProviderSource, resolveProviderSource } from "./otel-plugin-config";

// Re-export so existing consumers can keep importing ProviderSource from here.
export { ProviderSource } from "./otel-plugin-config";

const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";

export interface ProviderResult {
  /** The configured TracerProvider. */
  tracerProvider: TracerProvider;
  /**
   * Which tier produced the provider. This is the single source of truth for
   * provider ownership: the factory created (and therefore owns) the provider
   * only when `source === ProviderSource.AutoOtlp`.
   */
  source: ProviderSource;
}

/**
 * Resolves the sampler based on the `OTEL_DURABLE_SAMPLING_RATIO` env var.
 *
 * - If the env var is set to a valid number between 0 and 1 (inclusive),
 *   returns a `TraceIdRatioBasedSampler` with that ratio.
 * - Otherwise returns `AlwaysOnSampler`.
 */
function resolveSampler(): AlwaysOnSampler | TraceIdRatioBasedSampler {
  const ratioStr = process.env.OTEL_DURABLE_SAMPLING_RATIO;
  if (ratioStr != null && ratioStr !== "") {
    const ratio = Number(ratioStr);
    if (!Number.isNaN(ratio) && ratio >= 0 && ratio <= 1) {
      return new TraceIdRatioBasedSampler(ratio);
    }
  }
  return new AlwaysOnSampler();
}

/**
 * Builds Lambda resource attributes when running inside a Lambda environment.
 * Detects the Lambda environment by checking for `AWS_LAMBDA_FUNCTION_NAME`.
 */
function buildLambdaResource() {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    return undefined;
  }

  const attributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: functionName,
    "faas.name": functionName,
    "cloud.provider": "aws",
    "cloud.platform": "aws_lambda",
  };

  const region = process.env.AWS_REGION;
  if (region) {
    attributes["cloud.region"] = region;
  }

  const functionVersion = process.env.AWS_LAMBDA_FUNCTION_VERSION;
  if (functionVersion) {
    attributes["faas.version"] = functionVersion;
  }

  return resourceFromAttributes(attributes);
}

/**
 * Factory function that resolves and configures a `TracerProvider` for the
 * ExecutionOtelPlugin and InvocationOtelPlugin, based on the config's
 * {@link ProviderSource} (see {@link resolveProviderSource}):
 *
 * - `Global` (the default when `providerSource` is unset) — returns the
 *   globally registered provider via `trace.getTracerProvider()` as-is; no
 *   exporter, propagator, or sampler registration is performed.
 * - `Explicit` — returns the supplied `config.tracerProvider` as-is, with no
 *   auto-setup.
 * - `AutoOtlp` — creates a `NodeTracerProvider` with:
 *   - `OTLPTraceExporter` targeting the configured endpoint
 *   - `BatchSpanProcessor` wrapping the exporter
 *   - `AWSXRayPropagator` + `W3CTraceContextPropagator` composite propagator
 *   - `TraceIdRatioBasedSampler` (or `AlwaysOnSampler`) based on env var
 *   - Lambda resource attributes when `AWS_LAMBDA_FUNCTION_NAME` is set
 */
export function createTracerProvider(
  config?: OtelPluginConfig,
): ProviderResult {
  const source = resolveProviderSource(config);

  // Explicit: caller supplied a provider — return it as-is, no auto-setup.
  if (source === ProviderSource.Explicit) {
    return { tracerProvider: config!.tracerProvider!, source };
  }

  // Global: use the globally registered default provider, no auto-setup.
  if (source === ProviderSource.Global) {
    return { tracerProvider: trace.getTracerProvider(), source };
  }

  // AutoOtlp: create an internal provider with full auto-setup.
  // Resolve the OTLP endpoint
  const endpoint =
    config?.exporterConfig?.endpoint ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    DEFAULT_OTLP_ENDPOINT;

  // Create the OTLP exporter
  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers: config?.exporterConfig?.headers,
  });

  // Create the BatchSpanProcessor
  const spanProcessor = new BatchSpanProcessor(exporter);

  // Resolve the sampler
  const sampler = resolveSampler();

  // Build resource (Lambda detection)
  const resource = buildLambdaResource();

  // Create the NodeTracerProvider
  const tracerProvider = new NodeTracerProvider({
    sampler,
    spanProcessors: [spanProcessor],
    ...(resource ? { resource } : {}),
  });

  // Register propagators
  const propagators = config?.propagators ?? [
    new AWSXRayPropagator(),
    new W3CTraceContextPropagator(),
  ];

  tracerProvider.register({
    propagator: new CompositePropagator({ propagators }),
  });

  // Also register at the global level so HTTP instrumentation picks it up
  propagation.setGlobalPropagator(new CompositePropagator({ propagators }));

  return { tracerProvider, source };
}
