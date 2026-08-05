import { DurableExecutionConfig } from "../types";
import { validateChildOperationsDepth } from "../utils/child-operations-depth/child-operations-depth";

/**
 * Validates the parts of {@link DurableExecutionConfig} that decide which transport is used.
 *
 * Startup validation happens in two phases, because one check has to run earlier than the
 * rest. This is the first phase: it must run *before* the transport is constructed, since
 * once a transport exists the SDK has already read execution state through it, and reporting
 * a conflict at that point is too late to have prevented anything.
 *
 * Add a check here only if it decides which transport is built; everything else belongs in
 * {@link validateDurableExecutionConfig}. The two are deliberately not chained — chaining
 * would put an unreachable call in whichever ran second.
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
 * Validates the rest of {@link DurableExecutionConfig} at startup and returns the first error
 * message found, or `undefined` when the config is valid.
 *
 * This is the second of the two validation phases, and where all checks belong except those
 * that decide which transport is built — see {@link validateTransportConfig}, which runs
 * first and covers those. Callers treat a returned message as a non-retryable configuration
 * error and fail the execution with it.
 *
 * @internal
 */
export function validateDurableExecutionConfig(
  config: DurableExecutionConfig | undefined,
): string | undefined {
  const childOperationsDepthError = validateChildOperationsDepth(
    config?.pluginsConfig?.childOperationsDepth,
  );
  if (childOperationsDepthError) return childOperationsDepthError;

  // Add further config validations here.

  return undefined;
}
