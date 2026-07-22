import type { TracerProvider } from "@opentelemetry/api";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import type { OtelPluginConfig } from "./otel-plugin-config";

/**
 * Registers HTTP and AWS SDK instrumentations for the ExecutionOtelPlugin
 * and InvocationOtelPlugin.
 *
 * Skips ALL instrumentation registration when a custom `tracerProvider` is
 * provided in the config (the caller owns instrumentation in that case).
 *
 * When `useDefaultTracerProvider` is true (and no explicit `tracerProvider`):
 * - Registers `@opentelemetry/instrumentation-aws-sdk` on the provided
 *   tracerProvider (preserving InvocationOtelPlugin's existing behavior)
 * - Skips HTTP instrumentation (the external auto-instrumentation layer
 *   is expected to handle HTTP spans)
 *
 * When neither `tracerProvider` nor `useDefaultTracerProvider` is set:
 * - Always registers `@opentelemetry/instrumentation-aws-sdk`
 * - Registers `@opentelemetry/instrumentation-http` unless
 *   `enableHttpInstrumentation` is explicitly `false`
 *
 * The HTTP instrumentation is configured to suppress spans for requests
 * whose hostname matches `127.0.0.1` or the value of the
 * `AWS_LAMBDA_RUNTIME_API` environment variable (used by the Lambda
 * runtime for internal communication).
 */
export function registerStandaloneInstrumentations(
  tracerProvider: TracerProvider,
  config?: OtelPluginConfig,
): void {
  // Skip all instrumentation when an explicit custom provider is given (caller owns instrumentation)
  if (config?.tracerProvider) {
    return;
  }

  const instrumentations = [];

  // Register HTTP instrumentation only when NOT using the default provider
  // and not explicitly disabled
  if (
    !config?.useDefaultTracerProvider &&
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
