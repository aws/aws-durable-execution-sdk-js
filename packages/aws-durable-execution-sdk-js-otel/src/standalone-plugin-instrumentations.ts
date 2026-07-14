import type { TracerProvider } from "@opentelemetry/api";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import type { StandaloneOtelPluginConfig } from "./standalone-plugin-config";

/**
 * Registers HTTP and AWS SDK instrumentations for the StandaloneOtelPlugin.
 *
 * Skips ALL instrumentation registration when a custom `tracerProvider` is
 * provided in the config (the caller owns instrumentation in that case).
 *
 * When no custom `tracerProvider` is provided:
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
  config?: StandaloneOtelPluginConfig,
): void {
  // Skip all instrumentation when using an external provider (explicit or default)
  if (config?.tracerProvider || config?.useDefaultTracerProvider) {
    return;
  }

  const instrumentations = [];

  // Register HTTP instrumentation unless explicitly disabled
  if (config?.enableHttpInstrumentation !== false) {
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
