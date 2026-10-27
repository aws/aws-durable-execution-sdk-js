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

export function resolveFlushTimeoutMillis(value: number | undefined): number {
  const timeout = value ?? 1000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new RangeError(
      "flushTimeoutMillis must be positive and no greater than 2147483647",
    );
  }
  return timeout;
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
  timeoutMillis: number = 1000,
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
    if (timeoutMillis <= 0) {
      throw new Error("OpenTelemetry invocation flush budget exhausted");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Start the timer before calling an application-owned provider. Its
      // synchronous work cannot be preempted, but must not grant a fresh wait.
      const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("OpenTelemetry invocation flush budget exhausted"),
            ),
          timeoutMillis,
        );
      });
      await Promise.race([
        (
          target as TracerProvider & { forceFlush: () => Promise<void> }
        ).forceFlush(),
        expired,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
