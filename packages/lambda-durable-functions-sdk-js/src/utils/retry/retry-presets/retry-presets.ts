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

  // Quick retries for transient errors
  transient: createRetryStrategy({
    maxAttempts: 3,
    initialDelaySeconds: 1,
    backoffRate: 2,
    jitterSeconds: 0.5,
  }),

  // Longer retries for resource availability
  resourceAvailability: createRetryStrategy({
    maxAttempts: 5,
    initialDelaySeconds: 5,
    maxDelaySeconds: 300,
    backoffRate: 2,
    jitterSeconds: 1,
  }),

  // Aggressive retries for critical operations
  critical: createRetryStrategy({
    maxAttempts: 10,
    initialDelaySeconds: 1,
    maxDelaySeconds: 60,
    backoffRate: 1.5,
    jitterSeconds: 0.3,
  }),
};
