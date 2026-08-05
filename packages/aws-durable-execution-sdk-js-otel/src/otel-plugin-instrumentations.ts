import type { TracerProvider } from "@opentelemetry/api";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import type { OtelPluginConfig } from "./otel-plugin-config";
import { ProviderSource } from "./otel-plugin-provider";

/**
 * Registers HTTP and AWS SDK instrumentations for the ExecutionOtelPlugin
 * and InvocationOtelPlugin.
 *
 * Behavior is driven by the resolved {@link ProviderSource}:
 *
 * - `Explicit` — skips ALL instrumentation registration (the caller owns the
 *   provider and its instrumentation).
 * - `Global` — registers `@opentelemetry/instrumentation-aws-sdk` on the
 *   provided tracerProvider, but skips HTTP instrumentation (the external
 *   auto-instrumentation layer is expected to handle HTTP spans).
 * - `AutoOtlp` — registers `@opentelemetry/instrumentation-aws-sdk` and
 *   `@opentelemetry/instrumentation-http` (unless `enableHttpInstrumentation`
 *   is explicitly `false`).
 *
 * The HTTP instrumentation is configured to suppress spans for requests
 * whose hostname matches `127.0.0.1` or the value of the
 * `AWS_LAMBDA_RUNTIME_API` environment variable (used by the Lambda
 * runtime for internal communication).
 */
export function registerStandaloneInstrumentations(
  tracerProvider: TracerProvider,
  source: ProviderSource,
  config?: OtelPluginConfig,
): void {
  // Skip all instrumentation for an explicit custom provider (caller owns it)
  if (source === ProviderSource.Explicit) {
    return;
  }

  const instrumentations = [];

  // Register HTTP instrumentation only for the auto-configured (owned) provider
  // and not explicitly disabled
  if (
    source === ProviderSource.AutoOtlp &&
    config?.enableHttpInstrumentation !== false
  ) {
    instrumentations.push(
      new HttpInstrumentation({
        ignoreOutgoingRequestHook: (request) => {
          const hostname =
            typeof request.hostname === "string"
              ? request.hostname
              : typeof request.host === "string"
                ? request.host?.split(":")[0]
                : undefined;

          if (!hostname) {
            return false;
          }

          // Suppress spans for localhost (Lambda runtime internal calls)
          if (hostname === "127.0.0.1") {
            return true;
          }

          // Suppress spans for AWS Lambda Runtime API
          const runtimeApi = process.env.AWS_LAMBDA_RUNTIME_API;
          if (runtimeApi) {
            const runtimeHostname = runtimeApi.split(":")[0];
            if (hostname === runtimeHostname) {
              return true;
            }
          }

          return false;
        },
      }),
    );
  }

  // Always register AWS SDK instrumentation
  instrumentations.push(
    new AwsInstrumentation({
      suppressInternalInstrumentation: true,
      sqsExtractContextPropagationFromPayload: true,
    }),
  );

  registerInstrumentations({
    tracerProvider,
    instrumentations,
  });
}
