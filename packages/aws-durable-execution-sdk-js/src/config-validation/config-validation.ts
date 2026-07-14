import { DurableExecutionConfig } from "../types";
import { validateChildOperationsDepth } from "../utils/child-operations-depth/child-operations-depth";

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
  const childOperationsDepthError = validateChildOperationsDepth(
    config?.pluginsConfig?.childOperationsDepth,
  );
  if (childOperationsDepthError) return childOperationsDepthError;

  // Add further config validations here.

  return undefined;
}
