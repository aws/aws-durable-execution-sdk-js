// attempt is 1-based: the number of the attempt that just failed.
export function createRetryStrategy({
  maxAttempts = 6,
  initialDelaySeconds = 5,
  maxDelaySeconds = 60,
  backoffRate = 2,
  jitter = true,
  shouldRetry = () => true,
} = {}) {
  return ({ error, attempt }) => {
    if (attempt >= maxAttempts || !shouldRetry(error)) {
      return { shouldRetry: false };
    }
    let delay = Math.min(
      initialDelaySeconds * backoffRate ** (attempt - 1),
      maxDelaySeconds,
    );
    // Full jitter spreads retries of many executions that failed together.
    if (jitter) delay *= Math.random();
    // The service schedules retries in whole seconds, at least 1.
    return { shouldRetry: true, delaySeconds: Math.max(1, Math.round(delay)) };
  };
}

export const defaultRetryStrategy = createRetryStrategy();
