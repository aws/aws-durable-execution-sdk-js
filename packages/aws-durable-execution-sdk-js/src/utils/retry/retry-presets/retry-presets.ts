import { createRetryStrategy } from "../retry-config";

export const retryPresets = {
  // Default retries, will be used automatically if retryConfig is missing
  default: createRetryStrategy({
    maxAttempts: 3,
    initialDelaySeconds: 5,
    maxDelaySeconds: 60,
    backoffRate: 2,
    jitterSeconds: 1,
  }),

  // No retries - fail immediately on first error
  noRetry: createRetryStrategy({
    maxAttempts: 0,
  }),
};
