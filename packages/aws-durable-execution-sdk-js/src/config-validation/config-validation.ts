import { DurableExecutionConfig } from "../types";
import { validateChildOperationsDepth } from "../utils/child-operations-depth/child-operations-depth";

/**
 * Validates the parts of {@link DurableExecutionConfig} that decide which transport is used.
 *
 * Separate from {@link validateDurableExecutionConfig} because this has to run *before* the
 * transport is constructed, and therefore before the rest of the config is validated: by the
 * time the general check runs, execution state has already been read through whichever
 * transport was chosen. Called from both places, so the rules still live in one file.
 *
 * @internal
 */
export function validateTransportConfig(
  config: DurableExecutionConfig | undefined,
): string | undefined {
  // `client` configures the SDK's own Lambda transport; `durableExecutionClient`
  // replaces the transport outright. Supplying both states two different intentions
  // for the same thing, so it is rejected rather than resolved by precedence.
  if (config?.client && config?.durableExecutionClient) {
    return (
      "Both `client` and `durableExecutionClient` were provided, but they configure " +
      "the same thing in incompatible ways: `client` supplies a Lambda client for the " +
      "SDK's Lambda transport, while `durableExecutionClient` replaces the transport. " +
      "Provide only `durableExecutionClient` — to keep the Lambda transport with your " +
      "own client, pass it to DurableExecutionApiClient: " +
      "`{ durableExecutionClient: new DurableExecutionApiClient(myLambdaClient) }`."
    );
  }

  return undefined;
}

/**
 * Validates {@link DurableExecutionConfig} at startup and returns the first
 * error message found, or `undefined` when the config is valid.
 *
 * This is the single place startup config validation lives — add new checks
 * here as the config surface grows. Callers treat a returned message as a
 * non-retryable configuration error and fail the execution with it.
 * @internal
 */
export function validateDurableExecutionConfig(
  config: DurableExecutionConfig | undefined,
): string | undefined {
  const transportError = validateTransportConfig(config);
  if (transportError) return transportError;

  const childOperationsDepthError = validateChildOperationsDepth(
    config?.pluginsConfig?.childOperationsDepth,
  );
  if (childOperationsDepthError) return childOperationsDepthError;

  // Add further config validations here.

  return undefined;
}
