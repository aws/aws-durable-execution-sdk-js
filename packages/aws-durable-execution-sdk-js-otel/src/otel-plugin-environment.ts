import type {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import type { Tracer, TracerProvider } from "@opentelemetry/api";
import { trace } from "@opentelemetry/api";
import { xRayContextExtractor } from "./context-extractors";
import type { ContextExtractor } from "./context-extractors";
import { DeterministicIdGenerator } from "./deterministic-id-generator";
import { tryInstallGlobalIdGenerator } from "./global-id-generator";
import { DurableSampler, tryInstallDurableSampler } from "./global-sampler";
import type { OtelPluginConfig } from "./otel-plugin-config";
import { createTracerProvider } from "./otel-plugin-provider";

const DEFAULT_INSTRUMENTATION_NAME = "aws-durable-execution-sdk-js";

/**
 * Everything an OTel durable plugin needs that belongs to the execution
 * environment rather than to one invocation.
 *
 * The split exists because a plugin instance serves exactly one invocation: the
 * SDK calls the factory per invocation and drops the instance when that
 * invocation returns. Per-invocation state — spans, the operation maps, the
 * execution identity and its sampling decision — is rebuilt for every
 * invocation, and rebuilding it is the point: it cannot then be shared between
 * two executions running concurrently in one environment. What lives here is the
 * opposite: resolved once, kept for the life of the environment, and in two
 * cases installed by mutating the application's tracer, which must happen at
 * most once.
 *
 * Held here:
 * - the config-derived settings (they are immutable, so one copy serves all);
 * - the "global provider or application-owned provider" resolution and the
 *   resulting {@link TracerProvider} and {@link Tracer};
 * - the {@link DeterministicIdGenerator} and its installation into the
 *   application tracer's `_idGenerator`;
 * - the {@link DurableSampler} wrapper installed into the tracer's `_sampler`.
 *
 * @internal
 */
export class OtelPluginEnvironment {
  readonly instrumentationName: string;
  readonly contextExtractor: ContextExtractor;
  readonly workflowSpanName: string;
  readonly enrichLogger: boolean;
  readonly usesGlobalProvider: boolean;

  /**
   * Re-resolved at most once, by {@link ensureTracingEnabled}, when the plugin
   * was built before zero-code instrumentation registered a global provider.
   */
  tracerProvider: TracerProvider;
  tracer: Tracer;
  idGenerator: DeterministicIdGenerator;
  durableSampler: DurableSampler | undefined;

  private globalIdGeneratorInstalled: boolean;

  constructor(config?: OtelPluginConfig) {
    const instrumentationName =
      config?.instrumentationName ?? DEFAULT_INSTRUMENTATION_NAME;
    this.instrumentationName = instrumentationName;

    this.idGenerator = new DeterministicIdGenerator();
    this.contextExtractor = config?.contextExtractor ?? xRayContextExtractor;
    this.workflowSpanName = config?.workflowSpanName ?? "Workflow";
    this.enrichLogger = config?.enrichLogger ?? true;

    const { tracerProvider, usesGlobalProvider } = createTracerProvider(
      config,
      this.idGenerator,
    );
    this.tracerProvider = tracerProvider;
    this.usesGlobalProvider = usesGlobalProvider;

    this.tracer = this.tracerProvider.getTracer(instrumentationName);
    this.durableSampler = tryInstallDurableSampler(this.tracer);
    this.globalIdGeneratorInstalled = !this.usesGlobalProvider;
    if (this.usesGlobalProvider) {
      const installedIdGenerator = tryInstallGlobalIdGenerator(this.tracer);
      if (installedIdGenerator) {
        this.idGenerator = installedIdGenerator;
        this.globalIdGeneratorInstalled = true;
      }
    }
  }

  /**
   * Whether the calling invocation can emit deterministic spans, installing the
   * deterministic ID generator on the global tracer if that has not succeeded
   * yet.
   *
   * Once the installation succeeds it is never repeated, which is why this state
   * belongs to the environment and not to a plugin instance: with one instance
   * per invocation, keeping it on the instance would reinstall — and re-wrap the
   * application's generator and sampler — on every invocation.
   *
   * @param pluginName - Name used to attribute the warning when no compatible
   * SDK tracer is available; telemetry is then disabled for that invocation.
   */
  ensureTracingEnabled(pluginName: string): boolean {
    if (!this.usesGlobalProvider || this.globalIdGeneratorInstalled) {
      return true;
    }

    // A plugin constructed before zero-code instrumentation is registered sees
    // a ProxyTracer without the SDK's ID generator. Resolve the global provider
    // again at invocation start, after preload initialization has completed.
    this.tracerProvider = trace.getTracerProvider();
    this.tracer = this.tracerProvider.getTracer(this.instrumentationName);
    this.durableSampler = tryInstallDurableSampler(this.tracer);

    const installedIdGenerator = tryInstallGlobalIdGenerator(this.tracer);
    if (installedIdGenerator) {
      this.idGenerator = installedIdGenerator;
      this.globalIdGeneratorInstalled = true;
      return true;
    }

    console.warn(
      `[${pluginName}] Expected a compatible OpenTelemetry SDK tracer at invocation start; telemetry is disabled for this invocation. Ensure the OpenTelemetry SDK is configured before invocation start.`,
    );
    return false;
  }
}

/**
 * Builds the per-invocation plugin factory the SDK installs, over one shared
 * environment.
 *
 * The environment is created on the first invocation rather than here, so that
 * merely constructing a factory — which the provider entry points do at module
 * load — resolves no tracer provider and installs nothing. Every instance the
 * factory hands out then shares that one environment, while the `info` it is
 * called with is what gives the instance its execution identity.
 *
 * Creation is attempted at most once, whether it succeeds or fails. Failing it
 * is not retried because the inputs cannot have changed — the same config runs
 * the same `tracerProviderFactory` — and retrying would call that factory again
 * on every invocation for the life of the execution environment, leaking
 * whatever it built before it threw (a span processor, an exporter connection)
 * once per invocation. The failure is logged once, at the point it happens, so
 * an operator sees it without it repeating in every invocation's log, and each
 * later invocation is then refused with the remembered error, which the SDK
 * contains exactly as it contains any factory error: the invocation runs without
 * this plugin.
 *
 * @internal
 */
export function createPluginFactory<
  Plugin extends DurableInstrumentationPlugin,
>(
  config: OtelPluginConfig | undefined,
  createInstance: (
    environment: OtelPluginEnvironment,
    info: InvocationInfo,
  ) => Plugin,
): DurableInstrumentationPluginFactory<Plugin> {
  let environment: OtelPluginEnvironment | undefined;
  let environmentError: unknown;
  let attempted = false;
  return {
    createPlugin(info: InvocationInfo): Plugin {
      if (!attempted) {
        attempted = true;
        try {
          environment = new OtelPluginEnvironment(config);
        } catch (error) {
          environmentError = error;
          console.error(
            "[aws-durable-execution-sdk-js-otel] Failed to initialize OpenTelemetry for durable execution; " +
              "spans are not recorded for the life of this execution environment:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      if (environment === undefined) {
        throw environmentError instanceof Error
          ? environmentError
          : new Error(String(environmentError));
      }

      return createInstance(environment, info);
    },
  };
}
